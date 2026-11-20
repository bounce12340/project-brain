import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { canEditProgress, canEditProgressUpdate, canManageAutomation, canManageProject, canViewFees, canViewProject } from "../worker/services/permissions";
import { ISOLATION_STAGES } from "../worker/services/tenant";
import type { AuthUser, ProjectAccess } from "../worker/types";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 多公司第 2 階段：專案與專案裡的一切。
 * A 公司的人（含管理員）不能列出、讀取、新增、修改、刪除 B 公司的專案、任務、里程碑、階段、子任務、檔案、
 * 留言、成員、範本，也不能把 B 公司的帳號或組別拉進 A 的專案；UIC 原本的行為不變。
 */

const BASE = "https://brain.test";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const objects = new Map<string, string>();

async function request(method: string, path: string, session: string, body?: unknown) {
  const headers = new Headers({ Cookie: session, Origin: BASE });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await worker.fetch(new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 下載檔案不是 JSON */ }
  return { status: response.status, body: json, text };
}
const get = (path: string, session: string) => request("GET", path, session);
const post = (path: string, session: string, body: unknown = {}) => request("POST", path, session, body);
const patch = (path: string, session: string, body: unknown) => request("PATCH", path, session, body);
const put = (path: string, session: string, body: unknown) => request("PUT", path, session, body);
const del = (path: string, session: string) => request("DELETE", path, session);

async function login(userId: string): Promise<string> {
  const token = `session-${userId}-${Math.random()}`;
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, new Date(Date.now() + 86_400_000).toISOString()).run();
  return `sid=${token}`;
}
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();
const count = async (sql: string, ...params: unknown[]) => Number((await one(sql, ...params))!.n);

interface Fixture {
  projectId: string; stageId: string; taskId: string; task2Id: string; milestoneId: string; subtaskId: string; commentId: string;
  fileId: string; ruleId: string; updateId: string; caseId: string; eventId: string; feeId: string; krId: string; fieldId: string;
  enrollmentId: string; licenseId: string; ccrId: string;
}

let sessions: { uicAdmin: string; uicMember: string; bAdmin: string; bMember: string };

/** 經由 API 建一個含各種內容的專案（QA 組別，這樣效期與 CCR 也能測）。 */
async function buildProject(owner: string, groupId: string, tag: string): Promise<Fixture> {
  const created = await post("/api/projects", owner, { name: `${tag} 專案`, group_id: groupId, visibility: "all" });
  expect(created.status, created.text).toBe(201);
  const projectId = created.body.id as string;
  const stageId = (await post(`/api/projects/${projectId}/stages`, owner, { name: "進行中" })).body.id as string;
  const taskId = (await post(`/api/projects/${projectId}/tasks`, owner, { title: `${tag} 任務`, stage_id: stageId })).body.id as string;
  const task2Id = (await post(`/api/projects/${projectId}/tasks`, owner, { title: `${tag} 任務二`, stage_id: stageId })).body.id as string;
  const milestoneId = (await post(`/api/projects/${projectId}/milestones`, owner, { title: `${tag} 里程碑`, due_date: "2030-01-01" })).body.id as string;
  const subtaskId = (await post(`/api/tasks/${taskId}/subtasks`, owner, { title: `${tag} 子任務` })).body.id as string;
  expect((await post(`/api/tasks/${taskId}/comments`, owner, { content: `${tag} 留言` })).status).toBe(201);
  const commentId = (await one("SELECT id FROM task_comments WHERE task_id=?", taskId))!.id as string;
  const ownerId = (await one("SELECT user_id FROM sessions WHERE id=?", await sha256(owner.slice(4))))!.user_id as string;
  const ruleId = (await post(`/api/projects/${projectId}/rules`, owner, { name: `${tag} 規則`, trigger_type: "task_done", action_type: "notify_user", action_param_user: ownerId })).body.id as string;
  const updateId = (await post(`/api/projects/${projectId}/progress-updates`, owner, { content: `${tag} 進度` })).body.id as string;
  const caseId = (await post(`/api/projects/${projectId}/bd/cases`, owner, { case_name: "案", product_name: "藥", case_type: "新藥" })).body.id as string;
  const eventId = (await post(`/api/bd/cases/${caseId}/events`, owner, { event_date: "2030-01-01", event_type: "送件", description: "送件" })).body.id as string;
  const feeId = (await post(`/api/projects/${projectId}/bd/fees`, owner, { fee_date: "2030-01-01", category: "規費", amount: 100 })).body.id as string;
  const krId = (await post(`/api/projects/${projectId}/key-results`, owner, { title: `${tag} KR`, quarter: "2030Q1" })).body.id as string;
  const fieldId = (await post(`/api/projects/${projectId}/task-fields`, owner, { name: "欄位", type: "text" })).body.id as string;
  const enrollmentId = (await post(`/api/projects/${projectId}/clinical/enrollments`, owner, { record_date: "2030-01-01", count: 1 })).body.id as string;
  const licenseId = (await post(`/api/projects/${projectId}/licenses`, owner, { name: "證", subject: "主體", expires_at: "2030-12-31" })).body.id as string;
  const ccrId = (await post(`/api/projects/${projectId}/ccrs`, owner, { title: "變更", target_type: "產品", description: "d", reason: "r", classification: "次要" })).body.id as string;
  const fileId = `file_${tag}`;
  objects.set(`p/${projectId}/${fileId}/a.txt`, "內容");
  await env.DB.prepare("INSERT INTO files (id,project_id,task_id,filename,size,content_type,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?)")
    .bind(fileId, projectId, taskId, "a.txt", 6, "text/plain", `p/${projectId}/${fileId}/a.txt`, ownerId).run();
  return { projectId, stageId, taskId, task2Id, milestoneId, subtaskId, commentId, fileId, ruleId, updateId, caseId, eventId, feeId, krId, fieldId, enrollmentId, licenseId, ccrId };
}

