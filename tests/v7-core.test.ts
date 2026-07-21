import { describe, expect, it } from "vitest";
import { parseLooseJson } from "../worker/services/llm";
import {
  REGWATCH_TEXT_TOTAL_LIMIT,
  batchDuplicateStats,
  buildRegwatchSystemPrompt,
  canDownloadFileForRegwatch,
  consolidateSingleAnnouncement,
  ensurePdfText,
  ensureRegwatchTextLimit,
  markRegwatchDuplicates,
  mergeExtractedEntries,
  normalizeExtractedEntries,
  normalizeProductLine,
  normalizeRegwatchDate,
  normalizeRegwatchExtractMode,
  regwatchExtractionErrorStatus,
  splitRegwatchText,
  type RegwatchExtractedEntry,
} from "../worker/services/regwatch-ai";

const entry = (title: string): RegwatchExtractedEntry => ({ entry_date: "2026-07-21", entry_type: "announcement", product_line: "藥品", category: "查登", title, key_points: "• 重點" });

describe("SPEC-V7 法規 AI 匯入純函式", () => {
  it("民國年換算為西元 ISO 日期", () => expect(normalizeRegwatchDate("民國115年7月21日")).toBe("2026-07-21"));
  it("拒絕不存在的民國日期", () => expect(normalizeRegwatchDate("115年2月30日")).toBeNull());
  it("product_line 非白名單時 fallback 其他", () => expect(normalizeProductLine("生技")).toBe("其他"));
  it("寬鬆 JSON 可解析陣列 fence", () => expect(parseLooseJson("```json\n[{\"title\":\"A\"}]\n```")).toEqual([{ title: "A" }]));
  it("長文字依段落切塊且每塊不超過限制", () => {
    const chunks = splitRegwatchText(`${"甲".repeat(12)}\n\n${"乙".repeat(12)}`, 16);
    expect(chunks).toEqual(["甲".repeat(12), "乙".repeat(12)]);
    expect(chunks.every((chunk) => chunk.length <= 16)).toBe(true);
  });
  it("切塊合併依 title 去重", () => expect(mergeExtractedEntries([[entry("同名")], [entry("同名"), entry("另一筆")]]).map((item) => item.title)).toEqual(["同名", "另一筆"]));
  it("正規化欄位並補條列符號與 fallback", () => {
    const result = normalizeExtractedEntries([{ entry_date: "115/07/21", entry_type: "unknown", product_line: "未知", category: "超過十個字的分類標籤", title: "公告", key_points: "第一點\n- 第二點" }]);
    expect(result[0]).toMatchObject({ entry_date: "2026-07-21", entry_type: "announcement", product_line: "其他", key_points: "第一點\n• 第二點" });
    expect(result[0].category.length).toBeLessThanOrEqual(10);
  });
  it("撞鍵判定使用 entry_date 與 title", () => expect(markRegwatchDuplicates([entry("A")], ["2026-07-21\u0000A"])[0].duplicate).toBe(true));
  it("無文字層 PDF 對應 422", () => { let error: unknown; try { ensurePdfText(" \n "); } catch (cause) { error = cause; } expect(regwatchExtractionErrorStatus(error)).toBe(422); });
  it("超過 120,000 字元對應 422", () => { expect(REGWATCH_TEXT_TOTAL_LIMIT).toBe(120_000); let error: unknown; try { ensureRegwatchTextLimit("字".repeat(120_001)); } catch (cause) { error = cause; } expect(regwatchExtractionErrorStatus(error)).toBe(422); });
  it("batch 同鍵統計 created 與 skipped", () => expect(batchDuplicateStats(["A", "B", "A"])).toEqual({ created: 2, skipped: 1 }));
  it("files.project_id NULL 僅允許已登入 regwatch 路徑", () => {
    expect(canDownloadFileForRegwatch(null, true)).toBe(true);
    expect(canDownloadFileForRegwatch(null, false)).toBe(false);
    expect(canDownloadFileForRegwatch("prj", true)).toBe(false);
  });
});

describe("SPEC-V7-1 公告拆分粒度", () => {
  it("mode 未提供時預設 single，僅明確 multi 才切換", () => {
    expect(normalizeRegwatchExtractMode(undefined)).toBe("single");
    expect(normalizeRegwatchExtractMode("single")).toBe("single");
    expect(normalizeRegwatchExtractMode("multi")).toBe("multi");
  });

  it("single 模式把多筆結果歸一並取最早日期與第一個標題", () => {
    const result = consolidateSingleAnnouncement([
      { ...entry("第一個標題"), entry_date: "2026-07-22", key_points: "第一段摘要。\n• 修正甲" },
      { ...entry("第二個標題"), entry_date: "2026-07-21", key_points: "第二段摘要。\n• 修正乙" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ entry_date: "2026-07-21", title: "第一個標題" });
    expect(result[0].key_points).toBe("第一段摘要。\n• 修正甲\n• 第二段摘要。\n• 修正乙");
  });

  it("key_points 第一行保留無符號摘要，後續行正規化為條列", () => {
    const result = normalizeExtractedEntries([{ entry_date: "2026-07-21", title: "公告", key_points: "公告修正三項要求。\n修正甲\n- 修正乙\n• 修正丙" }]);
    expect(result[0].key_points).toBe("公告修正三項要求。\n• 修正甲\n• 修正乙\n• 修正丙");
  });

  it("multi prompt 只以不同日期或不同公告標題為邊界，且含單公告三項 few-shot", () => {
    const prompt = buildRegwatchSystemPrompt("multi");
    expect(prompt).toContain("不同發文日期或不同公告標題");
    expect(prompt).toContain("同一公告內的多個修正條文、品項、附表、子項目");
    expect(prompt).toContain('"title":"醫療器材標示規定修正公告"');
    expect(prompt.match(/• 修正/g)).toHaveLength(3);
  });
});
