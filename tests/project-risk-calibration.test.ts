import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectRisk, calibrateRisk, RISK_PROMPT, type RiskSignals } from "../worker/services/project-risk";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * AI 風險分析的校正：給 AI 明確的評分標準，負責人的燈號優先，
 * 沒有逾期、沒過目標日、期限也不近的專案不判高；沒有任務時 0% 不算落後。
 */

const none: RiskSignals = { overdue: 0, pastTarget: false, nearDeadline: false, light: null };

describe("calibrateRisk：燈號優先", () => {
  it("落後一律高；有風險至少中，要有逾期或期限逼近才能到高", () => {
    expect(calibrateRisk("low", { ...none, light: "off_track" }, "zh")).toEqual({ level: "high", note: "（依負責人的狀態燈號「落後」調整為高風險）" });
    expect(calibrateRisk("low", { ...none, light: "at_risk" }, "zh").level).toBe("medium");
    expect(calibrateRisk("high", { ...none, light: "at_risk" }, "zh").level).toBe("medium");
    expect(calibrateRisk("high", { ...none, light: "at_risk", nearDeadline: true }, "zh")).toEqual({ level: "high", note: "" });
  });

  it("順利：沒有逾期也沒過目標日就是低；有的話最多中", () => {
    expect(calibrateRisk("high", { ...none, light: "on_track", nearDeadline: true }, "zh")).toEqual({ level: "low", note: "（依負責人的狀態燈號「順利」調整為低風險）" });
    expect(calibrateRisk("high", { ...none, light: "on_track", overdue: 2 }, "zh").level).toBe("medium");
    expect(calibrateRisk("low", { ...none, light: "on_track", pastTarget: true }, "zh")).toEqual({ level: "low", note: "" });
  });

  it("沒有燈號：沒有硬性指標就不判高，中和低照 AI 的判斷", () => {
    expect(calibrateRisk("high", none, "zh")).toEqual({ level: "medium", note: "（沒有逾期項目，期限也不近，調整為中風險）" });
    expect(calibrateRisk("high", none, "en").note).toBe(" (Adjusted to medium risk: nothing is overdue and no deadline is near.)");
    expect(calibrateRisk("high", { ...none, overdue: 1 }, "zh").level).toBe("high");
    expect(calibrateRisk("high", { ...none, nearDeadline: true }, "zh").level).toBe("high");
    expect(calibrateRisk("medium", none, "zh")).toEqual({ level: "medium", note: "" });
  });
});

let env: Env;
let aiLevel: string;
let sent: { system: string; input: Record<string, unknown> } | null;

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, LLM_API_KEY: "test", LLM_BASE_URL: "https://llm.test", LLM_MODEL: "deepseek-chat" } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  aiLevel = "high";
  sent = null;
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)).messages as Array<{ content: string }>;
    sent = { system: messages[0].content, input: JSON.parse(messages[1].content) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ level: aiLevel, summary: "AI 摘要", suggestions: ["下一步"] }) } }] }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const addProject = (id: string, extra: { health?: string; healthDaysAgo?: number; target?: string } = {}) =>
  env.DB.prepare(`INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,progress_mode,start_date,target_date,last_activity_at,health,health_at)
    VALUES (?,?,'','grp_general','usr_admin','all','active',0,'auto','2026-01-01',?,datetime('now','-60 days'),?,CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)`)
    .bind(id, `專案 ${id}`, extra.target ?? null, extra.health ?? null, extra.health ?? null, `-${extra.healthDaysAgo ?? 1} days`).run();
const saved = (id: string) => env.DB.prepare("SELECT risk_level, risk_summary FROM projects WHERE id=?").bind(id).first();

describe("analyzeProjectRisk", () => {
  it("給 AI 評分標準與判斷依據：沒有任務時標明進度沒有意義、附上負責人的燈號與期限", async () => {
    await addProject("p1", { health: "on_track", target: "2099-12-31" });
    await analyzeProjectRisk(env, "p1", "zh");
    expect(sent!.system).toContain(RISK_PROMPT);
    expect(RISK_PROMPT).toMatch(/When the evidence is thin, choose low/);
    expect(RISK_PROMPT).toMatch(/TFDA review/);
    // 已確認的延後以新的日期判斷，不因「延後」本身判有風險。
    expect(RISK_PROMPT).toMatch(/confirmed and re-planned .* is not a risk by itself: rate only the risk of meeting the new dates/);
    // 已送件、只等主管機關審查，沒有逾期就是低風險；期限接近本身不算。
    expect(RISK_PROMPT).toMatch(/submitted to the authority and the project is only awaiting its decision, rate low unless a task or milestone is overdue/);
    expect(sent!.input).toMatchObject({ progress_meaningful: false, tasks: { total: 0, done: 0, overdue: 0 }, next_milestone: null, owner_status_light: { level: "on_track", stale: false } });
    expect(typeof sent!.input.days_to_target).toBe("number");
  });

  it("燈號「順利」而沒有逾期：AI 判高也存成低，摘要註明是依燈號調整", async () => {
    await addProject("p1", { health: "on_track" });
    const outcome = await analyzeProjectRisk(env, "p1", "zh");
    expect(outcome).toMatchObject({ level: "low", fallback: false });
    expect(await saved("p1")).toEqual({ risk_level: "low", risk_summary: "AI 摘要（依負責人的狀態燈號「順利」調整為低風險）" });
  });

  it("燈號「落後」：AI 判低也存成高", async () => {
    aiLevel = "low";
    await addProject("p1", { health: "off_track" });
    expect((await analyzeProjectRisk(env, "p1", "zh"))?.level).toBe("high");
  });

  it("燈號超過 14 天沒更新（待更新）就不採用；沒有硬性指標時 AI 的高降為中", async () => {
    await addProject("p1", { health: "on_track", healthDaysAgo: 20 });
    const outcome = await analyzeProjectRisk(env, "p1", "zh");
    expect(sent!.input.owner_status_light).toMatchObject({ level: "on_track", stale: true });
    expect(outcome?.level).toBe("medium");
  });

  it("有逾期任務而沒有燈號：照 AI 的高", async () => {
    await addProject("p1");
    await env.DB.prepare("INSERT INTO stages (id,project_id,name,position) VALUES ('s1','p1','待辦',0)").run();
    await env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,due_date) VALUES ('t1','p1','s1','逾期','2026-01-02')").run();
    const outcome = await analyzeProjectRisk(env, "p1", "zh");
    expect(sent!.input).toMatchObject({ progress_meaningful: true, tasks: { total: 1, overdue: 1 } });
    expect(outcome?.level).toBe("high");
  });

  it("AI 失敗時的規則判斷也經過校正：沒有任務不因進度 0% 判高，燈號優先", async () => {
    vi.stubGlobal("fetch", async () => new Response("overloaded", { status: 503 }));
    await addProject("p1", { target: "2099-12-31" });
    expect((await analyzeProjectRisk(env, "p1", "zh"))).toMatchObject({ level: "low", fallback: true });
    await addProject("p2", { health: "off_track" });
    expect((await analyzeProjectRisk(env, "p2", "zh"))).toMatchObject({ level: "high", fallback: true });
  });
});