let uic: Fixture;
let other: Fixture;

beforeEach(async () => {
  const { db } = createTestD1();
  objects.clear();
  env = {
    DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE,
    FILES: {
      async put(key: string, value: Blob) { objects.set(key, await value.text()); },
      async get(key: string) { const text = objects.get(key); return text === undefined ? null : { body: text, size: text.length, httpEtag: '"e"' }; },
      async delete(key: string) { objects.delete(key); },
    },
  } as unknown as Env;
  await db.prepare("UPDATE users SET must_change_password=0").run();
  await db.batch([
    db.prepare("INSERT INTO companies (id,name,status) VALUES ('co_b','B 公司','active')"),
    db.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('gb_qa','QA組','qa','co_b'),('gb_gen','一般','general','co_b')"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('b_admin','admin@b.test','B 管理員','x','admin','gb_gen',0)"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('b_member','member@b.test','B 成員','x','member','gb_qa',0)"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('uic_qa','qa@uic.test','UIC QA','x','member','grp_qa',0)"),
    db.prepare("INSERT INTO stage_templates (id,name,group_id,stages_json,company_id) VALUES ('tpl_b','B 流程',NULL,'[\"B1\",\"B2\"]','co_b')"),
  ]);
  sessions = { uicAdmin: await login("usr_admin"), uicMember: await login("uic_qa"), bAdmin: await login("b_admin"), bMember: await login("b_member") };
  uic = await buildProject(sessions.uicMember, "grp_qa", "UIC");
  other = await buildProject(sessions.bMember, "gb_qa", "B");
});

describe("設定", () => {
  it("第 2 階段的旗標已打開", () => expect(ISOLATION_STAGES.projects).toBe(true));
});

describe("migration 0030：階段範本屬於公司", () => {
  it("既有範本都歸 UIC，組別還在；名稱在同公司內唯一、不同公司可以同名", async () => {
    expect(await count("SELECT COUNT(*) AS n FROM stage_templates WHERE company_id<>'co_uic'")).toBe(1);
    expect(await one("SELECT company_id,group_id FROM stage_templates WHERE id='tpl_bd'")).toEqual({ company_id: "co_uic", group_id: "grp_bd" });
    expect(await count("SELECT COUNT(*) AS n FROM stage_templates WHERE id IN ('tpl_bd','tpl_clinical','tpl_general') AND company_id='co_uic'")).toBe(3);
    await env.DB.prepare("INSERT INTO stage_templates (id,name,group_id,stages_json,company_id) VALUES ('tpl_same','一般專案',NULL,'[]','co_b')").run();
    await expect(env.DB.prepare("INSERT INTO stage_templates (id,name,group_id,stages_json,company_id) VALUES ('tpl_dup','一般專案',NULL,'[]','co_uic')").run()).rejects.toThrow(/UNIQUE/);
  });
});

