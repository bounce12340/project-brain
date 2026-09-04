import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * 「里程碑逾期」原本在五個地方各自用 due_date 判斷，全都漏掉 end_date：專案時間流、
 * 儀表板 KPI、報表、AI 風險輸入，以及每日提醒信。使用者填了「8/27 執行到 9/28」，
 * 8/31 就被判逾期，而且每天收到一封說它已逾期的信。
 * 期限一律是 COALESCE(end_date, due_date)。
 */
const OVERDUE_SITES = [
  ["儀表板 KPI", "worker/routes/general.ts"],
  ["報表的逾期清單", "worker/services/reports.ts"],
  ["AI 風險輸入", "worker/routes/reports.ts"],
  ["每日提醒信", "worker/services/cron.ts"],
] as const;

describe("里程碑逾期一律以結束日為準", () => {
  it.each(OVERDUE_SITES)("%s 的查詢用 COALESCE(end_date, due_date)", (_label, path) => {
    const source = read(path);
    const lines = source.split("\n").filter((line) => /FROM milestones/.test(line) && /done\s*=\s*0/.test(line));
    expect(lines.length, `${path} 找不到里程碑逾期查詢`).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `${path}：${line.trim().slice(0, 120)}`).toMatch(/COALESCE\(\s*m?\.?end_date,\s*m?\.?due_date\s*\)/);
      // 還留著裸的 due_date 比較就代表沒改乾淨。
      expect(line.replace(/COALESCE\([^)]*\)/g, ""), path).not.toMatch(/due_date\s*<=?\s*[?d]/);
    }
  });

  it("前端時間流以 deadline 判斷逾期，不是開始日", () => {
    const source = read("src/project-timeline.ts");
    expect(source).toContain("const deadline = item.end_date ?? date");
    expect(source).toMatch(/isOverdue:[^,]*deadline < today/);
    expect(source).not.toMatch(/isOverdue:[^,]*\bdate < today/);
  });
});
