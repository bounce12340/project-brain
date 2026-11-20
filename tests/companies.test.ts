import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { ISOLATION_STAGES, tenantIsolationComplete } from "../worker/services/tenant";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 多公司第 1 階段：公司、組別歸屬、系統管理員、邀請註冊，以及「A 公司的管理員碰不到 B 公司」。
 * 新公司在資料隔離全部完成前停在「建置中」，帳號不能登入。
 */

const BASE = "https://brain.test";
let env: Env;
let mails: Array<{ to: string; subject: string; text: string }>;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

async function request(path: string, init: RequestInit & { session?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.session) headers.set("Cookie", init.session);
  if (init.body) { headers.set("Content-Type", "application/json"); headers.set("Origin", BASE); }
  const response = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, ctx);
  return { status: response.status, body: await response.json().catch(() => null) as any };
}
const post = (path: string, body: unknown, session?: string) => request(path, { method: "POST", body: JSON.stringify(body), session });
const patch = (path: string, body: unknown, session?: string) => request(path, { method: "PATCH", body: JSON.stringify(body), session });

async function login(userId: string): Promise<string> {
  const token = `session-${userId}-${Math.random()}`;
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, new Date(Date.now() + 86_400_000).toISOString()).run();
  return `sid=${token}`;
}
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();

/** 經由邀請碼註冊：取驗證碼（從寄出的信裡讀）、送出申請。 */
async function registerWithInvite(code: string, email: string, groupId: string, name = "受邀者") {
  const sent = await post("/api/register/send-code", { email, invite: code });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const otp = /驗證碼是：(\d{6})/.exec(mails.at(-1)!.text)![1];
  return post("/api/register/submit", { name, email, password: "Password123", group_id: groupId, code: otp, invite: code });
}

beforeEach(async () => {
  const { db } = createTestD1();
  mails = [];
  env = {
    DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE,
    MAIL_FROM_ADDRESS: "notify@brain.test", MAIL_FROM_NAME: "艾爾水晶",
    EMAIL: { send: async (message: { to: string; subject: string; text: string }) => { mails.push(message); return { messageId: `m${mails.length}` }; } },
  } as unknown as Env;
  await db.prepare("UPDATE users SET must_change_password=0").run();
  // 另一位 UIC 管理員（不是系統管理員）。
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('uic_admin2','admin2@uic.test','UIC 管理員','x','admin','grp_bd',0)").run();
});