describe("權限函式：先比對公司", () => {
  const user = (over: Partial<AuthUser>): AuthUser => ({ id: "u", email: "u@x", name: "u", role: "admin", group_id: "g", group_name: "g", group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1, approval_status: "approved", company_id: "co_a", company_name: "A", is_system_admin: 0, ...over });
  const project: ProjectAccess = { id: "p", owner_id: "u", group_id: "g", visibility: "all", member_ids: ["u"], company_id: "co_b" };

  it("別家公司的專案：管理員、負責人、成員、同組、同 id 都不行", () => {
    for (const role of ["admin", "member", "intern"] as const) {
      const actor = user({ role });
      expect(canViewProject(actor, project)).toBe(false);
      expect(canEditProgress(actor, project)).toBe(false);
      expect(canEditProgressUpdate(actor, project, actor.id)).toBe(false);
      expect(canManageProject(actor, project)).toBe(false);
      expect(canViewFees(actor, project)).toBe(false);
      expect(canManageAutomation(actor, project)).toBe(false);
    }
  });

  it("同一家公司：管理員看得到全部，原本的規則照舊", () => {
    const same = { ...project, company_id: "co_a", owner_id: "other", member_ids: [] };
    expect(canViewProject(user({ role: "admin" }), same)).toBe(true);
    expect(canManageProject(user({ role: "admin" }), same)).toBe(true);
    expect(canViewProject(user({ role: "intern" }), same)).toBe(false);
    expect(canEditProgress(user({ role: "member" }), same)).toBe(true);
  });
});

describe("列表只看得到自己公司的專案", () => {
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  it("專案清單：兩個方向", async () => {
    const mine = ids((await get("/api/projects", sessions.bAdmin)).body.projects);
    expect(mine).toContain(other.projectId);
    expect(mine).not.toContain(uic.projectId);
    expect(mine).toHaveLength(1);
    const uicList = ids((await get("/api/projects", sessions.uicAdmin)).body.projects);
    expect(uicList).toContain(uic.projectId);
    expect(uicList).not.toContain(other.projectId);
    // UIC 管理員仍看得到 UIC 全部專案（含種子資料的私人專案）。
    expect(uicList).toEqual(expect.arrayContaining(["prj_clinical", "prj_bd", "prj_general", "prj_private"]));
    expect(ids((await get("/api/projects?summary=1&status=active", sessions.uicMember)).body.projects)).not.toContain(other.projectId);
  });

  it("儀表板、專案總覽、時間軸、我的任務、可提及的人", async () => {
    const dashboardB = (await get("/api/dashboard", sessions.bAdmin)).body;
    expect(ids(dashboardB.projects)).toEqual([other.projectId]);
    expect(JSON.stringify(dashboardB)).not.toContain(uic.projectId);
    const dashboardUic = (await get("/api/dashboard", sessions.uicAdmin)).body;
    expect(ids(dashboardUic.projects)).not.toContain(other.projectId);
    expect(ids(dashboardUic.projects)).toContain(uic.projectId);
    expect(ids((await get("/api/portfolio", sessions.bAdmin)).body.projects)).toEqual([other.projectId]);
    expect(ids((await get("/api/portfolio", sessions.uicAdmin)).body.projects)).not.toContain(other.projectId);
    const timeline = (await get("/api/timeline", sessions.bAdmin)).body.groups;
    expect(JSON.stringify(timeline)).toContain(other.projectId);
    expect(JSON.stringify(timeline)).not.toContain(uic.projectId);
    expect(JSON.stringify((await get("/api/timeline", sessions.uicAdmin)).body)).not.toContain(other.projectId);
    // 把 B 的任務指給 B 的人，我的任務只有 B 自己的；UIC 看不到。
    await env.DB.prepare("UPDATE tasks SET assignee_id='b_member' WHERE id=?").bind(other.taskId).run();
    await env.DB.prepare("UPDATE tasks SET assignee_id='b_member' WHERE id=?").bind(uic.taskId).run();
    const mineB = (await get("/api/my-tasks", sessions.bMember)).body.items;
    expect(mineB.map((item: { id: string }) => item.id)).toEqual([other.taskId]);
    const mentionables = (await get(`/api/projects/${other.projectId}/mentionables`, sessions.bAdmin)).body.users.map((u: { id: string }) => u.id);
    expect(mentionables.sort()).toEqual(["b_admin", "b_member"]);
  });

  it("範本與 metadata：只有自己公司的", async () => {
    const metaB = (await get("/api/metadata", sessions.bAdmin)).body;
    expect(metaB.templates.map((t: { id: string }) => t.id)).toEqual(["tpl_b"]);
    const metaUic = (await get("/api/metadata", sessions.uicAdmin)).body;
    expect(metaUic.templates.map((t: { id: string }) => t.id).sort()).toEqual(["tpl_bd", "tpl_clinical", "tpl_general"]);
    expect((await get("/api/admin/templates", sessions.bAdmin)).body.templates.map((t: { id: string }) => t.id)).toEqual(["tpl_b"]);
    expect((await get("/api/admin/templates", sessions.uicAdmin)).body.templates.map((t: { id: string }) => t.id)).not.toContain("tpl_b");
  });
});

