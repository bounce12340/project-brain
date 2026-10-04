import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../worker/types";
import { internalApi } from "../worker/mcp/internal-api";
import { ToolError } from "../worker/mcp/protocol";
import { MCP_TOOLS, type ToolContext } from "../worker/mcp/tools";
import { taipeiDate } from "../worker/services/time";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * AI 工具經 MCP 呼叫艾爾水晶：看得到、改得了的，和這個人在網站上一樣。
 * 工具走網站自己的 /api，所以這裡在套好 migrations 的 SQLite 上真的讀寫一次。
 */

let db: D1Database;
const person = (id: string, role: AuthUser["role"], group: string, name = id) =>
  ({ id, email: `${id}@example.com`, name, role, group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
const owner = person("owner", "member", "grp_general", "陳冠宇");
const mate = person("mate", "member", "grp_general", "同組同事");
const outsider = person("bd", "member", "grp_bd", "BD 同事");

const context = (user: AuthUser): ToolContext => ({ user, db, baseUrl: "http://127.0.0.1:8787", clientName: "Claude", api: internalApi({ DB: db, APP_BASE_URL: "http://127.0.0.1:8787" } as unknown as Env, undefined, user) });
async function run(name: string, args: Record<string, unknown>, user = owner) {
  const tool = MCP_TOOLS.find((item) => item.name === name)!;
  return tool.run(args, context(user)) as Promise<Record<string, any>>;
}
async function fails(name: string, args: Record<string, unknown>, user = owner): Promise<string> {
  try { await run(name, args, user); } catch (error) {
    if (error instanceof ToolError) return error.message;
    throw error;
  }
  throw new Error("預期要失敗");
}
const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
const shift = (days: number) => new Date(Date.parse(`${taipeiDate()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [owner, mate, outsider]) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
  const project = (id: string, name: string, owner: AuthUser, visibility = "group", extra: Record<string, string> = {}) =>
    db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode,description,goal_summary) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, name, owner.group_id, owner.id, visibility, extra.status ?? "active", "auto", extra.description ?? "", extra.goal ?? "").run();
  await project("p_qa", "QA：GDP/GMP", owner, "group", { description: "# 硬性規格\n- 效期 24 個月", goal: "年度查核" });
  await project("p_food", "全素低渣代餐包開發（24個月效期）", owner, "group");
  await project("p_mate", "同事的專案", mate, "group");
  await project("p_done", "已結案的專案", owner, "group", { status: "done" });
  await project("p_secret", "BD 的機密案", outsider, "private");
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s_todo','p_qa','待辦','#888',0),('s_doing','p_qa','進行中','#888',1),('s_done','p_qa','完成','#888',2),('s_bd','p_secret','待辦','#888',0)").run();
  await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,assignee_id,due_date,position) VALUES ('t_late','p_qa','s_doing','自我查核（HR）','owner',?,0),('t_soon','p_qa','s_todo','回收演練報告','owner',?,1),('t_far','p_qa','s_todo','年底盤點','owner',?,2),('t_bd','p_secret','s_bd','機密任務','owner',?,0)")
    .bind(shift(-2), shift(3), shift(60), shift(1)).run();
  await db.prepare("INSERT INTO milestones (id,project_id,title,due_date,done,position,kind) VALUES ('m1','p_qa','GMP 展延送件',?,0,0,'milestone'),('e1','p_qa','健亞訪廠',?,1,1,'event')").bind(shift(5), shift(-30)).run();
  await db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,created_at) VALUES ('u1','p_qa','owner','完成回收演練','2026-07-27T04:00:00.000Z')").run();
  await db.prepare("INSERT INTO todos (id,user_id,title,due_date) VALUES ('td1','owner','提醒 Hina 回信',?)").bind(shift(1)).run();
});

describe("讀取", () => {
  it("list_projects：只列看得到的；預設是進行中；可以只看自己的", async () => {
    const all = await run("list_projects", {});
    expect(all.projects.map((project: { name: string }) => project.name).sort()).toEqual(["QA：GDP/GMP", "全素低渣代餐包開發（24個月效期）", "同事的專案"].sort());
    expect(all.projects.find((project: { name: string }) => project.name === "QA：GDP/GMP")).toMatchObject({ status: "進行中", mine: true, objective: "年度查核" });
    expect((await run("list_projects", { mine: true })).projects.map((project: { name: string }) => project.name)).not.toContain("同事的專案");
    expect((await run("list_projects", { status: "done" })).projects.map((project: { name: string }) => project.name)).toEqual(["已結案的專案"]);
    expect((await run("list_projects", { keyword: "效期" })).count).toBe(2); // 名稱或背景裡有「效期」
  });

  it("get_project：用名稱找（全形半形不影響），帶出背景、看板、里程碑、歷程與進度紀錄", async () => {
    const project = await run("get_project", { project: "qa:gdp/gmp" });
    expect(project).toMatchObject({ id: "p_qa", name: "QA：GDP/GMP", background: "# 硬性規格\n- 效期 24 個月", objective: "年度查核", permissions: { can_edit: true, can_edit_background_and_objective: true } });
    expect(project.board.map((column: { stage: string; tasks: unknown[] }) => [column.stage, column.tasks.length])).toEqual([["待辦", 2], ["進行中", 1], ["完成", 0]]);
    expect(project.milestones).toEqual([{ id: "m1", title: "GMP 展延送件", date: shift(5), end_date: null, done: false }]);
    expect(project.history_events.map((event: { title: string }) => event.title)).toEqual(["健亞訪廠"]);
    expect(project.recent_progress_updates).toEqual([{ date: "2026-07-27", author: "陳冠宇", content: "完成回收演練" }]);
  });

  it("子專案：母專案列出子專案與進度，子專案說出母專案；清單標示母專案", async () => {
    await db.prepare("UPDATE projects SET parent_id='p_qa' WHERE id='p_food'").run();
    await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s_food','p_food','待辦','#888',0)").run();
    await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,done,due_date,position) VALUES ('f1','p_food','s_food','配方',1,NULL,0),('f2','p_food','s_food','安定性',0,?,1)").bind(shift(-1)).run();
    const parent = await run("get_project", { project: "p_qa" });
    expect(parent.progress_mode).toBe("自動（依任務與里程碑，含子專案）");
    expect(parent.sub_projects).toEqual([expect.objectContaining({ id: "p_food", name: "全素低渣代餐包開發（24個月效期）", owner: "陳冠宇", tasks_done: 1, tasks_total: 2, overdue_tasks: 1 })]);
    expect(await run("get_project", { project: "p_food" })).toMatchObject({ parent: "QA：GDP/GMP" });
    expect((await run("list_projects", {})).projects.find((project: { id: string }) => project.id === "p_food")).toMatchObject({ parent: "QA：GDP/GMP" });
  });

  it("名稱只打一部分也行，只要不會對到兩個", async () => {
    expect((await run("get_project", { project: "代餐包" })).id).toBe("p_food");
    expect(await fails("get_project", { project: "專案" })).toContain("對到好幾個專案");
  });

  it("看不到的專案：用名稱找不到，用 id 也被擋，而且不會提示別人私人專案的名稱", async () => {
    const byName = await fails("get_project", { project: "BD 的機密案" });
    expect(byName).toContain("找不到專案「BD 的機密案」");
    expect(byName).not.toContain("是不是");
    expect(await fails("get_project", { project: "p_secret" })).toContain("找不到專案");
  });

  it("list_my_work：逾期、接下來兩週、個人待辦；看不到的專案的任務不列", async () => {
    const work = await run("list_my_work", {});
    expect(work.overdue.map((item: { title: string }) => item.title)).toEqual(["自我查核（HR）"]);
    expect(work.upcoming.map((item: { title: string }) => item.title)).toEqual(["提醒 Hina 回信", "回收演練報告", "GMP 展延送件"]);
    expect(JSON.stringify(work)).not.toContain("機密任務");
    expect((await run("list_my_work", { days_ahead: 90 })).upcoming.map((item: { title: string }) => item.title)).toContain("年底盤點");
  });
});

describe("寫入", () => {
  it("add_progress_update：記在使用者名下，稽核紀錄寫明經哪個 AI 工具", async () => {
    const result = await run("add_progress_update", { project: "QA：GDP/GMP", content: "與 IT 確認電腦確效時程" });
    expect(await row("SELECT author_id, content FROM progress_updates WHERE id=?", result.id)).toEqual({ author_id: "owner", content: "與 IT 確認電腦確效時程" });
    expect(await row("SELECT action, summary FROM audit_log WHERE entity_id=?", result.id)).toEqual({ action: "mcp_add_progress_update", summary: "經 AI 連接器（Claude）新增進度紀錄到「QA：GDP/GMP」" });
  });

  it("沒有編輯權的專案寫不進去，錯誤訊息原樣給 AI", async () => {
    expect(await fails("add_progress_update", { project: "p_qa", content: "x" }, outsider)).toBe("找不到專案「p_qa」。可以先用 list_projects 查專案名稱。");
  });

  it("create_task：預設放第一欄；可指定欄位、負責人（姓名或 Email）、開始與到期日", async () => {
    const first = await run("create_task", { project: "p_qa", title: "準備 GMP 展延資料" });
    expect(await row("SELECT stage_id, assignee_id FROM tasks WHERE id=?", first.id)).toEqual({ stage_id: "s_todo", assignee_id: null });
    const second = await run("create_task", { project: "p_qa", title: "確認儲位", stage: "進行中", assignee: "同組同事", start_date: "2026-10-01", due_date: "2026-10-15" });
    expect(await row("SELECT stage_id, assignee_id, start_date, due_date FROM tasks WHERE id=?", second.id)).toEqual({ stage_id: "s_doing", assignee_id: "mate", start_date: "2026-10-01", due_date: "2026-10-15" });
    expect((await row<{ summary: string }>("SELECT summary FROM audit_log WHERE entity_id=?", second.id))?.summary).toBe("經 AI 連接器（Claude）在「QA：GDP/GMP」建立任務「確認儲位」（進行中）");
  });

  it("create_task：沒有的欄位列出現有欄位；日期顛倒、找不到負責人都擋下", async () => {
    expect(await fails("create_task", { project: "p_qa", title: "x", stage: "審查中" })).toBe("看板上沒有「審查中」這個欄位。現有欄位：「待辦」、「進行中」、「完成」");
    expect(await fails("create_task", { project: "p_qa", title: "x", start_date: "2026-10-02", due_date: "2026-10-01" })).toBe("開始日不能晚於到期日");
    expect(await fails("create_task", { project: "p_qa", title: "x", assignee: "不存在的人" })).toBe("找不到使用者「不存在的人」。請用系統上的姓名或 Email。");
    expect(await fails("create_task", { project: "p_food", title: "x" })).toContain("看板還沒有任何欄位");
  });

  it("update_task：勾選完成會重算自動進度；可移欄、清掉日期", async () => {
    await run("update_task", { task_id: "t_late", done: true, stage: "完成", due_date: "" });
    expect(await row("SELECT done, stage_id, due_date FROM tasks WHERE id='t_late'")).toEqual({ done: 1, stage_id: "s_done", due_date: null });
    expect((await row<{ progress: number }>("SELECT progress FROM projects WHERE id='p_qa'"))?.progress).toBeGreaterThan(0);
    expect(await fails("update_task", { task_id: "t_late" })).toBe("沒有要修改的欄位");
  });

  it("update_task：看不到的專案裡的任務改不了", async () => {
    expect(await fails("update_task", { task_id: "t_bd", done: true })).toBe("沒有檢視權限");
    expect(await row("SELECT done FROM tasks WHERE id='t_bd'")).toEqual({ done: 0 });
  });

  it("add_milestone：里程碑與歷程事件；已達成的里程碑直接標完成", async () => {
    const milestone = await run("add_milestone", { project: "p_qa", title: "取得 GMP 展延", date: "2027-05-31", done: true });
    const event = await run("add_milestone", { project: "p_qa", title: "TFDA 回電說明", date: "2026-08-10", kind: "event" });
    expect(await row("SELECT kind, done FROM milestones WHERE id=?", milestone.id)).toEqual({ kind: "milestone", done: 1 });
    expect(await row("SELECT kind, due_date FROM milestones WHERE id=?", event.id)).toEqual({ kind: "event", due_date: "2026-08-10" });
  });

  it("update_milestone：標完成、改日期", async () => {
    await run("update_milestone", { milestone_id: "m1", done: true, date: "2026-12-01" });
    expect(await row("SELECT done, due_date FROM milestones WHERE id='m1'")).toEqual({ done: 1, due_date: "2026-12-01" });
  });

  it("update_project_background：擁有者可以改背景與目標；同組成員不行", async () => {
    await run("update_project_background", { project: "p_food", background: "# 背景\n取代味噌湯米粉", objective: "三款上市" });
    expect(await row("SELECT description, goal_summary FROM projects WHERE id='p_food'")).toEqual({ description: "# 背景\n取代味噌湯米粉", goal_summary: "三款上市" });
    expect(await fails("update_project_background", { project: "p_food", objective: "亂改" }, mate)).toBe("只有 owner 或管理員可修改專案設定");
  });

  it("日期不存在（2 月 30 日）在送出前就擋下", async () => {
    expect(await fails("add_milestone", { project: "p_qa", title: "x", date: "2026-02-30" })).toBe("日期不是有效日期：2026-02-30");
  });
});

describe("擴充工具", () => {
  it("search/fetch：可引用的來源、包含結案專案，但不能搜尋或取得別人的機密", async () => {
    const searched = await run("search", { query: "QA" });
    expect(searched.results).toEqual([{ id: "p_qa", title: "QA：GDP/GMP", url: "http://127.0.0.1:8787/projects/p_qa" }]);
    expect((await run("search", { query: "結案" })).results).toHaveLength(1);
    expect((await run("search", { query: "機密" })).results).toEqual([]);
    const fetched = await run("fetch", { id: "p_qa" });
    expect(fetched).toMatchObject({ id: "p_qa", title: "QA：GDP/GMP", url: searched.results[0].url });
    expect(JSON.parse(fetched.text)).toMatchObject({ background: "# 硬性規格\n- 效期 24 個月" });
    expect(await fails("fetch", { id: "p_secret" })).toContain("沒有檢視權限");
    expect(await fails("fetch", { id: "QA" })).toContain("找不到專案");
  });

  it("個人待辦：新增、完成、清日期、稽核與擁有者限制", async () => {
    const added = await run("create_todo", { title: "聯絡 IT", due_date: "2026-12-01", project: "p_qa" });
    expect(await row("SELECT user_id,project_id,due_date FROM todos WHERE id=?", added.id)).toEqual({ user_id: owner.id, project_id: "p_qa", due_date: "2026-12-01" });
    expect((await run("list_todos", { limit: 1 })).truncated).toBe(true);
    await run("update_todo", { todo_id: added.id, done: true, due_date: "", title: "已聯絡 IT" });
    expect(await row("SELECT done,due_date,title FROM todos WHERE id=?", added.id)).toEqual({ done: 1, due_date: null, title: "已聯絡 IT" });
    expect((await run("list_todos", { status: "done" })).todos.map((t: { id: string }) => t.id)).toContain(added.id);
    expect(await fails("update_todo", { todo_id: added.id, done: false }, mate)).toBe("找不到待辦事項");
    expect(await row("SELECT COUNT(*) AS n FROM audit_log WHERE action='mcp_update_todo' AND entity_id=?", added.id)).toEqual({ n: 1 });
    expect(await fails("create_todo", { title: "x", due_date: "2026-02-30" })).toContain("有效日期");
    expect(await fails("create_todo", { title: "x", project: "p_secret" })).toContain("找不到專案");
    expect(await fails("update_todo", { todo_id: added.id })).toBe("沒有要修改的欄位");
    expect(await fails("update_todo", { todo_id: added.id, title: "   " })).toBe("請輸入待辦事項");
  });

  it("待辦關聯專案失去可見性後，list_todos 不洩漏專案資訊", async () => {
    await db.prepare("INSERT INTO todos (id,user_id,title,project_id) VALUES ('hidden_todo','owner','秘密','p_secret')").run();
    expect((await run("list_todos", {})).todos.map((t: { id: string }) => t.id)).not.toContain("hidden_todo");
    expect((await run("list_my_work", { include_undated: true })).undated.map((t: { id: string }) => t.id)).not.toContain("hidden_todo");
  });

  it("會議與外訓：台北時間、分類、專案權限、查詢與建立稽核", async () => {
    const meeting = await run("create_meeting", { title: "GDP 討論", starts_at: "2026-10-04T10:00", ends_at: "2026-10-04T11:00", project: "QA：GDP/GMP", summary: "確認查核文件" });
    await run("create_meeting", { title: "隱密", starts_at: "2026-10-04T12:00", project: "p_secret" }, outsider);
    await run("create_meeting", { kind: "course", title: "藥品課程", category: "drug", starts_at: "2026-10-05T09:00" });
    const listed = await run("list_meetings", { from: "2026-10-04", to: "2026-10-04", keyword: "查核" });
    expect(listed.meetings.map((m: { id: string }) => m.id)).toEqual([meeting.id]);
    expect(listed.timezone).toBe("Asia/Taipei");
    expect((await run("list_meetings", { kind: "course" })).count).toBe(1);
    expect((await run("list_meetings", {})).count).toBe(2);
    expect(await row("SELECT summary FROM audit_log WHERE action='mcp_create_meeting' AND entity_id=?", meeting.id)).toEqual({ summary: "經 AI 連接器（Claude）新增會議紀錄「GDP 討論」" });
    expect(await fails("create_meeting", { title: "x", starts_at: "2026-02-30T10:00" })).toBe("請填寫開始時間");
    expect(await fails("create_meeting", { title: "x", starts_at: "2026-10-04T11:00", ends_at: "2026-10-04T10:00" })).toContain("不能早於");
    expect(await fails("list_meetings", { from: "2026-10-05", to: "2026-10-04" })).toContain("不能晚於");
  });

  it("聯絡人搜尋與已發布法規查詢：限制輸出，不帶審核草稿", async () => {
    await db.prepare("INSERT INTO contacts (id,organization,name,email) VALUES ('ct1','醫院','林醫師','LIN@example.com'),('ct2','公司','王先生','wang@example.com')").run();
    expect((await run("search_contacts", { query: "lin@" })).contacts.map((c: { id: string }) => c.id)).toEqual(["ct1"]);
    expect((await run("search_contacts", { query: "公司", limit: 1 })).count).toBe(1);
    await db.prepare("DELETE FROM reg_entries").run();
    await db.prepare("INSERT INTO reg_entries (id,title,entry_date,product_line,entry_type,status) VALUES ('reg1','藥品公告','2026-10-01','藥品','announcement','published'),('reg2','藥品草稿','2026-10-02','藥品','announcement','draft')").run();
    const regs = await run("list_regulations", { keyword: "藥品", year: 2026 });
    expect(regs.entries.map((r: { id: string }) => r.id)).toEqual(["reg1"]);
    expect(regs).not.toHaveProperty("pending_count");
  });
});
