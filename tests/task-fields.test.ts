import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../worker/types";
import { internalApi } from "../worker/mcp/internal-api";
import { MCP_TOOLS, type ToolContext } from "../worker/mcp/tools";
import { cleanFieldValue, cleanOptions } from "../worker/services/task-fields";
import { createTestD1 } from "./helpers/d1-sqlite";

/** 任務自訂欄位：每個專案自己定義，網站與 MCP 都能填。 */

let db: D1Database;
const person = (id: string, group: string, role = "member") => ({ id, email: `${id}@example.com`, name: id, role, group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
const owner = person("owner", "grp_general");
const outsider = person("bd", "grp_bd");
const as = (user: AuthUser) => internalApi({ DB: db, APP_BASE_URL: "http://127.0.0.1:8787" } as unknown as Env, undefined, user);
const ctx = (user: AuthUser): ToolContext => ({ user, db, baseUrl: "http://127.0.0.1:8787", clientName: "Claude", api: as(user) });
const run = (name: string, args: Record<string, unknown>) => MCP_TOOLS.find((tool) => tool.name === name)!.run(args, ctx(owner)) as Promise<Record<string, any>>;
const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
async function fails(work: Promise<unknown>): Promise<string> {
  try { await work; } catch (error) { return error instanceof Error ? error.message : String(error); }
  throw new Error("預期要失敗");
}

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [owner, outsider]) await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p1','Plenvu','grp_general','owner','group','active','auto'),('p2','別組','grp_bd','bd','group','active','auto')").run();
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s1','p1','待辦','#888',0)").run();
  await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('t1','p1','s1','CPP',0),('t2','p1','s1','LOA',1)").run();
});

describe("欄位值的檢查", () => {
  const select = { name: "類型", type: "select" as const, options: ["CMC", "臨床"] };
  it("各型別", () => {
    expect(cleanFieldValue(select, "CMC")).toEqual({ value: "CMC" });
    expect(cleanFieldValue(select, "行政")).toMatchObject({ error: expect.stringContaining("只能選") });
    expect(cleanFieldValue({ ...select, type: "number" }, "1,200")).toEqual({ value: "1200" });
    expect(cleanFieldValue({ ...select, type: "number" }, "abc")).toMatchObject({ error: expect.stringContaining("數字") });
    expect(cleanFieldValue({ ...select, type: "date" }, "2026-02-30")).toMatchObject({ error: expect.any(String) });
    expect(cleanFieldValue({ ...select, type: "text" }, "  ")).toEqual({ value: null });
    expect(cleanOptions([" A ", "A", "", "B"])).toEqual(["A", "B"]);
    expect(cleanOptions([])).toMatchObject({ error: expect.any(String) });
  });
});

describe("/api 任務自訂欄位", () => {
  it("新增欄位、填值、專案內頁帶回；改選項會清掉拿掉的值；刪欄位一併刪值", async () => {
    const api = as(owner);
    const type = await api.send<{ id: string }>("POST", "/api/projects/p1/task-fields", { name: "文件類型", type: "select", options: ["CMC", "臨床", "行政"] });
    const round = await api.send<{ id: string }>("POST", "/api/projects/p1/task-fields", { name: "審查輪次", type: "number" });
    expect(await fails(api.send("POST", "/api/projects/p1/task-fields", { name: "文件類型", type: "text" }))).toContain("已經有");
    expect(await fails(api.send("POST", "/api/projects/p1/task-fields", { name: "x", type: "select", options: [] }))).toContain("至少");
    await api.send("PUT", "/api/tasks/t1/fields", { [type.id]: "行政", [round.id]: 2 });
    await api.send("PUT", "/api/tasks/t2/fields", { [type.id]: "CMC" });
    const detail = await api.get<{ task_fields: Array<{ id: string; name: string; options: string[] }>; tasks: Array<{ id: string; fields: Record<string, string> }> }>("/api/projects/p1");
    expect(detail.task_fields.map((field) => field.name)).toEqual(["文件類型", "審查輪次"]);
    expect(detail.tasks.find((task) => task.id === "t1")?.fields).toEqual({ [type.id]: "行政", [round.id]: "2" });
    expect(await fails(api.send("PUT", "/api/tasks/t1/fields", { [type.id]: "不存在" }))).toContain("只能選");
    await api.send("PUT", "/api/tasks/t1/fields", { [round.id]: null });
    expect(await row("SELECT COUNT(*) AS n FROM task_field_values WHERE task_id='t1'")).toEqual({ n: 1 });
    await api.send("PATCH", `/api/task-fields/${type.id}`, { name: "文件別", options: ["CMC", "臨床"] });
    expect(await row("SELECT value FROM task_field_values WHERE task_id='t1' AND field_id=?", type.id)).toBeNull();
    expect(await row("SELECT value FROM task_field_values WHERE task_id='t2' AND field_id=?", type.id)).toEqual({ value: "CMC" });
    await api.send("DELETE", `/api/task-fields/${type.id}`);
    expect(await row("SELECT COUNT(*) AS n FROM task_field_values")).toEqual({ n: 0 });
  });

  it("權限跟著專案；別的專案的欄位不能填", async () => {
    expect(await fails(as(outsider).send("POST", "/api/projects/p1/task-fields", { name: "x", type: "text" }))).toContain("沒有編輯權限");
    const other = await as(outsider).send<{ id: string }>("POST", "/api/projects/p2/task-fields", { name: "別組欄位", type: "text" });
    expect(await fails(as(owner).send("PUT", "/api/tasks/t1/fields", { [other.id]: "x" }))).toContain("不屬於此專案");
    expect(await fails(as(owner).send("DELETE", `/api/task-fields/${other.id}`))).toContain("沒有編輯權限");
  });
});

describe("MCP 的自訂欄位", () => {
  it("get_project 列出欄位定義與每個任務的值；create_task／update_task 用欄位名稱填值", async () => {
    await as(owner).send("POST", "/api/projects/p1/task-fields", { name: "文件類型", type: "select", options: ["CMC", "臨床"] });
    const created = await run("create_task", { project: "p1", title: "仿單", fields: { 文件類型: "臨床" } });
    await run("update_task", { task_id: "t1", fields: { 文件類型: "CMC" } });
    const project = await run("get_project", { project: "p1" });
    expect(project.custom_fields).toEqual([{ name: "文件類型", type: "select", options: ["CMC", "臨床"] }]);
    const tasks = project.board[0].tasks as Array<{ id: string; fields?: Record<string, string> }>;
    expect(tasks.find((task) => task.id === "t1")?.fields).toEqual({ 文件類型: "CMC" });
    expect(tasks.find((task) => task.id === created.id)?.fields).toEqual({ 文件類型: "臨床" });
    await expect(run("update_task", { task_id: "t1", fields: { 不存在: "x" } })).rejects.toThrow("這個專案的欄位：文件類型");
    await run("update_task", { task_id: "t1", fields: { 文件類型: "" } });
    expect(await row("SELECT COUNT(*) AS n FROM task_field_values WHERE task_id='t1'")).toEqual({ n: 0 });
  });
});