/** 每個端點都該把「別家公司的東西」當作不存在。 */
function foreignRequests(f: Fixture): Array<[string, string, unknown?]> {
  return [
    ["GET", `/api/projects/${f.projectId}`],
    ["GET", `/api/projects/${f.projectId}?sections=core,updates,clinical,bd`],
    ["PATCH", `/api/projects/${f.projectId}`, { name: "被改了", status: "paused" }],
    ["DELETE", `/api/projects/${f.projectId}`],
    ["POST", `/api/projects/${f.projectId}/archive`],
    ["POST", `/api/projects/${f.projectId}/unarchive`],
    ["GET", `/api/projects/${f.projectId}/members`],
    ["POST", `/api/projects/${f.projectId}/members`, { user_id: "usr_admin" }],
    ["DELETE", `/api/projects/${f.projectId}/members/usr_admin`],
    ["GET", `/api/projects/${f.projectId}/mentionables`],
    ["POST", `/api/projects/${f.projectId}/stages`, { name: "新階段" }],
    ["PATCH", `/api/stages/${f.stageId}`, { name: "被改了" }],
    ["DELETE", `/api/stages/${f.stageId}`],
    ["POST", `/api/projects/${f.projectId}/tasks`, { title: "塞進去", stage_id: f.stageId }],
    ["PATCH", `/api/tasks/${f.taskId}`, { title: "被改了", done: true }],
    ["DELETE", `/api/tasks/${f.taskId}`],
    ["PUT", `/api/tasks/${f.taskId}/fields`, { [f.fieldId]: "x" }],
    ["GET", `/api/tasks/${f.taskId}/dependencies`],
    ["POST", `/api/tasks/${f.taskId}/dependencies`, { depends_on_task_id: f.task2Id }],
    ["DELETE", `/api/tasks/${f.taskId}/dependencies/${f.task2Id}`],
    ["GET", `/api/tasks/${f.taskId}/comments`],
    ["POST", `/api/tasks/${f.taskId}/comments`, { content: "偷留言" }],
    ["GET", `/api/tasks/${f.taskId}/subtasks`],
    ["POST", `/api/tasks/${f.taskId}/subtasks`, { title: "塞進去" }],
    ["PATCH", `/api/subtasks/${f.subtaskId}`, { title: "被改了" }],
    ["DELETE", `/api/subtasks/${f.subtaskId}`],
    ["POST", `/api/projects/${f.projectId}/milestones`, { title: "塞進去", due_date: "2031-01-01" }],
    ["PATCH", `/api/milestones/${f.milestoneId}`, { title: "被改了", done: true }],
    ["DELETE", `/api/milestones/${f.milestoneId}`],
    ["POST", `/api/projects/${f.projectId}/progress-updates`, { content: "偷寫進度" }],
    ["PATCH", `/api/progress-updates/${f.updateId}`, { content: "被改了" }],
    ["DELETE", `/api/progress-updates/${f.updateId}`],
    ["GET", `/api/projects/${f.projectId}/files`],
    ["GET", `/api/files/${f.fileId}/download`],
    ["DELETE", `/api/files/${f.fileId}`],
    ["GET", `/api/projects/${f.projectId}/rules`],
    ["POST", `/api/projects/${f.projectId}/rules`, { name: "規則", trigger_type: "task_done", action_type: "log_update" }],
    ["PATCH", `/api/rules/${f.ruleId}`, { enabled: false }],
    ["DELETE", `/api/rules/${f.ruleId}`],
    ["PUT", `/api/projects/${f.projectId}/clinical/settings`, { target_n: 5 }],
    ["POST", `/api/projects/${f.projectId}/clinical/enrollments`, { record_date: "2031-01-01", count: 9 }],
    ["DELETE", `/api/clinical/enrollments/${f.enrollmentId}`],
    ["POST", `/api/projects/${f.projectId}/bd/cases`, { case_name: "案", product_name: "藥", case_type: "新藥" }],
    ["PATCH", `/api/bd/cases/${f.caseId}`, { case_name: "被改了" }],
    ["DELETE", `/api/bd/cases/${f.caseId}`],
    ["POST", `/api/bd/cases/${f.caseId}/events`, { event_date: "2031-01-01", event_type: "送件", description: "x" }],
    ["DELETE", `/api/bd/events/${f.eventId}`],
    ["POST", `/api/projects/${f.projectId}/bd/fees`, { fee_date: "2031-01-01", category: "規費", amount: 1 }],
    ["DELETE", `/api/bd/fees/${f.feeId}`],
    ["GET", `/api/projects/${f.projectId}/licenses`],
    ["POST", `/api/projects/${f.projectId}/licenses`, { name: "證", subject: "主體", expires_at: "2031-12-31" }],
    ["PATCH", `/api/licenses/${f.licenseId}`, { name: "被改了" }],
    ["DELETE", `/api/licenses/${f.licenseId}`],
    ["GET", `/api/projects/${f.projectId}/ccrs`],
    ["GET", `/api/projects/${f.projectId}/ccrs/export`],
    ["POST", `/api/projects/${f.projectId}/ccrs`, { title: "變更", target_type: "產品", description: "d", reason: "r", classification: "次要" }],
    ["PATCH", `/api/ccrs/${f.ccrId}`, { title: "被改了" }],
    ["POST", `/api/ccrs/${f.ccrId}/transition`, { status: "評估中" }],
    ["POST", `/api/ccrs/${f.ccrId}/events`, { description: "備註" }],
    ["GET", `/api/projects/${f.projectId}/okr?quarter=2030Q1`],
    ["PUT", `/api/projects/${f.projectId}/quarter-goals/2030Q1`, { objective: "目標" }],
    ["POST", `/api/projects/${f.projectId}/key-results`, { title: "KR", quarter: "2030Q1" }],
    ["PATCH", `/api/key-results/${f.krId}`, { status: "完成" }],
    ["DELETE", `/api/key-results/${f.krId}`],
    ["POST", `/api/projects/${f.projectId}/key-results/reorder`, { ids: [f.krId] }],
    ["POST", `/api/projects/${f.projectId}/task-fields`, { name: "新欄位", type: "text" }],
    ["PATCH", `/api/task-fields/${f.fieldId}`, { name: "被改了" }],
    ["DELETE", `/api/task-fields/${f.fieldId}`],
  ];
}

