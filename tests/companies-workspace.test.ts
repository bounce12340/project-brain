import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { runAutomationRules } from "../worker/services/automation";
import { ISOLATION_STAGES } from "../worker/services/tenant";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 多公司第 3 階段：共用工作區（聯絡人、會議與外訓、待辦、通知對象、批次匯入）依公司隔離。
 * 兩個方向都要證明：A 看不到也改不到 B 的，B 也看不到 A 的；UIC 原本的行為不變。
 */

const BASE = "https://brain.test";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

async function request(path: string, init: RequestInit & { as?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.as) headers.set("Cookie", sessions[init.as]);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("Origin", BASE);
  const response = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, ctx);
  return { status: response.status, body: await response.json().catch(() => null) as any };
}
const get = (as: string, path: string) => request(path, { as });
const send = (method: string) => (as: string, path: string, body?: unknown) => request(path, { method, as, body: body === undefined ? undefined : JSON.stringify(body) });
const post = send("POST");
const patch = send("PATCH");
const del = send("DELETE");
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();

const sessions: Record<string, string> = {};

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.batch([
    db.prepare("UPDATE users SET must_change_password=0"),
    db.prepare("INSERT INTO companies (id,name,status) VALUES ('co_b','B 公司','active')"),
    // 同名組別：組別名稱只在公司內唯一，所以 B 也能有「RA/PV組」。
    db.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('grp_b','RA/PV組','general','co_b')"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('b_admin','b_admin@b.test','B 管理員','x','admin','grp_b',0),('b_member','b_member@b.test','B 成員','x','member','grp_b',0),('uic_admin','uic_admin@uic.test','UIC 管理員','x','admin','grp_general',0),('uic_member','uic_member@uic.test','UIC 成員','x','member','grp_general',0)"),
    db.prepare("INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at,external_key) VALUES ('prj_uic','UIC 專案','','grp_general','uic_admin','all','active',0,datetime('now'),'KEY-UIC'),('prj_b','B 專案','','grp_b','b_admin','all','active',0,datetime('now'),NULL)"),
  ]);
  for (const id of ["b_admin", "b_member", "uic_admin", "uic_member"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
});

it("第 3 階段完成", () => {
  expect(ISOLATION_STAGES.workspace).toBe(true);
});

describe("migration 0031", () => {
  it("既有的聯絡人、會議、匯入申請都歸 UIC", async () => {
    const { db } = createTestD1();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE company_id IS NOT 'co_uic'").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM meetings WHERE company_id IS NOT 'co_uic'").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM import_requests WHERE company_id IS NOT 'co_uic'").first()).toEqual({ n: 0 });
  });
});

describe("聯絡人", () => {
  const contact = { organization: "台大醫院", name: "王小明", phone: "02-1234" };

  it("兩家公司互相看不到；同名的人在各自公司都能建立", async () => {
    const mine = await post("uic_member", "/api/contacts", contact);
    expect(mine.status).toBe(201);
    expect((await get("b_member", "/api/contacts")).body.contacts).toEqual([]);
    // B 建立同機構同姓名：不算重複，也不會因此知道 UIC 有這筆。
    const theirs = await post("b_member", "/api/contacts", contact);
    expect(theirs.status).toBe(201);
    expect((await get("uic_member", "/api/contacts")).body.contacts.map((row: any) => row.id)).toEqual([mine.body.id]);
    expect((await get("b_member", "/api/contacts")).body.contacts.map((row: any) => row.id)).toEqual([theirs.body.id]);
    expect(await one("SELECT company_id FROM contacts WHERE id=?", theirs.body.id)).toEqual({ company_id: "co_b" });
    // 同一家公司內仍然擋重複。
    expect((await post("b_admin", "/api/contacts", contact)).status).toBe(409);
  });

  it("別家公司的管理員也改不到、刪不到", async () => {
    const mine = await post("uic_member", "/api/contacts", contact);
    expect((await patch("b_admin", `/api/contacts/${mine.body.id}`, { phone: "000" })).status).toBe(404);
    expect((await del("b_admin", `/api/contacts/${mine.body.id}`)).status).toBe(404);
    expect(await one("SELECT phone FROM contacts WHERE id=?", mine.body.id)).toEqual({ phone: "02-1234" });
    // 反方向：UIC 管理員碰不到 B 的。
    const theirs = await post("b_member", "/api/contacts", { organization: "B 醫院", name: "李大華" });
    expect((await patch("uic_admin", `/api/contacts/${theirs.body.id}`, { phone: "000" })).status).toBe(404);
    expect((await del("uic_admin", `/api/contacts/${theirs.body.id}`)).status).toBe(404);
    expect(await one("SELECT COUNT(*) AS n FROM contacts WHERE id=?", theirs.body.id)).toEqual({ n: 1 });
    // 自己公司的管理員照常能改能刪。
    expect((await patch("b_admin", `/api/contacts/${theirs.body.id}`, { phone: "111" })).status).toBe(200);
    expect((await del("b_admin", `/api/contacts/${theirs.body.id}`)).status).toBe(200);
  });
});