describe("migration 0029", () => {
  it("既有組別都屬於 UIC，usr_admin 是系統管理員；組別名稱改成同公司內唯一", async () => {
    expect(await one("SELECT COUNT(*) AS n FROM groups WHERE company_id<>'co_uic'")).toEqual({ n: 0 });
    expect(await one("SELECT name,status FROM companies WHERE id='co_uic'")).toEqual({ name: "UIC", status: "active" });
    expect(await one("SELECT is_system_admin FROM users WHERE id='usr_admin'")).toEqual({ is_system_admin: 1 });
    expect(await one("SELECT is_system_admin FROM users WHERE id='uic_admin2'")).toEqual({ is_system_admin: 0 });
    // 範本的組別在重建 groups 後仍在。
    expect(await one("SELECT group_id FROM stage_templates WHERE id='tpl_bd'")).toEqual({ group_id: "grp_bd" });
    await env.DB.prepare("INSERT INTO companies (id,name) VALUES ('co_x','X')").run();
    await env.DB.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('gx','BD組','bd','co_x')").run();
    await expect(env.DB.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('gy','BD組','bd','co_uic')").run()).rejects.toThrow(/UNIQUE/);
  });

  it("五個隔離階段都已完成，可以開通其他公司", () => {
    expect(Object.values(ISOLATION_STAGES).every(Boolean)).toBe(true);
    expect(tenantIsolationComplete()).toBe(true);
  });
});

describe("系統管理後台", () => {
  it("只有系統管理員能用", async () => {
    expect((await request("/api/system/companies", { session: await login("uic_admin2") })).status).toBe(403);
    expect((await request("/api/system/companies", { session: await login("usr_bd1") })).status).toBe(403);
    const ok = await request("/api/system/companies", { session: await login("usr_admin") });
    expect(ok.status).toBe(200);
    expect(ok.body.companies[0]).toMatchObject({ id: "co_uic", home: true, status: "active" });
    expect(ok.body.isolation.complete).toBe(true);
  });

  it("建立公司：建置中、附一個預設組別；同名不能重複；可以開通；原本的公司不能停用", async () => {
    const session = await login("usr_admin");
    const created = await post("/api/system/companies", { name: "Archi Corp" }, session);
    expect(created.status).toBe(201);
    expect(created.body.company).toMatchObject({ name: "Archi Corp", status: "setup", groups: 1, users: 0 });
    expect((await post("/api/system/companies", { name: "archi corp" }, session)).status).toBe(422);
    const activate = await patch(`/api/system/companies/${created.body.company.id}`, { status: "active" }, session);
    expect(activate.status).toBe(200);
    expect(activate.body.company.status).toBe("active");
    expect((await patch("/api/system/companies/co_uic", { status: "suspended" }, session)).status).toBe(422);
  });

  it("發邀請：邀請碼只回一次、資料庫只存雜湊；有填 Email 就寄邀請信", async () => {
    const session = await login("usr_admin");
    const company = (await post("/api/system/companies", { name: "Archi Corp" }, session)).body.company;
    const result = await post(`/api/system/companies/${company.id}/invites`, { role: "admin", email: "Boss@Archi.test" }, session);
    expect(result.status).toBe(201);
    expect(result.body.invite.url).toBe(`${BASE}/register?invite=${result.body.invite.code}`);
    expect(result.body.email_sent).toBe(true);
    expect(mails.at(-1)).toMatchObject({ to: "boss@archi.test" });
    expect(mails.at(-1)!.text).toContain(result.body.invite.url);
    const stored = await one("SELECT code_hash,note FROM company_invites WHERE company_id=?", company.id);
    expect(stored!.code_hash).not.toContain(result.body.invite.code);
    expect(stored!.note).toBe("boss@archi.test");
    const detail = await request(`/api/system/companies/${company.id}`, { session });
    expect(detail.body.invites[0]).toMatchObject({ role: "admin", state: "open", used_count: 0 });
    expect(JSON.stringify(detail.body)).not.toContain(result.body.invite.code);
  });
});

describe("邀請註冊", () => {
  async function setup() {
    const session = await login("usr_admin");
    const company = (await post("/api/system/companies", { name: "Archi Corp" }, session)).body.company;
    const group = await one("SELECT id FROM groups WHERE company_id=?", company.id);
    const invite = (await post(`/api/system/companies/${company.id}/invites`, { role: "admin" }, session)).body.invite;
    return { session, company, groupId: group!.id as string, code: invite.code as string };
  }

  it("邀請頁只列出那家公司的組別；不受公開註冊開關限制", async () => {
    const { code, groupId } = await setup();
    await env.DB.prepare("UPDATE app_settings SET value='0' WHERE key='registration_enabled'").run();
    const meta = await request(`/api/register/meta?invite=${code}`);
    expect(meta.body).toMatchObject({ enabled: true, invite: { company: "Archi Corp", role: "admin" } });
    expect(meta.body.groups).toEqual([{ id: groupId, name: "一般" }]);
    expect((await request("/api/register/meta")).body.enabled).toBe(false);
    expect((await request("/api/register/meta?invite=WRONGCODE")).body).toMatchObject({ enabled: false, invite_error: expect.any(String) });
  });

  it("管理員邀請：建立那家公司已核准的管理員；邀請用完就失效；不能用邀請碼選到別家公司的組別", async () => {
    const { code, groupId, company } = await setup();
    const wrongGroup = await registerWithInvite(code, "sneaky@archi.test", "grp_general");
    expect(wrongGroup.status).toBe(422);
    const done = await registerWithInvite(code, "boss@archi.test", groupId, "Archi 老闆");
    expect(done.status).toBe(201);
    expect(done.body.status).toBe("approved");
    expect(await one("SELECT u.role,u.approval_status,g.company_id FROM users u JOIN groups g ON g.id=u.group_id WHERE u.email='boss@archi.test'")).toEqual({ role: "admin", approval_status: "approved", company_id: company.id });
    expect(await one("SELECT used_count FROM company_invites WHERE company_id=?", company.id)).toEqual({ used_count: 1 });
    expect((await post("/api/register/send-code", { email: "second@archi.test", invite: code })).status).toBe(422);
  });

  it("沒有邀請碼的公開註冊只能選 UIC 的組別", async () => {
    const { groupId } = await setup();
    const meta = await request("/api/register/meta");
    expect(meta.body.groups.map((group: { id: string }) => group.id)).not.toContain(groupId);
  });

  it("建置中的公司：密碼對了也不能登入，已有的 session 也無效", async () => {
    const { code, groupId } = await setup();
    await registerWithInvite(code, "boss@archi.test", groupId);
    const attempt = await post("/api/auth/login", { email: "boss@archi.test", password: "Password123" });
    expect(attempt.status).toBe(403);
    expect(attempt.body).toMatchObject({ code: "COMPANY_NOT_ACTIVE" });
    const boss = await one("SELECT id FROM users WHERE email='boss@archi.test'");
    expect((await request("/api/auth/me", { session: await login(boss!.id) })).status).toBe(401);
  });
});

describe("公司管理員只管得到自己的公司", () => {
  /** 模擬之後開通：直接把公司設成使用中，建立它的管理員與成員。 */
  async function activeOtherCompany() {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO companies (id,name,status) VALUES ('co_archi','Archi','active')"),
      env.DB.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('ga','一般','general','co_archi'),('ga2','BD組','bd','co_archi')"),
      env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('archi_admin','boss@archi.test','Archi 老闆','x','admin','ga',0)"),
      env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,approval_status) VALUES ('archi_new','new@archi.test','Archi 新人','x','member','ga',0,'pending')"),
      env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,approval_status) VALUES ('uic_new','new@uic.test','UIC 新人','x','member','grp_bd',0,'pending')"),
    ]);
    return login("archi_admin");
  }

  it("帳號、註冊申請、組別、成員名單都只看得到自己公司的", async () => {
    const archi = await activeOtherCompany();
    const users = (await request("/api/admin/users", { session: archi })).body;
    expect(users.users.map((user: { id: string }) => user.id).sort()).toEqual(["archi_admin", "archi_new"]);
    expect(users.active_admin_count).toBe(1);
    expect((await request("/api/admin/registrations", { session: archi })).body.registrations.map((row: { id: string }) => row.id)).toEqual(["archi_new"]);
    expect((await request("/api/admin/groups", { session: archi })).body.groups.map((group: { id: string }) => group.id).sort()).toEqual(["ga", "ga2"]);
    const metadata = (await request("/api/metadata", { session: archi })).body;
    expect(metadata.users.map((user: { id: string }) => user.id).sort()).toEqual(["archi_admin", "archi_new"]);
    expect(metadata.groups.map((group: { id: string }) => group.id).sort()).toEqual(["ga", "ga2"]);
    // UIC 這邊也看不到 Archi 的人。
    const uic = (await request("/api/admin/users", { session: await login("uic_admin2") })).body.users.map((user: { id: string }) => user.id);
    expect(uic).not.toContain("archi_admin");
    expect(uic).not.toContain("archi_new");
  });

  it("動不了別家公司的帳號、申請與組別，也不能把自己公司的人搬到別家的組", async () => {
    const archi = await activeOtherCompany();
    expect((await patch("/api/admin/users/usr_bd1", { name: "改名" }, archi)).status).toBe(404);
    const del = await request("/api/admin/users/usr_bd1", { method: "DELETE", session: archi, headers: { Origin: BASE } });
    expect(del.status, JSON.stringify(del.body)).toBe(404);
    expect((await post("/api/admin/users/usr_bd1/reset-password", {}, archi)).status).toBe(404);
    expect((await post("/api/admin/registrations/uic_new/approve", {}, archi)).status).toBe(404);
    expect((await post("/api/admin/registrations/uic_new/reject", {}, archi)).status).toBe(404);
    expect((await patch("/api/admin/groups/grp_bd", { name: "改名" }, archi)).status).toBe(404);
    expect((await request("/api/admin/groups/grp_bd", { method: "DELETE", session: archi, headers: { Origin: BASE } })).status).toBe(404);
    expect((await patch("/api/admin/users/archi_new", { group_id: "grp_bd" }, archi)).status).toBe(422);
    expect((await post("/api/admin/registrations/archi_new/approve", { group_id: "grp_bd" }, archi)).status).toBe(422);
    expect((await post("/api/admin/users", { name: "x", email: "x@archi.test", group_id: "grp_bd", role: "member", password: "Password123" }, archi)).status).toBe(422);
    expect(await one("SELECT name,group_id FROM users WHERE id='usr_bd1'")).toEqual({ name: "王必達", group_id: "grp_bd" });
  });

  it("組別名稱只在自己公司內不能重複；最後一位管理員按公司計算", async () => {
    const archi = await activeOtherCompany();
    expect((await post("/api/admin/groups", { name: "RA/PV組", type: "general" }, archi)).status).toBe(201);
    expect((await post("/api/admin/groups", { name: "BD組", type: "bd" }, archi)).status).toBe(422);
    // UIC 有兩位管理員，但 Archi 只有一位：Archi 的最後一位管理員不能被降級。
    expect((await patch("/api/admin/users/archi_admin", { role: "member" }, archi)).status).toBe(422);
  });

  it("公開註冊開關與示範資料只屬於原本的公司", async () => {
    const archi = await activeOtherCompany();
    expect((await post("/api/admin/registration-toggle", { enabled: false }, archi)).status).toBe(403);
    expect((await post("/api/admin/clear-demo", {}, archi)).status).toBe(403);
  });

  it("新註冊申請只通知那家公司的管理員", async () => {
    await activeOtherCompany();
    const session = await login("usr_admin");
    const invite = (await post("/api/system/companies/co_archi/invites", { role: "member" }, session)).body.invite;
    await registerWithInvite(invite.code, "member@archi.test", "ga");
    const notified = await env.DB.prepare("SELECT user_id FROM notifications WHERE type='registration'").all<{ user_id: string }>();
    expect(notified.results.map((row) => row.user_id)).toEqual(["archi_admin"]);
    expect(await one("SELECT approval_status FROM users WHERE email='member@archi.test'")).toEqual({ approval_status: "pending" });
  });

  it("停用公司會立刻登出那家公司的人", async () => {
    const archi = await activeOtherCompany();
    expect((await request("/api/auth/me", { session: archi })).status).toBe(200);
    expect((await patch("/api/system/companies/co_archi", { status: "suspended" }, await login("usr_admin"))).status).toBe(200);
    expect((await request("/api/auth/me", { session: archi })).status).toBe(401);
  });
});