async function snapshot(f: Fixture) {
  const p = f.projectId;
  return JSON.stringify([
    await one("SELECT name,status,progress,group_id,owner_id FROM projects WHERE id=?", p),
    await one("SELECT COUNT(*) AS n FROM project_members WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM stages WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(title||done) AS t FROM tasks WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(title||done) AS t FROM milestones WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM subtasks WHERE task_id=?", f.taskId),
    await one("SELECT COUNT(*) AS n FROM task_comments WHERE task_id=?", f.taskId),
    await one("SELECT COUNT(*) AS n FROM files WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(enabled) AS t FROM automation_rules WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(content) AS t FROM progress_updates WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM bd_cases WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM bd_fees WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM clinical_enrollments WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(name) AS t FROM licenses WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(title) AS t FROM ccr_records WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(status) AS t FROM key_results WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n, GROUP_CONCAT(name) AS t FROM task_fields WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM project_quarter_goals WHERE project_id=?", p),
    await one("SELECT COUNT(*) AS n FROM notifications"),
  ]);
}

describe("別家公司的專案與內容一律不存在", () => {
  it("UIC 管理員與成員碰不到 B 公司的任何東西（讀、寫、刪都是 404，資料不變）", async () => {
    const before = await snapshot(other);
    for (const session of [sessions.uicAdmin, sessions.uicMember]) {
      for (const [method, path, body] of foreignRequests(other)) {
        const result = await request(method, path, session, body);
        expect(result.status, `${method} ${path} → ${result.text}`).toBe(404);
      }
    }
    expect(await snapshot(other)).toBe(before);
    expect(objects.has(`p/${other.projectId}/${other.fileId}/a.txt`)).toBe(true);
  });

  it("B 公司的管理員與成員同樣碰不到 UIC 的任何東西", async () => {
    const before = await snapshot(uic);
    for (const session of [sessions.bAdmin, sessions.bMember]) {
      for (const [method, path, body] of foreignRequests(uic)) {
        const result = await request(method, path, session, body);
        expect(result.status, `${method} ${path} → ${result.text}`).toBe(404);
      }
    }
    expect(await snapshot(uic)).toBe(before);
    // 種子資料裡的 UIC 專案也一樣。
    for (const id of ["prj_clinical", "prj_bd", "prj_general", "prj_private"]) {
      expect((await get(`/api/projects/${id}`, sessions.bAdmin)).status).toBe(404);
      expect((await patch(`/api/projects/${id}`, sessions.bAdmin, { name: "被改了" })).status).toBe(404);
      expect((await del(`/api/projects/${id}`, sessions.bAdmin)).status).toBe(404);
    }
  });

  it("管理員在自己公司仍然看得到、管得到全部專案（含別人負責的私人專案）", async () => {
    await env.DB.prepare("UPDATE projects SET visibility='private' WHERE id=?").bind(other.projectId).run();
    const detail = await get(`/api/projects/${other.projectId}`, sessions.bAdmin);
    expect(detail.status).toBe(200);
    expect(detail.body.permissions).toMatchObject({ can_edit: true, can_manage: true });
    expect((await patch(`/api/projects/${other.projectId}`, sessions.bAdmin, { name: "管理員改名" })).status).toBe(200);
    expect(await one("SELECT name FROM projects WHERE id=?", other.projectId)).toEqual({ name: "管理員改名" });
    // UIC 也一樣：管理員看得到私人專案。
    expect((await get("/api/projects/prj_private", sessions.uicAdmin)).status).toBe(200);
    expect((await get(`/api/files/${other.fileId}/download`, sessions.bAdmin)).text).toBe("內容");
  });

  it("檔案：同公司可以下載，別家公司不能（也不會刪到物件）", async () => {
    expect((await get(`/api/files/${uic.fileId}/download`, sessions.uicMember)).text).toBe("內容");
    expect((await get(`/api/files/${uic.fileId}/download`, sessions.bAdmin)).status).toBe(404);
    expect((await del(`/api/files/${uic.fileId}`, sessions.bAdmin)).status).toBe(404);
    expect(objects.has(`p/${uic.projectId}/${uic.fileId}/a.txt`)).toBe(true);
    expect((await del(`/api/files/${uic.fileId}`, sessions.uicMember)).status).toBe(200);
  });
});

