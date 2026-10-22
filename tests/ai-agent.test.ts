import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../worker/types";
import { ToolError } from "../worker/mcp/protocol";
import { assistantContext, executeAssistantAction, runAssistantTurn } from "../worker/services/ai-agent";
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
