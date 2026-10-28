import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../worker/types";
import { internalApi } from "../worker/mcp/internal-api";
import { ToolError } from "../worker/mcp/protocol";
import { MCP_TOOLS, type ToolContext } from "../worker/mcp/tools";
import { healthState, HEALTH_STALE_DAYS } from "../src/project-health";
import { createTestD1 } from "./helpers/d1-sqlite";

/** 子任務（任務底下的檢查清單）與狀態燈號（進度紀錄上的順利／有風險／落後）。 */

let db: D1Database;
const person = (id: string, group: string) =>
  ({ id, email: `${id}@example.com`, name: id, role: "member", group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
const owner = person("owner", "grp_general");
const mate = person("mate", "grp_general");
const outsider = person("bd", "grp_bd");
const env = () => ({ DB: db, APP_BASE_URL: "http://127.0.0.1:8787" }) as unknown as Env;
const as = (user: AuthUser) => internalApi(env(), undefined, user);
const ctx = (user: AuthUser): ToolContext => ({ user, db, baseUrl: "http://127.0.0.1:8787", clientName: "Claude", api: as(user) });
const run = (name: string, args: Record<string, unknown>, user = owner) => MCP_TOOLS.find((tool) => tool.name === name)!.run(args, ctx(user)) as Promise<Record<string, any>>;
const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
async function fails(work: Promise<unknown>): Promise<string> {
  try { await work; } catch (error) { return error instanceof Error ? error.message : String(error); }
  throw new Error("預期要失敗");
}

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [owner, mate, outsider]) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p1','Plenvu 註冊','grp_general','owner','group','active','auto'),('p_secret','機密','grp_bd','bd','private','active','auto')").run();
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s1','p1','待辦','#888',0),('s2','p_secret','待辦','#888',0)").run();
  await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('t1','p1','s1','準備 Module 1',0),('t_secret','p_secret','s2','機密任務',0)").run();
});

describe("子任務", () => {
  it("新增、勾選、改名、指派與刪除；任務帶 2/4 的計數，但不影響專案自動進度", async () => {
    const api = as(owner);
    const a = await api.send<{ id: string }>("POST", "/api/tasks/t1/subtasks", { title: "CPP" });
    const b = await api.send<{ id: string }>("POST", "/api/tasks/t1/subtasks", { title: "LOA", assignee_id: "mate", due_date: "2026-11-10" });
    await api.send("PATCH", `/api/subtasks/${a.id}`, { done: true });
    const { subtasks } = await api.get<{ subtasks: Array<Record<string, unknown>> }>("/api/tasks/t1/subtasks");
    expect(subtasks.map((item) => [item.title, item.done, item.assignee_name ?? null, item.due_date])).toEqual([["CPP", 1, null, null], ["LOA", 0, "mate", "2026-11-10"]]);
    expect(subtasks[0].done_at).toBeTruthy();
    const detail = await api.get<{ tasks: Array<{ id: string; subtask_total: number; subtask_done: number }>; project: { progress: number } }>("/api/projects/p1");
    expect(detail.tasks.find((task) => task.id === "t1")).toMatchObject({ subtask_total: 2, subtask_done: 1 });
    expect(detail.project.progress).toBe(0); // 只算母任務：t1 還沒完成
    await api.send("PATCH", `/api/subtasks/${b.id}`, { title: "授權書 LOA", assignee_id: null, due_date: null });
    expect(await row("SELECT title,assignee_id,due_date FROM subtasks WHERE id=?", b.id)).toEqual({ title: "授權書 LOA", assignee_id: null, due_date: null });
    await api.send("PATCH", `/api/subtasks/${a.id}`, { done: false });
    expect(await row("SELECT done,done_at FROM subtasks WHERE id=?", a.id)).toEqual({ done: 0, done_at: null });
    await api.send("DELETE", `/api/subtasks/${a.id}`);
    expect(await row("SELECT COUNT(*) AS n FROM subtasks WHERE task_id='t1'")).toEqual({ n: 1 });
  });

  it("欄位驗證；刪除任務時子任務一起刪", async () => {
    const api = as(owner);
    expect(await fails(api.send("POST", "/api/tasks/t1/subtasks", { title: "  " }))).toContain("請輸入子任務名稱");
    expect(await fails(api.send("POST", "/api/tasks/t1/subtasks", { title: "x", due_date: "2026-02-30" }))).toContain("到期日");
    expect(await fails(api.send("POST", "/api/tasks/t1/subtasks", { title: "x", assignee_id: "nobody" }))).toContain("找不到負責人");
    await api.send("POST", "/api/tasks/t1/subtasks", { title: "CPP" });
    await db.prepare("DELETE FROM tasks WHERE id='t1'").run();
    expect(await row("SELECT COUNT(*) AS n FROM subtasks")).toEqual({ n: 0 });
  });

  it("權限跟著專案：看不到的專案碰不到，看得到但不能編輯的只能看", async () => {
    const created = await as(outsider).send<{ id: string }>("POST", "/api/tasks/t_secret/subtasks", { title: "機密子任務" });
    expect(await fails(as(owner).get("/api/tasks/t_secret/subtasks"))).toContain("沒有檢視權限");
    expect(await fails(as(owner).send("PATCH", `/api/subtasks/${created.id}`, { done: true }))).toContain("沒有編輯權限");
    expect(await fails(as(owner).send("DELETE", `/api/subtasks/${created.id}`))).toContain("沒有編輯權限");
    expect(await row("SELECT done FROM subtasks WHERE id=?", created.id)).toEqual({ done: 0 });
  });

  it("MCP：add／update／delete_subtask 走網站權限並記稽核；get_project 列出每個任務的子任務", async () => {
    const added = await run("add_subtask", { task_id: "t1", title: "取得 CPP", assignee: "mate", due_date: "2026-12-01" });
    expect(added).toMatchObject({ ok: true, task: "準備 Module 1", project: "Plenvu 註冊" });
    await run("update_subtask", { subtask_id: added.id, done: true });
    const project = await run("get_project", { project: "p1" });
    expect(project.board[0].tasks[0].subtasks).toEqual([{ id: added.id, title: "取得 CPP", done: true, assignee: "mate", due_date: "2026-12-01" }]);
    expect(await row("SELECT summary FROM audit_log WHERE action='mcp_update_subtask'")).toEqual({ summary: "經 AI 連接器（Claude）修改「Plenvu 註冊」任務「準備 Module 1」的子任務「取得 CPP」（done）" });
    await expect(run("add_subtask", { task_id: "t_secret", title: "x" })).rejects.toBeInstanceOf(ToolError);
    await expect(run("update_subtask", { subtask_id: added.id })).rejects.toThrow("沒有要修改的欄位");
    await run("delete_subtask", { subtask_id: added.id });
    expect(await row("SELECT COUNT(*) AS n FROM subtasks")).toEqual({ n: 0 });
    await expect(run("delete_subtask", { subtask_id: added.id })).rejects.toThrow("找不到子任務");
  });
});

