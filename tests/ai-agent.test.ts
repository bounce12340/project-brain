import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../worker/types";
import { ToolError } from "../worker/mcp/protocol";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { MAX_ORGANIZE_ACTIONS, assistantContext, executeAssistantAction, runAssistantTurn } from "../worker/services/ai-agent";
import { createMemoryKV } from "./helpers/memory-kv";
import { ToolCallingUnavailable } from "../worker/services/llm";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * AI 小幫手的操作：查資料的工具當場執行；會改資料的只變成確認卡，
 * 使用者按「確認」才經 executeAssistantAction 以本人身分執行。
 */

let db: D1Database;
const person = (id: string, group: string, name = id) =>
  ({ id, email: `${id}@example.com`, name, role: "member", group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
const owner = person("owner", "grp_general", "陳冠宇");
const outsider = person("bd", "grp_bd", "BD 同事");
const env = () => ({ DB: db, APP_BASE_URL: "http://127.0.0.1:8787", LLM_API_KEY: "test", LLM_BASE_URL: "https://llm.test", LLM_MODEL: "m" }) as unknown as Env;
const ctx = (user = owner) => assistantContext(env(), undefined, user);

type Reply = { content?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> };
/** 依序回覆的假語言模型；記下每次收到的 messages。 */
function fakeLlm(replies: Reply[]) {
  const seen: Array<Array<Record<string, unknown>>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)).messages);
    const reply = replies.shift() ?? { content: "（沒有更多回覆）" };
    const tool_calls = reply.calls?.map((call, index) => ({ id: `call_${seen.length}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }));
    return new Response(JSON.stringify({ choices: [{ message: { content: reply.content ?? null, tool_calls } }] }), { headers: { "Content-Type": "application/json" } });
  }));
  return seen;
}
const ask = (question: string, user = owner) => runAssistantTurn(env(), ctx(user), { question, history: [], lang: "zh", openProject: null });
const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [owner, outsider]) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p_qa','QA：GDP/GMP','grp_general','owner','group','active','auto'),('p_secret','BD 的機密案','grp_bd','bd','private','active','auto')").run();
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s_todo','p_qa','待辦','#888',0),('s_bd','p_secret','待辦','#888',0)").run();
  await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('t1','p_qa','s_todo','回收演練報告',0),('t_bd','p_secret','s_bd','機密任務',0)").run();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("一輪對話", () => {
  it("查資料的工具當場執行，結果交回 AI 再回答", async () => {
    const seen = fakeLlm([{ calls: [{ name: "list_projects", args: {} }] }, { content: "你有 1 個進行中的專案。" }]);
    const turn = await ask("我有哪些專案？");
    expect(turn).toMatchObject({ reply: "你有 1 個進行中的專案。", actions: [] });
    const toolMessage = seen[1].find((message) => message.role === "tool");
    expect(String(toolMessage?.content)).toContain("QA：GDP/GMP");
    expect(String(toolMessage?.content)).not.toContain("BD 的機密案");
  });

  it("會改資料的工具不執行，變成確認卡，名稱換成看得懂的字", async () => {
    fakeLlm([{ content: "請確認：", calls: [{ name: "update_task", args: { task_id: "t1", done: true, due_date: "2026-11-30" } }] }]);
    const turn = await ask("回收演練報告完成了");
    expect(turn.reply).toBe("請確認：");
    expect(turn.actions).toHaveLength(1);
    expect(turn.actions[0]).toMatchObject({ tool: "update_task", destructive: false, args: { task_id: "t1", done: true, due_date: "2026-11-30" } });
    expect(turn.actions[0].lines).toEqual(["任務：回收演練報告（QA：GDP/GMP）", "完成：是", "到期日：2026-11-30"]);
    expect(await row<{ done: number; due_date: string | null }>("SELECT done,due_date FROM tasks WHERE id='t1'")).toEqual({ done: 0, due_date: null });
  });

  it("刪除標成危險動作", async () => {
    fakeLlm([{ calls: [{ name: "delete_task", args: { task_id: "t1" } }] }]);
    const turn = await ask("刪掉回收演練報告");
    expect(turn.actions[0]).toMatchObject({ tool: "delete_task", destructive: true });
    expect(await row("SELECT id FROM tasks WHERE id='t1'")).toBeTruthy();
  });

  it("看不到的東西不會出現在確認卡上，AI 收到錯誤", async () => {
    const seen = fakeLlm([{ calls: [{ name: "update_task", args: { task_id: "t_bd", done: true } }] }, { content: "找不到這個任務。" }]);
    const turn = await ask("把機密任務標完成");
    expect(turn.actions).toEqual([]);
    expect(String(seen[1].find((message) => message.role === "tool")?.content)).toMatch(/^失敗：/);
    expect(String(seen[1].find((message) => message.role === "tool")?.content)).not.toContain("機密任務");
  });

  it("參數不合格的呼叫不會變成確認卡", async () => {
    fakeLlm([{ calls: [{ name: "update_task", args: { task_id: "t1", due_date: "明天" } }] }, { content: "日期格式不對。" }]);
    expect((await ask("改到明天")).actions).toEqual([]);
  });

  it("沒有金鑰時丟 ToolCallingUnavailable，讓前端退回純問答", async () => {
    const noKey = { ...env(), LLM_API_KEY: undefined } as unknown as Env;
    await expect(runAssistantTurn(noKey, ctx(), { question: "hi", history: [], lang: "zh", openProject: null })).rejects.toBeInstanceOf(ToolCallingUnavailable);
  });
});

describe("按下確認", () => {
  it("以本人身分執行並記稽核「經 AI 小幫手」", async () => {
    await executeAssistantAction(ctx(), "update_task", { task_id: "t1", done: true });
    expect((await row<{ done: number }>("SELECT done FROM tasks WHERE id='t1'"))?.done).toBe(1);
    expect(await row("SELECT action,summary FROM audit_log WHERE entity_id='t1'")).toEqual({ action: "mcp_update_task", summary: "經 AI 小幫手修改「QA：GDP/GMP」的任務「回收演練報告」（done）" });
  });

  it("沒有權限的人照樣被擋", async () => {
    await expect(executeAssistantAction(ctx(outsider), "update_task", { task_id: "t1", done: true })).rejects.toBeInstanceOf(ToolError);
    expect((await row<{ done: number }>("SELECT done FROM tasks WHERE id='t1'"))?.done).toBe(0);
  });

  it("只接受寫入工具，參數照樣驗證", async () => {
    await expect(executeAssistantAction(ctx(), "list_projects", {})).rejects.toThrow("這不是可以執行的操作");
    await expect(executeAssistantAction(ctx(), "no_such_tool", {})).rejects.toBeInstanceOf(ToolError);
    await expect(executeAssistantAction(ctx(), "update_task", { task_id: "t1", due_date: "明天" })).rejects.toThrow(/參數錯誤/);
    await expect(executeAssistantAction(ctx(), "update_task", "t1")).rejects.toThrow("參數格式不正確");
  });
});

describe("整理專案（/api/ai/organize）", () => {
  const BASE = "http://127.0.0.1:8787";
  const sessions: Record<string, string> = {};
  let routeEnv: Env;
  const post = (userId: string, body: unknown) => worker.fetch(new Request(`${BASE}/api/ai/organize`, { method: "POST", body: JSON.stringify(body), headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), routeEnv,
    { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext);
  const brief = "10/5 已遞交；回收演練報告完成了；目標日期改到 2027-02-28；新增「準備展延文件」，明年 1 月底前完成。";

  beforeEach(async () => {
    routeEnv = { ...env(), OAUTH_KV: createMemoryKV() } as unknown as Env;
    await db.prepare("UPDATE users SET must_change_password=0").run();
    for (const user of [owner, outsider]) {
      const token = `session-${user.id}-${Math.random()}`;
      await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), user.id, new Date(Date.now() + 86_400_000).toISOString()).run();
      sessions[user.id] = `sid=${token}`;
    }
  });

  it("AI 看得到專案現況，可以分好幾輪提出整份變更清單；全部只是清單，資料庫不動", async () => {
    const seen = fakeLlm([
      { calls: [{ name: "update_project_settings", args: { project: "p_qa", target_date: "2027-02-28" } }, { name: "update_task", args: { task_id: "t1", done: true } }] },
      { calls: [{ name: "create_task", args: { project: "p_qa", title: "準備展延文件", due_date: "2027-01-31" } }, { name: "add_milestone", args: { project: "p_qa", title: "遞交", date: "2026-10-05", kind: "event" } }] },
      { calls: [{ name: "add_progress_update", args: { project: "p_qa", content: "10/5 已遞交。" } }] },
      { content: "共 5 項變更。" },
    ]);
    const response = await post("owner", { project_id: "p_qa", brief, lang: "zh" });
    expect(response.status).toBe(200);
    const data = await response.json() as { reply: string; actions: Array<{ tool: string; lines: string[] }> };
    expect(data.reply).toBe("共 5 項變更。");
    expect(data.actions.map((action) => action.tool)).toEqual(["update_project_settings", "update_task", "create_task", "add_milestone", "add_progress_update"]);
    expect(data.actions[0].lines).toEqual(["專案：QA：GDP/GMP", "目標日期：2027-02-28"]);
    expect(data.actions[3].lines).toContain("種類：歷程事件");
    // 第一則訊息就帶著專案現況（任務 id 與名稱），AI 才能改既有任務而不是重建一個。
    const first = JSON.parse(String(seen[0][1].content));
    expect(first.description).toBe(brief);
    expect(JSON.stringify(first.current_project)).toContain("回收演練報告");
    expect(JSON.stringify(first.current_project)).toContain("t1");
    expect(await row("SELECT target_date FROM projects WHERE id='p_qa'")).toEqual({ target_date: null });
    expect(await row<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE project_id='p_qa'")).toEqual({ n: 1 });
  });

  it("只能用這個專案相關的工具；其他工具（個人待辦、會議）不給", async () => {
    const seen = fakeLlm([{ calls: [{ name: "create_todo", args: { title: "x" } }] }, { content: "好。" }]);
    const data = await (await post("owner", { project_id: "p_qa", brief })).json() as { actions: unknown[] };
    expect(data.actions).toEqual([]);
    expect(String(seen[1].find((message) => message.role === "tool")?.content)).toContain("沒有這個工具");
    const tools = (JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)).tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    expect(tools).not.toContain("create_todo");
    expect(tools).toContain("update_project_settings");
  });

  it(`清單最多 ${MAX_ORGANIZE_ACTIONS} 項`, async () => {
    const many = Array.from({ length: MAX_ORGANIZE_ACTIONS + 3 }, (_, index) => ({ name: "create_task", args: { project: "p_qa", title: `任務 ${index}` } }));
    fakeLlm([{ calls: many }, { content: "完成。" }]);
    expect(((await (await post("owner", { project_id: "p_qa", brief })).json()) as { actions: unknown[] }).actions).toHaveLength(MAX_ORGANIZE_ACTIONS);
  });

  it("看不到的專案找不到；看得到但不能編輯的不產清單", async () => {
    fakeLlm([]);
    expect((await post("owner", { project_id: "p_secret", brief })).status).toBe(404);
    await db.prepare("UPDATE projects SET visibility='all' WHERE id='p_qa'").run();
    expect((await post("bd", { project_id: "p_qa", brief })).status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("語言模型不支援工具呼叫時，退回任務與里程碑草稿，一樣包成確認卡", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const plan = { tasks: [{ title: "準備展延文件", stage: "待辦", due_date: "2027-01-31" }], milestones: [{ title: "遞交展延", due_date: "2027-02-28", end_date: "" }, { title: "沒有日期的里程碑", due_date: "", end_date: "" }] };
    routeEnv = { ...routeEnv, LLM_API_KEY: undefined, AI: { run: async () => ({ response: JSON.stringify(plan) }) } } as unknown as Env;
    const data = await (await post("owner", { project_id: "p_qa", brief })).json() as { reply: string; actions: Array<{ tool: string; args: Record<string, unknown> }> };
    expect(data.reply).toContain("只能整理出任務與里程碑");
    expect(data.actions.map((action) => [action.tool, action.args])).toEqual([
      ["create_task", { project: "p_qa", title: "準備展延文件", stage: "待辦", due_date: "2027-01-31" }],
      ["add_milestone", { project: "p_qa", title: "遞交展延", date: "2027-02-28" }],
    ]);
  });
});
