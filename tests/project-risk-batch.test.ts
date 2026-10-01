import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStaleProjectRisks } from "../worker/services/project-risk";
import { scheduledJobForCron } from "../worker/services/schedule";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * AI 風險分析的排程：每 10 分鐘補做幾個進行中專案（沒分析過或超過 7 天），
 * AI 失敗時不寫入規則判斷的結果，留給下一輪。
 */

let env: Env;
let calls: string[];
let failAi: boolean;

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, LLM_API_KEY: "test", LLM_BASE_URL: "https://llm.test", LLM_MODEL: "deepseek-chat" } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare(`INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at,risk_updated_at,created_at) VALUES
    ('never','從沒分析','','grp_general','usr_admin','all','active',10,datetime('now'),NULL,'2026-01-01'),
    ('old','上週以前分析','','grp_general','usr_admin','all','paused',10,datetime('now'),datetime('now','-8 days'),'2026-01-02'),
    ('fresh','昨天剛分析','','grp_general','usr_admin','all','active',10,datetime('now'),datetime('now','-1 days'),'2026-01-03'),
    ('done','已完成','','grp_general','usr_admin','all','done',100,datetime('now'),NULL,'2026-01-04'),
    ('archived','已歸檔','','grp_general','usr_admin','all','archived',100,datetime('now'),NULL,'2026-01-05')`).run();
  calls = [];
  failAi = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://llm.test/chat/completions");
    const name = JSON.parse(JSON.parse(String(init?.body)).messages[1].content).project.name as string;
    calls.push(name);
    if (failAi) return new Response("overloaded", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ level: "medium", summary: `${name}的摘要`, suggestions: ["下一步"] }) } }] }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const risk = (id: string) => env.DB.prepare("SELECT risk_level, risk_summary, risk_suggestions FROM projects WHERE id=?").bind(id).first();

describe("AI 風險分析排程", () => {
  it("只做進行中與暫停、沒分析過或超過 7 天的專案，最舊的先做", async () => {
    const result = await refreshStaleProjectRisks(env);
    expect(calls).toEqual(["從沒分析", "上週以前分析"]);
    expect(result).toEqual({ analyzed: 2, remaining: 0, failed: false });
    expect(await risk("never")).toEqual({ risk_level: "medium", risk_summary: "從沒分析的摘要", risk_suggestions: JSON.stringify(["下一步"]) });
    expect(await risk("done")).toEqual({ risk_level: null, risk_summary: null, risk_suggestions: null });
  });

  it("每輪有上限，剩下的留到下一輪", async () => {
    const result = await refreshStaleProjectRisks(env, 1);
    expect(result).toEqual({ analyzed: 1, remaining: 1, failed: false });
    expect(calls).toEqual(["從沒分析"]);
    await refreshStaleProjectRisks(env, 1);
    expect(calls).toEqual(["從沒分析", "上週以前分析"]);
    // 兩個都做完之後，不會再重做
    await refreshStaleProjectRisks(env, 1);
    expect(calls).toHaveLength(2);
  });

  it("AI 失敗：不寫入規則判斷的結果，這一輪停下，下一輪再試", async () => {
    failAi = true;
    const result = await refreshStaleProjectRisks(env);
    expect(result.failed).toBe(true);
    expect(result.analyzed).toBe(0);
    expect(result.remaining).toBe(2);
    expect(await risk("never")).toEqual({ risk_level: null, risk_summary: null, risk_suggestions: null });
    // llmChat 會重試一次，所以第一個專案呼叫兩次，第二個專案這輪沒碰
    expect(new Set(calls)).toEqual(new Set(["從沒分析"]));
  });

  it("每 10 分鐘的排程對應到風險分析；wrangler 的每個排程都有對應的工作", () => {
    expect(scheduledJobForCron("*/10 * * * *")).toBe("project-risk");
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]) as string[];
    expect(crons).toContain("*/10 * * * *");
    for (const cron of crons) expect(scheduledJobForCron(cron), cron).not.toBeNull();
  });
});