describe("狀態燈號", () => {
  const health = () => row<{ health: string | null; health_at: string | null }>("SELECT health,health_at FROM projects WHERE id='p1'");

  it("發進度時標示，專案顯示最近一則的燈號；不標示的紀錄不會蓋掉", async () => {
    const api = as(owner);
    await api.send("POST", "/api/projects/p1/progress-updates", { content: "等 Hengoed 復工", health: "at_risk" });
    expect((await health())?.health).toBe("at_risk");
    await api.send("POST", "/api/projects/p1/progress-updates", { content: "補一句說明" });
    expect((await health())?.health).toBe("at_risk");
    const off = await api.send<{ id: string }>("POST", "/api/projects/p1/progress-updates", { content: "停擺到明年", health: "off_track" });
    expect((await health())?.health).toBe("off_track");
    expect(await fails(api.send("POST", "/api/projects/p1/progress-updates", { content: "x", health: "green" }))).toContain("狀態燈號");
    // 改掉最新那則的燈號、或刪掉它，專案回到前一則有標示的燈號。
    await api.send("PATCH", `/api/progress-updates/${off.id}`, { health: null });
    expect((await health())?.health).toBe("at_risk");
    expect(await row("SELECT summary FROM audit_log WHERE action='progress_edited'")).toMatchObject({ summary: expect.stringContaining("狀態燈號改為不標示") });
    await api.send("PATCH", `/api/progress-updates/${off.id}`, { health: "on_track" });
    expect((await health())?.health).toBe("on_track");
    await api.send("DELETE", `/api/progress-updates/${off.id}`);
    expect((await health())?.health).toBe("at_risk");
    const list = await api.get<{ projects: Array<{ id: string; health: string; health_at: string }> }>("/api/projects");
    expect(list.projects.find((project) => project.id === "p1")).toMatchObject({ health: "at_risk", health_at: expect.any(String) });
  });

  it("MCP：add_progress_update 可帶 health；list_projects／get_project 顯示燈號", async () => {
    await run("add_progress_update", { project: "p1", content: "送件延到 5 月底", health: "at_risk" });
    expect((await run("list_projects", {})).projects.find((project: { id: string }) => project.id === "p1")).toMatchObject({ health: "有風險" });
    const project = await run("get_project", { project: "p1" });
    expect(project.health).toBe("有風險");
    expect(project.recent_progress_updates[0]).toMatchObject({ health: "有風險" });
  });

  it("超過兩週沒再標示就算待更新", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    expect(healthState("on_track", "2026-10-20 08:00:00", now)).toMatchObject({ level: "on_track", stale: false });
    expect(healthState("off_track", "2026-10-01T00:00:00Z", now)).toMatchObject({ level: "off_track", stale: true });
    expect(healthState(null, null, now)).toMatchObject({ level: null, stale: false });
    expect(healthState("weird", "2026-10-27 00:00:00", now).level).toBeNull();
    expect(HEALTH_STALE_DAYS).toBe(14);
  });
});