describe("會議與外訓", () => {
  const meeting = { kind: "meeting", title: "啟動會議", starts_at: "2099-10-01T14:00" };
  const course = { kind: "course", title: "GDP 外訓", starts_at: "2099-11-01T09:00", category: "drug" };

  it("列表、首頁總覽、修改、刪除都只限自己的公司", async () => {
    const a = await post("uic_member", "/api/meetings", meeting);
    const aCourse = await post("uic_member", "/api/meetings", course);
    expect(a.status).toBe(201);
    expect((await get("b_member", "/api/meetings")).body.meetings).toEqual([]);
    expect((await get("b_member", "/api/meetings?kind=course")).body.meetings).toEqual([]);
    const overview = (await get("b_member", "/api/meetings/overview")).body;
    expect(overview.upcoming).toEqual([]);
    expect(overview.recent).toEqual([]);
    expect((await patch("b_admin", `/api/meetings/${a.body.id}`, { title: "被改" })).status).toBe(404);
    expect((await del("b_admin", `/api/meetings/${aCourse.body.id}`)).status).toBe(404);
    expect(await one("SELECT title FROM meetings WHERE id=?", a.body.id)).toEqual({ title: "啟動會議" });

    const b = await post("b_member", "/api/meetings", meeting);
    expect(await one("SELECT company_id FROM meetings WHERE id=?", b.body.id)).toEqual({ company_id: "co_b" });
    expect((await get("uic_member", "/api/meetings")).body.meetings.map((row: any) => row.id).sort()).toEqual([a.body.id, aCourse.body.id].sort());
    expect((await get("b_member", "/api/meetings")).body.meetings.map((row: any) => row.id)).toEqual([b.body.id]);
    expect((await get("uic_member", "/api/meetings/overview")).body.upcoming.map((row: any) => row.id)).not.toContain(b.body.id);
    expect((await patch("uic_admin", `/api/meetings/${b.body.id}`, { title: "被改" })).status).toBe(404);
    expect((await del("uic_admin", `/api/meetings/${b.body.id}`)).status).toBe(404);
    expect((await del("b_admin", `/api/meetings/${b.body.id}`)).status).toBe(200);
  });

  it("相關專案必須是自己公司的（管理員也一樣）", async () => {
    expect((await post("b_admin", "/api/meetings", { ...meeting, project_id: "prj_uic" })).status).toBe(422);
    expect((await post("uic_admin", "/api/meetings", { ...meeting, project_id: "prj_b" })).status).toBe(422);
    expect((await post("b_admin", "/api/meetings", { ...course, project_id: "prj_uic" })).status).toBe(422);
    const own = await post("b_member", "/api/meetings", { ...meeting, project_id: "prj_b" });
    expect(own.status).toBe(201);
    // 改掛到別家公司的專案也不行。
    expect((await patch("b_member", `/api/meetings/${own.body.id}`, { project_id: "prj_uic" })).status).toBe(422);
    expect(await one("SELECT project_id FROM meetings WHERE id=?", own.body.id)).toEqual({ project_id: "prj_b" });
    expect((await post("uic_member", "/api/meetings", { ...meeting, project_id: "prj_uic" })).status).toBe(201);
  });
});

