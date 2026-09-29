import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 個人設定：使用者自己能改顯示名稱與提醒信；Email、組別、角色只有管理員能改。 */

const BASE = "http://127.0.0.1:8787";
let env: Env;
let session: string;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const fetchWorker = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);

const updateProfile = (body: unknown) => fetchWorker("/api/profile", { method: "PATCH", headers: { Cookie: session, Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const me = async () => (await (await fetchWorker("/api/auth/me", { headers: { Cookie: session } })).json() as { user: { name: string; email: string; role: string; group_id: string; email_notifications: number } }).user;

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications) VALUES ('elvis','elvis@example.com','陳冠宇','x','member','grp_general',0,1),('allan','allan@example.com','Allan','x','member','grp_general',0,1)").run();
  const token = `session-${Math.random()}`;
  await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), "elvis", new Date(Date.now() + 86_400_000).toISOString()).run();
  session = `sid=${token}`;
});

describe("自己改顯示名稱", () => {
  it("改好之後立刻生效，並記一筆稽核紀錄", async () => {
    const response = await updateProfile({ name: "Elvis" });
    expect(response.status).toBe(200);
    expect((await me()).name).toBe("Elvis");
    expect(await env.DB.prepare("SELECT user_id, summary FROM audit_log WHERE entity_id='elvis'").all().then((result) => result.results)).toEqual([{ user_id: "elvis", summary: "顯示名稱由「陳冠宇」改為「Elvis」" }]);
  });

  it("去掉頭尾空白，連續空白併成一個", async () => {
    await updateProfile({ name: "  Elvis   Chen \n" });
    expect((await me()).name).toBe("Elvis Chen");
  });

  it("空白或超過 40 個字不收", async () => {
    for (const name of ["   ", "", 123, "字".repeat(41)]) {
      const response = await updateProfile({ name });
      expect(response.status).toBe(422);
    }
    expect((await updateProfile({ name: "字".repeat(40) })).status).toBe(200);
  });

  it("不能和別人同名（不分大小寫），名稱保持原樣", async () => {
    const response = await updateProfile({ name: "allan" });
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toContain("已經有人叫「allan」");
    expect((await me()).name).toBe("陳冠宇");
  });

  it("名稱沒變就不寫稽核紀錄", async () => {
    expect((await updateProfile({ name: "陳冠宇" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({ n: 0 });
  });
});

describe("只改送來的欄位", () => {
  it("只改名稱時，每日提醒信的設定不變", async () => {
    await updateProfile({ name: "Elvis" });
    expect((await me()).email_notifications).toBe(1);
  });

  it("只改提醒信時，名稱不變", async () => {
    await updateProfile({ email_notifications: false });
    const user = await me();
    expect(user).toMatchObject({ name: "陳冠宇", email_notifications: 0 });
  });

  it("Email、組別、角色送來也不會改", async () => {
    await updateProfile({ name: "Elvis", email: "new@example.com", role: "admin", group_id: "grp_qa" });
    expect(await me()).toMatchObject({ name: "Elvis", email: "elvis@example.com", role: "member", group_id: "grp_general" });
  });
});