describe("不能把別家公司的帳號或組別拉進自己的專案", () => {
  it("專案成員、任務負責人、子任務負責人、自動化對象、KR 負責人", async () => {
    const admin = sessions.bAdmin;
    expect((await post(`/api/projects/${other.projectId}/members`, admin, { user_id: "usr_bd1" })).status).toBe(422);
    expect((await post(`/api/projects/${other.projectId}/members`, admin, { user_id: "b_admin" })).status).toBe(201);
    expect((await post(`/api/projects/${other.projectId}/tasks`, admin, { title: "指派", stage_id: other.stageId, assignee_id: "usr_bd1" })).status).toBe(422);
    expect((await patch(`/api/tasks/${other.taskId}`, admin, { assignee_id: "usr_bd1" })).status).toBe(422);
    expect((await patch(`/api/tasks/${other.taskId}`, admin, { assignee_id: "b_admin" })).status).toBe(200);
    expect((await post(`/api/tasks/${other.taskId}/subtasks`, admin, { title: "子", assignee_id: "usr_bd1" })).status).toBe(422);
    expect((await patch(`/api/subtasks/${other.subtaskId}`, admin, { assignee_id: "usr_bd1" })).status).toBe(422);
    expect((await post(`/api/projects/${other.projectId}/rules`, admin, { name: "規則", trigger_type: "task_done", action_type: "notify_user", action_param_user: "usr_bd1" })).status).toBe(422);
    expect((await post(`/api/projects/${other.projectId}/key-results`, admin, { title: "KR", quarter: "2030Q1", owner_id: "usr_bd1" })).status).toBe(422);
    expect((await patch(`/api/key-results/${other.krId}`, admin, { owner_id: "usr_bd1" })).status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM project_members WHERE user_id='usr_bd1' AND project_id=?", other.projectId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id='usr_bd1' AND project_id=?", other.projectId)).toBe(0);
    // 反過來：UIC 專案不能加入或指派 B 的人。
    expect((await post(`/api/projects/${uic.projectId}/members`, sessions.uicAdmin, { user_id: "b_member" })).status).toBe(422);
    expect((await patch(`/api/tasks/${uic.taskId}`, sessions.uicAdmin, { assignee_id: "b_member" })).status).toBe(422);
    expect((await post(`/api/projects/${uic.projectId}/rules`, sessions.uicAdmin, { name: "規則", trigger_type: "task_done", action_type: "notify_user", action_param_user: "b_admin" })).status).toBe(422);
    // 同公司的人照常可以。
    expect((await post(`/api/projects/${uic.projectId}/members`, sessions.uicAdmin, { user_id: "usr_bd1" })).status).toBe(201);
    expect((await patch(`/api/tasks/${uic.taskId}`, sessions.uicAdmin, { assignee_id: "usr_bd1" })).status).toBe(200);
  });

  it("留言只能提及同公司的人（別家公司的名字不會產生通知）", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id='usr_admin'");
    const result = await post(`/api/tasks/${other.taskId}/comments`, sessions.bAdmin, { content: "@UIC管理員 @usr_admin 看這裡 @B成員" });
    expect(result.status).toBe(201);
    expect(result.body.mentioned_user_ids).not.toContain("usr_admin");
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id='usr_admin'")).toBe(before);
  });

  it("新增專案、搬組別：只能用自己公司的組別", async () => {
    expect((await post("/api/projects", sessions.bAdmin, { name: "偷放", group_id: "grp_bd" })).status).toBe(422);
    expect((await post("/api/projects", sessions.uicAdmin, { name: "偷放", group_id: "gb_gen" })).status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE name='偷放'")).toBe(0);
    expect((await patch(`/api/projects/${other.projectId}`, sessions.bAdmin, { group_id: "grp_bd" })).status).toBe(422);
    expect((await patch(`/api/projects/${uic.projectId}`, sessions.uicAdmin, { group_id: "gb_gen" })).status).toBe(422);
    expect(await one("SELECT group_id FROM projects WHERE id=?", other.projectId)).toEqual({ group_id: "gb_qa" });
    expect((await patch(`/api/projects/${other.projectId}`, sessions.bAdmin, { group_id: "gb_gen" })).status).toBe(200);
    expect((await patch(`/api/projects/${uic.projectId}`, sessions.uicAdmin, { group_id: "grp_bd" })).status).toBe(200);
  });

  it("子專案：不能掛到別家公司的母專案底下", async () => {
    expect((await post("/api/projects", sessions.bAdmin, { name: "子", parent_id: uic.projectId })).status).toBe(404);
    expect((await patch(`/api/projects/${other.projectId}`, sessions.bAdmin, { parent_id: uic.projectId })).status).toBe(404);
    expect((await post("/api/projects", sessions.uicAdmin, { name: "子", parent_id: other.projectId })).status).toBe(404);
    const child = await post("/api/projects", sessions.bAdmin, { name: "B 子專案", parent_id: other.projectId });
    expect(child.status).toBe(201);
    expect(await one("SELECT group_id FROM projects WHERE id=?", child.body.id)).toEqual({ group_id: "gb_qa" });
  });

  it("費用只能掛在同一個專案的案件上", async () => {
    expect((await post(`/api/projects/${other.projectId}/bd/fees`, sessions.bAdmin, { fee_date: "2031-01-01", category: "規費", amount: 1, case_id: uic.caseId })).status).toBe(422);
    expect((await post(`/api/projects/${other.projectId}/bd/fees`, sessions.bAdmin, { fee_date: "2031-01-01", category: "規費", amount: 1, case_id: other.caseId })).status).toBe(201);
  });
});

