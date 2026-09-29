import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hashPassword, sha256 } from "../worker/services/crypto";
import { FORGOT_PASSWORD_MESSAGE } from "../worker/routes/password-reset";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 忘記密碼：寄一次性的重設連結；不洩漏誰有帳號；重設後登出所有裝置。 */

const BASE = "https://brain.test";
let env: Env;
let sent: Array<{ to: string; subject: string; text: string }>;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}, ip = "203.0.113.7") => worker.fetch(new Request(`${BASE}${path}`, { ...init, headers: { Origin: BASE, "CF-Connecting-IP": ip, "Content-Type": "application/json", ...init.headers } }), env, ctx);
const post = (path: string, body: unknown, ip?: string) => call(path, { method: "POST", body: JSON.stringify(body) }, ip);
const forgot = (email: string, ip?: string) => post("/api/auth/forgot-password", { email }, ip);
const linkToken = (text: string) => decodeURIComponent(/reset-password\?token=([^\s]+)/.exec(text)![1]);

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE, AGENTMAIL_API_KEY: "test-key", AGENTMAIL_INBOX_ID: "team@agentmail.test" } as unknown as Env;
  const hash = await hashPassword("old-password");
  await db.prepare(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,failed_count,locked_until,is_active,approval_status) VALUES
    ('elvis','elvis@example.com','Elvis',?,'member','grp_general',1,0,5,'2999-01-01T00:00:00.000Z',1,'approved'),
    ('gone','gone@example.com','離職','x','member','grp_general',0,1,0,NULL,0,'approved'),
    ('wait','wait@example.com','待審','x','member','grp_general',0,1,0,NULL,1,'pending')`).bind(hash).run();
  await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES ('old-session','elvis',?)").bind(new Date(Date.now() + 86_400_000).toISOString()).run();
  sent = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: "m" }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("申請重設連結", () => {
  it("寄出 30 分鐘有效的連結；資料庫只存雜湊；關掉通知信的人也收得到", async () => {
    const response = await forgot(" Elvis@Example.com ");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "elvis@example.com", subject: "[艾爾水晶] 重設密碼" });
    expect(sent[0].text).toContain(`${BASE}/reset-password?token=`);
    const token = linkToken(sent[0].text);
    const row = await env.DB.prepare("SELECT token_hash, expires_at FROM password_resets WHERE user_id='elvis'").first<{ token_hash: string; expires_at: string }>();
    expect(row!.token_hash).toBe(await sha256(token));
    expect(row!.token_hash).not.toBe(token);
    const minutes = (new Date(row!.expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it("沒有這個帳號、已停用、還沒核准：回應一模一樣，但不寄信", async () => {
    for (const email of ["nobody@example.com", "gone@example.com", "wait@example.com"]) {
      const response = await forgot(email);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
    }
    expect(sent).toHaveLength(0);
  });

  it("Email 格式不對時請對方改", async () => {
    expect((await forgot("not-an-email")).status).toBe(422);
  });

  it("同一個帳號兩分鐘內只寄一次，回應不變", async () => {
    await forgot("elvis@example.com");
    const again = await forgot("elvis@example.com");
    expect(await again.json()).toEqual({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
    expect(sent).toHaveLength(1);
  });

  it("同一個 IP 一天最多申請 10 次", async () => {
    for (let index = 0; index < 10; index += 1) expect((await forgot(`x${index}@example.com`, "198.51.100.1")).status).toBe(200);
    expect((await forgot("elvis@example.com", "198.51.100.1")).status).toBe(429);
    expect(sent).toHaveLength(0);
    expect((await forgot("elvis@example.com", "198.51.100.2")).status).toBe(200);
  });
});

describe("用連結設定新密碼", () => {
  let token: string;
  beforeEach(async () => { await forgot("elvis@example.com"); token = linkToken(sent[0].text); });

  it("打開連結時先確認能不能用", async () => {
    expect(await (await call(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)).json()).toEqual({ valid: true });
    expect(await (await call("/api/auth/reset-password?token=wrong")).json()).toEqual({ valid: false });
  });

  it("設定新密碼後：舊密碼失效、新密碼登得進去、所有裝置登出、解除鎖定、記稽核、寄確認信", async () => {
    const response = await post("/api/auth/reset-password", { token, new_password: "new-password-1" });
    expect(response.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='elvis'").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT must_change_password, failed_count, locked_until FROM users WHERE id='elvis'").first()).toEqual({ must_change_password: 0, failed_count: 0, locked_until: null });
    expect((await post("/api/auth/login", { email: "elvis@example.com", password: "old-password" })).status).toBe(401);
    expect((await post("/api/auth/login", { email: "elvis@example.com", password: "new-password-1" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT user_id, action FROM audit_log WHERE action='password_reset'").first()).toEqual({ user_id: "elvis", action: "password_reset" });
    expect(sent.map((mail) => mail.subject)).toEqual(["[艾爾水晶] 重設密碼", "[艾爾水晶] 密碼已重設"]);
  });

  it("同一個連結只能用一次", async () => {
    expect((await post("/api/auth/reset-password", { token, new_password: "new-password-1" })).status).toBe(200);
    const again = await post("/api/auth/reset-password", { token, new_password: "new-password-2" });
    expect(again.status).toBe(400);
    expect((await again.json() as { error: string }).error).toContain("已失效或已經用過");
  });

  it("用掉一個連結後，之前寄出的其他連結也失效", async () => {
    await env.DB.prepare("UPDATE password_resets SET created_at=datetime('now','-10 minutes')").run();
    await forgot("elvis@example.com");
    const second = linkToken(sent[1].text);
    expect((await post("/api/auth/reset-password", { token: second, new_password: "new-password-1" })).status).toBe(200);
    expect((await post("/api/auth/reset-password", { token, new_password: "new-password-2" })).status).toBe(400);
  });

  it("過期的連結不能用", async () => {
    await env.DB.prepare("UPDATE password_resets SET expires_at=?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await post("/api/auth/reset-password", { token, new_password: "new-password-1" })).status).toBe(400);
  });

  it("新密碼太短不收，連結也不會被用掉", async () => {
    expect((await post("/api/auth/reset-password", { token, new_password: "short" })).status).toBe(422);
    expect((await post("/api/auth/reset-password", { token, new_password: "long-enough" })).status).toBe(200);
  });
});
