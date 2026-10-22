import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RISK_REVIEW_CONCURRENCY, sortReview } from "../src/components/RiskReview";

const review = readFileSync(new URL("../src/components/RiskReview.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");

/** 儀表板的「AI 風險審視」：一鍵把我負責的專案逐一請 AI 分析。 */
describe("AI 風險審視", () => {
  it("結果依風險高低排列，失敗的放最後，同級維持原順序", () => {
    const sorted = sortReview([
      { id: "a", level: "low" as const }, { id: "b", error: "x" }, { id: "c", level: "high" as const },
      { id: "d", level: "medium" as const }, { id: "e", level: "high" as const },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["c", "e", "d", "a", "b"]);
  });

  it("逐一呼叫既有的單一專案分析端點：權限與寫回和專案頁的「重新分析」相同，不另開批次端點", () => {
    expect(review).toContain('api<{ level: Result["level"]; summary: string; suggestions: string[]; fallback?: boolean }>("/ai/project-risk"');
    expect(review).not.toMatch(/\/ai\/project-risk\/batch|\/ai\/risk-review/);
    expect(RISK_REVIEW_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(RISK_REVIEW_CONCURRENCY).toBeLessThanOrEqual(3);
  });

  it("範圍是我負責或參與的進行中專案，不受組別篩選影響；跑之前先確認、可以中途停止", () => {
    expect(dashboard).toContain("ongoing.filter((project) => isMine(project, user?.id))");
    expect(dashboard).toContain("<RiskReview projects={myProjects}");
    expect(review).toContain('window.confirm(t("riskReview.confirm"');
    expect(review).toContain("stop.current = true");
  });
});
