import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 子專案：「預算管理」底下掛「預算小組」「業務」等，各自有看板與進度，
 * 母專案頁列出子專案，母專案的自動進度把子專案的項目一起算。只有一層。
 */

const BASE = "http://127.0.0.1:8787";
let env: Env;
const sessions: Record<string, string> = {};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const as = (userId: string, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}/api${path}`, { ...init, headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
const send = (userId: string, method: string, path: string, body?: unknown) => as(userId, path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const createProject = async (userId: string, body: Record<string, unknown>) => {
  const response = await send(userId, "POST", "/projects", { group_id: "grp_qa", visibility: "group", ...body });
  const json = await response.json() as { id?: string; error?: string };
  return { status: response.status, id: json.id, error: json.error };
};
const detail = async (userId: string, id: string) => (await (await as(userId, `/projects/${id}`)).json()) as { project: { progress: number; parent_id: string | null; group_id: string; visibility: string }; parent: { id: string; name: string } | null; children: Array<{ id: string; name: string; progress: number; task_total: number; task_done: number; task_overdue: number; owner_name: string }>; stages: Array<{ id: string; name: string; color: string }> };
const row = (id: string) => env.DB.prepare("SELECT parent_id, progress FROM projects WHERE id=?").bind(id).first<{ parent_id: string | null; progress: number }>();

let parentId: string;

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES
    ('elvis','elvis@example.com','Elvis','x','member','grp_qa',0),
    ('mate','mate@example.com','同組同事','x','member','grp_qa',0),
    ('intern','intern@example.com','實習生','x','intern','grp_qa',0),
    ('boss','boss@example.com','管理者','x','admin','grp_general',0)`).run();
  for (const id of ["elvis", "mate", "intern", "boss"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
  parentId = (await createProject("elvis", { name: "預算管理", visibility: "private", product: "2027 預算" })).id!;
  await db.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES (?, 'mate', 'elvis')").bind(parentId).run();
  await db.batch(["待辦", "進行中", "完成"].map((name, position) => db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES (?,?,?,?,?)").bind(`stage_p${position}`, parentId, name, ["#0284c7", "#d97706", "#15803d"][position], position)));
});

describe("建立子專案", () => {
  it("沿用母專案的組別、可見性、產品、成員與看板欄位；稽核寫明掛在哪個母專案底下", async () => {
    const { status, id } = await createProject("elvis", { name: "預算管理：業務", parent_id: parentId, group_id: "grp_general", visibility: "all" });
    expect(status).toBe(201);
    const child = await detail("elvis", id!);
    expect(child.project).toMatchObject({ parent_id: parentId, group_id: "grp_qa", visibility: "private" });
    expect(child.parent).toEqual({ id: parentId, name: "預算管理" });
    expect(child.stages.map((stage) => [stage.name, stage.color])).toEqual([["待辦", "#0284c7"], ["進行中", "#d97706"], ["完成", "#15803d"]]);
    // 母專案的成員看得到私人子專案。
    expect((await as("mate", `/projects/${id}`)).status).toBe(200);
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_id=?").bind(id).first()).toEqual({ summary: "在「預算管理」底下建立子專案「預算管理：業務」" });
  });

  it("母專案頁列出子專案，附任務完成數與逾期數", async () => {
    const sales = (await createProject("elvis", { name: "預算管理：業務", parent_id: parentId })).id!;
    await createProject("elvis", { name: "預算管理：財務", parent_id: parentId });
    const stage = (await detail("elvis", sales)).stages[0].id;
    await env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,done,due_date) VALUES ('t1',?,?,'Key in',1,NULL),('t2',?,?,'報告',0,'2020-01-01'),('t3',?,?,'預測',0,NULL)").bind(sales, stage, sales, stage, sales, stage).run();
    const parent = await detail("elvis", parentId);
    expect(parent.parent).toBeNull();
    expect(parent.children.map((child) => [child.name, child.task_total, child.task_done, child.task_overdue, child.owner_name])).toEqual([
      ["預算管理：業務", 3, 1, 1, "Elvis"],
      ["預算管理：財務", 0, 0, 0, "Elvis"],
    ]);
  });

  it("只有一層：子專案底下不能再建子專案", async () => {
    const child = (await createProject("elvis", { name: "預算管理：業務", parent_id: parentId })).id!;
    const nested = await createProject("elvis", { name: "北區", parent_id: child });
    expect(nested.status).toBe(422);
    expect(nested.error).toBe("「預算管理：業務」本身是子專案，底下不能再掛子專案");
  });

  it("只有母專案的負責人或管理員能加子專案；實習生不能建專案", async () => {
    expect((await createProject("mate", { name: "預算管理：行銷", parent_id: parentId })).status).toBe(403);
    expect((await createProject("intern", { name: "預算管理：行銷", parent_id: parentId })).status).toBe(403);
    expect((await createProject("boss", { name: "預算管理：行銷", parent_id: parentId })).status).toBe(201);
    expect((await createProject("elvis", { name: "x", parent_id: "prj_nope" })).status).toBe(404);
  });
});

describe("母專案的整體進度", () => {
  it("把子專案的任務與里程碑一起算；子專案的任務一勾完成，母專案跟著更新", async () => {
    const sales = (await createProject("elvis", { name: "預算管理：業務", parent_id: parentId })).id!;
    const stage = (await detail("elvis", sales)).stages[0].id;
    await env.DB.prepare("INSERT INTO milestones (id,project_id,title,due_date,kind,done) VALUES ('m1',?,'BP-M26005','2026-11-07','milestone',0)").bind(parentId).run();
    for (const title of ["Key in", "報告", "預測"]) expect((await send("elvis", "POST", `/projects/${sales}/tasks`, { title, stage_id: stage })).status).toBe(201);
    expect((await row(parentId))!.progress).toBe(0);
    const task = await env.DB.prepare("SELECT id FROM tasks WHERE project_id=? AND title='Key in'").bind(sales).first<string>("id");
    expect((await send("elvis", "PATCH", `/tasks/${task}`, { done: true })).status).toBe(200);
    expect((await row(sales))!.progress).toBe(33); // 子專案：1/3
    expect((await row(parentId))!.progress).toBe(25); // 整體：1/(3 任務 + 1 里程碑)
  });
});

describe("移動", () => {
  it("把既有專案移到母專案底下、再移出；兩邊的進度都重算並記稽核", async () => {
    const other = (await createProject("elvis", { name: "CRM 系統" })).id!;
    await env.DB.prepare("INSERT INTO stages (id,project_id,name,position) VALUES ('s_crm',?,'待辦',0)").bind(other).run();
    await env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,done) VALUES ('c1',?,'s_crm','上線',1)").bind(other).run();
    expect((await send("elvis", "PATCH", `/projects/${other}`, { parent_id: parentId })).status).toBe(200);
    expect(await row(other)).toMatchObject({ parent_id: parentId });
    expect((await row(parentId))!.progress).toBe(100);
    expect((await send("elvis", "PATCH", `/projects/${other}`, { parent_id: null })).status).toBe(200);
    expect(await row(other)).toMatchObject({ parent_id: null });
    expect((await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_id=? AND action='update' ORDER BY created_at, rowid").bind(other).all()).results).toEqual([
      { summary: "移到「預算管理」底下當子專案" },
      { summary: "移出母專案，變回一般專案" },
    ]);
  });

  it("已經有子專案的專案不能變成別人的子專案；也不能掛在自己底下", async () => {
    const other = (await createProject("elvis", { name: "另一個大專案" })).id!;
    await createProject("elvis", { name: "預算管理：業務", parent_id: parentId });
    expect((await send("elvis", "PATCH", `/projects/${parentId}`, { parent_id: other })).status).toBe(422);
    expect((await send("elvis", "PATCH", `/projects/${other}`, { parent_id: other })).status).toBe(422);
  });

  it("不是這個專案的負責人不能移動它", async () => {
    const mine = (await createProject("mate", { name: "同事的專案" })).id!;
    expect((await send("elvis", "PATCH", `/projects/${mine}`, { parent_id: parentId })).status).toBe(403);
  });
});

describe("刪除", () => {
  it("刪掉子專案，母專案進度重算；刪掉母專案，子專案變回一般專案", async () => {
    const sales = (await createProject("elvis", { name: "預算管理：業務", parent_id: parentId })).id!;
    const finance = (await createProject("elvis", { name: "預算管理：財務", parent_id: parentId })).id!;
    const stage = (await detail("elvis", sales)).stages[0].id;
    await env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,done) VALUES ('d1',?,?,'做完',0)").bind(sales, stage).run();
    const financeStage = (await detail("elvis", finance)).stages[0].id;
    await env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,done) VALUES ('d2',?,?,'還沒',0)").bind(finance, financeStage).run();
    await send("elvis", "PATCH", `/tasks/d1`, { done: true });
    expect((await row(parentId))!.progress).toBe(50);
    expect((await send("elvis", "DELETE", `/projects/${finance}`)).status).toBe(200);
    expect((await row(parentId))!.progress).toBe(100);
    expect((await send("elvis", "DELETE", `/projects/${parentId}`)).status).toBe(200);
    expect(await row(sales)).toMatchObject({ parent_id: null });
  });
});
