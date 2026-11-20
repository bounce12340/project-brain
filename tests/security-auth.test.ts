import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hashPassword, sha256 } from "../worker/services/crypto";
import { revokeUserAccess } from "../worker/services/revoke-access";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 登入節流（不能被拿來鎖死別人、擋撞庫）、改憑證後收回其他存取、註冊不洩漏帳號。 */

const BASE = "https://brain.test";
let env: Env;
let revoked: Array<[string, string]>;
let grants: Record<string, string[]>;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}, ip = "203.0.113.7", cookie?: string) => worker.fetch(new Request(`${BASE}${path}`, {
  ...init, headers: { Origin: BASE, "CF-Connecting-IP": ip, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
}), env, ctx);
const post = (path: string, body: unknown, ip?: string, cookie?: string) => call(path, { method: "POST", body: JSON.stringify(body) }, ip, cookie);
const patch = (path: string, body: unknown, cookie: string) => call(path, { method: "PATCH", body: JSON.stringify(body) }, undefined, cookie);
const login = (email: string, password: string, ip?: string) => post("/api/auth/login", { email, password }, ip);
const count = async (sql: string, ...params: unknown[]) => (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n;

async function session(userId: string, token: string) {
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, new Date(Date.now() + 86_400_000).toISOString()).run();
  return `sid=${token}`;
}

beforeEach(async () => {
  const { db } = createTestD1();
  revoked = [];
  grants = { victim: ["g1", "g2"], boss: ["g3"] };
  const oauth = {
    listUserGrants: async (userId: string) => ({ items: (grants[userId] ?? []).map((id) => ({ id, clientId: "c", scope: [], metadata: {} })), cursor: undefined }),
    revokeGrant: async (id: string, userId: string) => { revoked.push([id, userId]); grants[userId] = (grants[userId] ?? []).filter((item) => item !== id); },
  };
  env = { DB: db, OAUTH_KV: createMemoryKV(), OAUTH_PROVIDER: oauth, APP_BASE_URL: BASE, AGENTMAIL_API_KEY: "k", AGENTMAIL_INBOX_ID: "i@agentmail.test" } as unknown as Env;
  const hash = await hashPassword("correct-password");
  await db.prepare(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications,is_active,approval_status) VALUES
    ('victim','victim@example.com','本人',?,'member','grp_general',0,0,1,'approved'),
    ('boss','boss@example.com','管理員',?,'admin','grp_general',0,0,1,'approved'),
    ('gone','gone@example.com','離職',?,'member','grp_general',0,0,0,'approved')`).bind(hash, hash, hash).run();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message_id: "m" }), { status: 200 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("登入節流", () => {
  it("攻擊者在自己的 IP 輸錯 5 次，只鎖自己；本人從別的 IP 照樣登入", async () => {
    for (let i = 0; i < 5; i += 1) expect((await login("victim@example.com", "wrong", "198.51.100.9")).status).toBe(401);
    expect((await login("victim@example.com", "wrong", "198.51.100.9")).status).toBe(429);
    expect((await login("victim@example.com", "correct-password", "198.51.100.9")).status).toBe(429);
    expect((await login("victim@example.com", "correct-password", "203.0.113.50")).status).toBe(200);
  });

  it("成功登入會清掉這組 (帳號, IP) 的失敗次數", async () => {
    for (let i = 0; i < 4; i += 1) await login("victim@example.com", "wrong", "198.51.100.9");
    expect((await login("victim@example.com", "correct-password", "198.51.100.9")).status).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await login("victim@example.com", "wrong", "198.51.100.9")).status).toBe(401);
  });

  it("同一個 IP 跨帳號 1 小時 100 次失敗 → 密碼錯的 429，但密碼正確的人（共用辦公室 IP）照常登入", async () => {
    for (let i = 0; i < 99; i += 1) expect((await login(`user${i}@example.com`, "wrong", "192.0.2.77")).status).toBe(401);
    expect((await login("user99@example.com", "wrong", "192.0.2.77")).status).toBe(401);
    const blocked = await login("user100@example.com", "wrong", "192.0.2.77");
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toContain("請稍後再試");
    expect((await login("victim@example.com", "correct-password", "192.0.2.77")).status).toBe(200);
    expect((await login("victim@example.com", "wrong", "192.0.2.77")).status).toBe(429);
    expect((await login("victim@example.com", "wrong", "192.0.2.78")).status).toBe(401);
  });

  it("同一帳號跨 IP 一天 100 次失敗 → 暫時鎖定（高門檻安全網）", async () => {
    // 每個 IP 只錯 1 次，避開 pair 與 ip 的門檻。
    for (let i = 0; i < 100; i += 1) await login("victim@example.com", "wrong", `10.1.${Math.floor(i / 250)}.${i % 250}`);
    expect((await login("victim@example.com", "correct-password", "10.9.9.9")).status).toBe(429);
  });

  it("帳號存在與否、鎖定與否，回應都一樣（不洩漏帳號）", async () => {
    const capture = async (email: string) => {
      const out: Array<[number, string]> = [];
      for (let i = 0; i < 6; i += 1) { const r = await login(email, "wrong", `198.51.100.${email.length}`); out.push([r.status, ((await r.json()) as { error: string }).error]); }
      return out;
    };
    const real = await capture("victim@example.com");
    const fake = await capture("ghost-account@example.com");
    expect(real.map(([s]) => s)).toEqual([401, 401, 401, 401, 401, 429]);
    // 長度不同的 Email 用不同 IP，所以只比對狀態碼序列與文案一致。
    expect(fake).toEqual(real);
  });

  it("停用帳號與不存在的帳號一樣回 401，且走同一條節流路徑（5 次後同樣 429，連密碼正確也擋）", async () => {
    const run = async (email: string, ip: string) => {
      const out: Array<[number, string]> = [];
      for (let i = 0; i < 6; i += 1) { const r = await login(email, i < 5 ? "wrong" : "correct-password", ip); out.push([r.status, ((await r.json()) as { error: string }).error]); }
      return out;
    };
    const inactive = await run("gone@example.com", "198.51.100.1");
    const ghost = await run("ghost@example.com", "198.51.100.2");
    expect(inactive).toEqual(ghost);
    expect(inactive[0]).toEqual([401, "帳號或密碼錯誤"]);
    expect(inactive[5][0]).toBe(429);
  });

  it("公司停用的帳號：密碼錯誤同樣累計並鎖定，與一般帳號一致", async () => {
    await env.DB.prepare("INSERT INTO companies (id,name,status) VALUES ('co_off','停用公司','suspended')").run();
    await env.DB.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('grp_off','停用組','general','co_off')").run();
    await env.DB.prepare("UPDATE users SET group_id='grp_off' WHERE id='victim'").run();
    const seq: number[] = [];
    for (let i = 0; i < 6; i += 1) seq.push((await login("victim@example.com", "wrong", "198.51.100.5")).status);
    expect(seq).toEqual([401, 401, 401, 401, 401, 429]);
    expect(await count("SELECT COUNT(*) AS n FROM login_throttle WHERE kind='pair'")).toBe(1);
  });
});

describe("改密碼收回其他存取", () => {
  it("change-password：刪掉其他 session、撤銷全部 OAuth 授權，保留目前 session", async () => {
    const current = await session("victim", "current-token");
    await session("victim", "other-token");
    const response = await post("/api/auth/change-password", { current_password: "correct-password", new_password: "brand-new-pass" }, undefined, current);
    expect(response.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE id=?", await sha256("current-token"))).toBe(1);
    expect(revoked).toEqual([["g1", "victim"], ["g2", "victim"]]);
  });

  it("change-password：新密碼不能與目前相同、不能超過 200 碼", async () => {
    const current = await session("victim", "current-token");
    expect((await post("/api/auth/change-password", { current_password: "correct-password", new_password: "correct-password" }, undefined, current)).status).toBe(422);
    expect((await post("/api/auth/change-password", { current_password: "correct-password", new_password: "x".repeat(201) }, undefined, current)).status).toBe(422);
  });

  it("沒有 OAuth 輔助函式時仍會清 session", async () => {
    await session("victim", "t1");
    await revokeUserAccess({ DB: env.DB } as unknown as Env, "victim");
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
  });

  it("管理員重設密碼：目標的 session 與授權都收回", async () => {
    const admin = await session("boss", "boss-token");
    await session("victim", "victim-token");
    const response = await post("/api/admin/users/victim/reset-password", { password: "temp-password-1" }, undefined, admin);
    expect(response.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
    expect(grants.victim).toEqual([]);
  });

  it("管理員停用帳號（PATCH 與 DELETE）：session 與授權都收回", async () => {
    const admin = await session("boss", "boss-token");
    await session("victim", "victim-token");
    expect((await patch("/api/admin/users/victim", { is_active: false }, admin)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
    expect(grants.victim).toEqual([]);
    await env.DB.prepare("UPDATE users SET is_active=1 WHERE id='victim'").run();
    grants.victim = ["g9"];
    await session("victim", "victim-token-2");
    expect((await call("/api/admin/users/victim", { method: "DELETE" }, undefined, admin)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
    expect(grants.victim).toEqual([]);
  });

  it("管理員改 Email：session 與授權都收回；只改名字則不動", async () => {
    const admin = await session("boss", "boss-token");
    await session("victim", "victim-token");
    expect((await patch("/api/admin/users/victim", { name: "新名字" }, admin)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(1);
    expect(grants.victim).toEqual(["g1", "g2"]);
    expect((await patch("/api/admin/users/victim", { email: "new@example.com" }, admin)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
    expect(grants.victim).toEqual([]);
  });

  it("用 Email 連結重設密碼：授權也收回，並解除各 IP 的登入鎖定", async () => {
    const mails: Array<{ to: string; text: string }> = [];
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => { mails.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); });
    for (let i = 0; i < 5; i += 1) await login("victim@example.com", "wrong", "198.51.100.9");
    await session("victim", "victim-token");
    await post("/api/auth/forgot-password", { email: "victim@example.com" });
    const token = decodeURIComponent(/reset-password\?token=([^\s]+)/.exec(mails[0].text)![1]);
    expect((await post("/api/auth/reset-password", { token, new_password: "after-reset-1" })).status).toBe(200);
    expect(grants.victim).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id='victim'")).toBe(0);
    expect((await login("victim@example.com", "after-reset-1", "198.51.100.9")).status).toBe(200);
  });
});

describe("註冊不洩漏帳號", () => {
  it("send-code：已註冊與未註冊的 Email 連打兩次，回應序列完全一樣（含 60 秒冷卻）；已註冊的收到通知信而非驗證碼", async () => {
    const sentMails: Array<{ to: string; subject: string; text: string }> = [];
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => { sentMails.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); });
    const seq = async (email: string) => { const out = []; for (let i = 0; i < 2; i += 1) { const r = await post("/api/register/send-code", { email }); out.push([r.status, await r.json()]); } return out; };
    const fresh = await seq("new-person@example.com");
    const existing = await seq("victim@example.com");
    expect(existing).toEqual(fresh);
    expect(fresh[1][0]).toBe(429);
    expect(sentMails).toHaveLength(2);
    expect(sentMails[1]).toMatchObject({ to: "victim@example.com", subject: "[艾爾水晶] 此 Email 已有帳號" });
    expect(sentMails[1].text).not.toMatch(/\d{6}/);
    // 冷卻紀錄不是註冊用的驗證碼。
    expect(await count("SELECT COUNT(*) AS n FROM email_verifications WHERE email='victim@example.com' AND purpose='register'")).toBe(0);
  });

  it("send-code：寄信失敗時，已註冊與未註冊的 Email 都回同樣的 503", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const a = await post("/api/register/send-code", { email: "new-person@example.com" });
    const b = await post("/api/register/send-code", { email: "victim@example.com" });
    expect([b.status, await b.json()]).toEqual([a.status, await a.json()]);
    expect(a.status).toBe(503);
  });

  it("submit：已註冊的 Email 以通用訊息失敗，不建立帳號", async () => {
    await post("/api/register/send-code", { email: "victim@example.com" });
    const response = await post("/api/register/submit", { name: "冒名", email: "victim@example.com", password: "Password123", group_id: "grp_general", code: "123456" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).not.toContain("已註冊");
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE email='victim@example.com'")).toBe(1);
  });
});