describe("個人待辦", () => {
  it("只能關聯自己公司的專案（管理員也一樣），新增與修改都擋", async () => {
    expect((await post("b_admin", "/api/todos", { title: "跨公司", project_id: "prj_uic" })).status).toBe(403);
    expect((await post("uic_admin", "/api/todos", { title: "跨公司", project_id: "prj_b" })).status).toBe(403);
    const own = await post("b_member", "/api/todos", { title: "自己的", project_id: "prj_b" });
    expect(own.status).toBe(201);
    expect((await patch("b_member", `/api/todos/${own.body.id}`, { project_id: "prj_uic" })).status).toBe(403);
    expect(await one("SELECT project_id FROM todos WHERE id=?", own.body.id)).toEqual({ project_id: "prj_b" });
    const plain = await post("b_member", "/api/todos", { title: "沒有專案" });
    expect(plain.status).toBe(201);
    expect((await get("uic_member", "/api/todos")).body.todos).toEqual([]);
    expect((await post("uic_member", "/api/todos", { title: "UIC 的", project_id: "prj_uic" })).status).toBe(201);
  });
});

describe("通知與指派的對象", () => {
  const rule = (id: string, action: string, user: string) => env.DB.prepare("INSERT INTO automation_rules (id,project_id,name,trigger_type,action_type,action_param_user,action_param_text,created_by) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, "prj_b", `規則 ${id}`, "task_done", action, user, "內容", "b_admin").run();

  it("自動化規則指到別家公司的帳號：不通知、不建待辦、不指派；同公司的照常", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO stages (id,project_id,name,position) VALUES ('stg_b','prj_b','待辦',0)"),
      env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('task_b','prj_b','stg_b','任務',0)"),
    ]);
    await rule("r1", "notify_user", "uic_member");
    await rule("r2", "create_todo_for", "uic_member");
    await rule("r3", "assign_task_to", "uic_member");
    await rule("r4", "notify_user", "b_member");
    await rule("r5", "create_todo_for", "b_member");
    const fired = await runAutomationRules(env.DB, "b_admin", "prj_b", [{ type: "task_done", taskId: "task_b" }]);
    expect(fired).toBe(2);
    expect(await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id='uic_member'")).toEqual({ n: 0 });
    expect(await one("SELECT COUNT(*) AS n FROM todos WHERE user_id='uic_member'")).toEqual({ n: 0 });
    expect(await one("SELECT assignee_id FROM tasks WHERE id='task_b'")).toEqual({ assignee_id: null });
    expect(await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id='b_member'")).toEqual({ n: 1 });
    expect(await one("SELECT COUNT(*) AS n FROM todos WHERE user_id='b_member'")).toEqual({ n: 1 });
  });

  it("使用者改名稱時，和別家公司的人同名不算重複", async () => {
    expect((await patch("b_member", "/api/profile", { name: "UIC 成員" })).status).toBe(200);
    expect((await patch("b_member", "/api/profile", { name: "B 管理員" })).status).toBe(409);
  });
});