describe("階段範本每家公司各自一份", () => {
  it("新增專案只套用自己公司的範本；別家公司的範本當作不存在", async () => {
    const withUic = await post("/api/projects", sessions.bAdmin, { name: "用 UIC 範本", group_id: "gb_gen", template_id: "tpl_bd" });
    expect(withUic.status).toBe(201);
    expect(await count("SELECT COUNT(*) AS n FROM stages WHERE project_id=?", withUic.body.id)).toBe(0);
    const withOwn = await post("/api/projects", sessions.bAdmin, { name: "用自己的範本", group_id: "gb_gen", template_id: "tpl_b" });
    expect((await all("SELECT name FROM stages WHERE project_id=? ORDER BY position", withOwn.body.id)).map((row) => row.name)).toEqual(["B1", "B2"]);
    const uicWithB = await post("/api/projects", sessions.uicAdmin, { name: "UIC 用 B 範本", group_id: "grp_bd", template_id: "tpl_b" });
    expect(await count("SELECT COUNT(*) AS n FROM stages WHERE project_id=?", uicWithB.body.id)).toBe(0);
    const uicOwn = await post("/api/projects", sessions.uicAdmin, { name: "UIC 範本", group_id: "grp_bd", template_id: "tpl_bd" });
    expect(await count("SELECT COUNT(*) AS n FROM stages WHERE project_id=?", uicOwn.body.id)).toBe(6);
  });

  async function all(sql: string, ...params: unknown[]) { return (await env.DB.prepare(sql).bind(...params).all<{ name: string }>()).results; }

  it("管理端：看不到、改不了、刪不掉別家公司的範本；範本的組別必須同公司；同名只在同公司內擋", async () => {
    expect((await patch("/api/admin/templates/tpl_bd", sessions.bAdmin, { name: "被改了" })).status).toBe(404);
    expect((await del("/api/admin/templates/tpl_bd", sessions.bAdmin)).status).toBe(404);
    expect((await patch("/api/admin/templates/tpl_b", sessions.uicAdmin, { name: "被改了" })).status).toBe(404);
    expect((await del("/api/admin/templates/tpl_b", sessions.uicAdmin)).status).toBe(404);
    expect(await one("SELECT name FROM stage_templates WHERE id='tpl_bd'")).toEqual({ name: "BD 查驗登記流程" });
    expect(await count("SELECT COUNT(*) AS n FROM stage_templates WHERE id='tpl_b'")).toBe(1);
    // 組別只能是自己公司的。
    expect((await post("/api/admin/templates", sessions.bAdmin, { name: "B 新範本", stages: ["a"], group_id: "grp_bd" })).status).toBe(422);
    expect((await patch("/api/admin/templates/tpl_b", sessions.bAdmin, { group_id: "grp_bd" })).status).toBe(422);
    // 兩家公司可以各有同名範本，同公司內重複才擋。
    const sameName = await post("/api/admin/templates", sessions.bAdmin, { name: "BD 查驗登記流程", stages: ["a", "b"], group_id: "gb_qa" });
    expect(sameName.status).toBe(201);
    expect(await one("SELECT company_id FROM stage_templates WHERE id=?", sameName.body.id)).toEqual({ company_id: "co_b" });
    expect((await post("/api/admin/templates", sessions.bAdmin, { name: "BD 查驗登記流程", stages: ["a"] })).status).toBe(422);
    // UIC 原本的管理行為不變。
    expect((await patch("/api/admin/templates/tpl_bd", sessions.uicAdmin, { name: "BD 流程（改）" })).status).toBe(200);
    expect((await del("/api/admin/templates/tpl_general", sessions.uicAdmin)).status).toBe(200);
  });
});