describe("批次匯入", () => {
  const payload = (extra: Record<string, unknown> = {}) => ({ projects: [{ name: "匯入的專案", group: "RA/PV組", tasks: [{ title: "送件" }], ...extra }] });

  it("組別與帳號只在自己公司內對：B 的管理員匯入，專案落在 B 的組別；對不到 UIC 的人", async () => {
    const result = await post("b_admin", "/api/import", { payload: payload({ owner_email: "uic_member@uic.test" }) });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.result.projects.created).toBe(1);
    const row = await one("SELECT p.group_id,p.owner_id FROM projects p WHERE p.name='匯入的專案'");
    expect(row).toEqual({ group_id: "grp_b", owner_id: "b_admin" });
    expect(result.body.result.warnings.join("\n")).toContain("uic_member@uic.test");
  });

  it("不能把專案放進別家公司的組別", async () => {
    // B 沒有「BD組」；UIC 有。
    const blocked = await post("b_admin", "/api/import", { payload: { projects: [{ name: "越界", group: "BD組" }] } });
    expect(blocked.status).toBe(422);
    expect(blocked.body.issues.join("\n")).toContain("BD組");
    expect(await one("SELECT COUNT(*) AS n FROM projects WHERE name='越界'")).toEqual({ n: 0 });
    // 用組別 id 也不行。
    expect((await post("b_admin", "/api/import", { payload: { projects: [{ name: "越界", group: "grp_bd" }] } })).status).toBe(422);
    // UIC 反方向：不能放進 B 的組別 id。
    expect((await post("uic_admin", "/api/import", { payload: { projects: [{ name: "越界", group: "grp_b" }] } })).status).toBe(422);
  });

  it("專案代碼與名稱不會對到別家公司的專案", async () => {
    // 代碼已被 UIC 專案使用：不能更新它，也不透露是誰的。
    const keyed = await post("b_admin", "/api/import", { payload: { projects: [{ external_key: "KEY-UIC", name: "改名", group: "RA/PV組" }] } });
    expect(keyed.status).toBe(422);
    expect(keyed.body.issues.join("\n")).not.toContain("UIC 專案");
    expect(await one("SELECT name FROM projects WHERE id='prj_uic'")).toEqual({ name: "UIC 專案" });
    // 同名：B 的匯入是新建，不會更新 UIC 的專案。
    const named = await post("b_member", "/api/import/validate", { payload: { projects: [{ name: "UIC 專案", group: "RA/PV組" }] } });
    expect(named.status).toBe(200);
    expect(named.body.summary.projects).toEqual({ created: 1, updated: 0 });
    // UIC 自己用代碼仍然對得到、更新。
    const own = await post("uic_admin", "/api/import", { payload: { projects: [{ external_key: "KEY-UIC", name: "UIC 專案", description: "更新了" }] } });
    expect(own.status).toBe(200);
    expect(own.body.result.projects).toEqual({ created: 0, updated: 1 });
  });

  it("法規動態尚未開放給其他公司匯入，UIC 照舊", async () => {
    const entry = { entry_date: "2026-01-01", title: "公告", product_line: "藥品" };
    const blocked = await post("b_admin", "/api/import", { payload: { reg_entries: [entry] } });
    expect(blocked.status).toBe(422);
    expect(await one("SELECT COUNT(*) AS n FROM reg_entries WHERE title='公告'")).toEqual({ n: 0 });
    expect((await post("uic_admin", "/api/import", { payload: { reg_entries: [entry] } })).status).toBe(200);
  });

  it("匯入申請：只通知、只列給自己公司的管理員；別家公司的管理員看不到也不能審核", async () => {
    await env.DB.prepare("DELETE FROM notifications").run();
    const submitted = await post("b_member", "/api/import", { payload: payload() });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const id = submitted.body.id;
    expect(await one("SELECT company_id FROM import_requests WHERE id=?", id)).toEqual({ company_id: "co_b" });
    expect(await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id='b_admin' AND type='import_request'")).toEqual({ n: 1 });
    expect(await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id IN ('uic_admin','usr_admin') AND type='import_request'")).toEqual({ n: 0 });
    expect((await get("uic_admin", "/api/import/requests")).body.requests).toEqual([]);
    expect((await get("uic_admin", `/api/import/requests/${id}`)).status).toBe(404);
    expect((await post("uic_admin", `/api/import/requests/${id}/approve`)).status).toBe(404);
    expect((await post("uic_admin", `/api/import/requests/${id}/reject`, { note: "no" })).status).toBe(404);
    expect(await one("SELECT status FROM import_requests WHERE id=?", id)).toEqual({ status: "pending" });
    expect((await get("b_admin", "/api/import/requests")).body.requests.map((row: any) => row.id)).toEqual([id]);

    const approved = await post("b_admin", `/api/import/requests/${id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await one("SELECT p.group_id,p.owner_id FROM projects p WHERE p.name='匯入的專案'")).toEqual({ group_id: "grp_b", owner_id: "b_member" });

    // 反方向：UIC 的申請 B 的管理員碰不到。
    const uic = await post("uic_member", "/api/import", { payload: payload({ name: "UIC 匯入" }) });
    expect(uic.status).toBe(201);
    expect((await get("b_admin", "/api/import/requests")).body.requests.map((row: any) => row.id)).not.toContain(uic.body.id);
    expect((await post("b_admin", `/api/import/requests/${uic.body.id}/approve`)).status).toBe(404);
    expect(await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id='b_admin' AND body LIKE '%UIC%'")).toEqual({ n: 0 });
    expect((await post("uic_admin", `/api/import/requests/${uic.body.id}/approve`)).status).toBe(200);
  });

  it("匯入檢查失敗的清單只看得到自己公司的人", async () => {
    await post("b_member", "/api/import/check-failed", { source_name: "b.json", messages: ["壞了"] });
    await post("uic_member", "/api/import/check-failed", { source_name: "u.json", messages: ["壞了"] });
    const b = (await get("b_admin", "/api/import/check-failures")).body.failures;
    expect(b).toHaveLength(1);
    expect(b[0].summary).toContain("b.json");
    const uic = (await get("uic_admin", "/api/import/check-failures")).body.failures;
    expect(uic).toHaveLength(1);
    expect(uic[0].summary).toContain("u.json");
  });
});