describe("UIC 原本的行為不變", () => {
  it("成員在自己的專案裡做事；同組成員可編輯、可見性規則照舊", async () => {
    const result = await post(`/api/projects/${uic.projectId}/tasks`, sessions.uicMember, { title: "新任務", stage_id: uic.stageId, assignee_id: "uic_qa" });
    expect(result.status).toBe(201);
    expect((await patch(`/api/tasks/${result.body.id}`, sessions.uicMember, { done: true })).status).toBe(200);
    const detail = (await get(`/api/projects/${uic.projectId}?sections=core,updates,clinical,bd`, sessions.uicAdmin)).body;
    expect(detail.tasks).toHaveLength(3);
    expect(detail.bd_cases).toHaveLength(1);
    expect(detail.permissions.can_manage).toBe(true);
    // 實習生看不到沒被指派的專案（未改變）。
    expect((await get(`/api/projects/${uic.projectId}`, await login("usr_intern1"))).status).toBe(403);
    // 刪除專案會清掉檔案物件。
    expect((await del(`/api/projects/${uic.projectId}`, sessions.uicAdmin)).status).toBe(200);
    expect(objects.has(`p/${uic.projectId}/${uic.fileId}/a.txt`)).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE id=?", other.projectId)).toBe(1);
  });

  it("系統管理員（UIC）只是 UIC 的管理員，看不到別家公司的專案", async () => {
    expect((await get(`/api/projects/${other.projectId}`, sessions.uicAdmin)).status).toBe(404);
    expect((await get("/api/projects", sessions.uicAdmin)).body.projects.map((p: { id: string }) => p.id)).not.toContain(other.projectId);
  });
});
