import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRegwatchSystemPrompt,
  combineRegwatchFileTexts,
  hasRegwatchComparisonSignals,
  isRegwatchDateSuspect,
  normalizeExtractedEntries,
  normalizeRegwatchDate,
} from "../worker/services/regwatch-ai";
import { mergeRegwatchAttachments, orphanRegwatchFileIds } from "../worker/services/regwatch";
import { en, zh } from "../src/i18n/translations";

describe("SPEC-V10 公告日期與多檔分析", () => {
  it("prompt 強制公告日而非施行日，並把施行日放在第一個條列", () => {
    const prompt = buildRegwatchSystemPrompt("single");
    expect(prompt).toContain("entry_date 一律取公告日期或發文日期");
    expect(prompt).toContain("絕不可取施行日、生效日或實施日");
    expect(prompt).toContain('"entry_date":"2026-07-20"');
    expect(prompt).toContain("• 施行日：2027-03-01");
  });

  it("公告日期民國年換算維持正確", () => {
    expect(normalizeRegwatchDate("民國115年7月20日")).toBe("2026-07-20");
  });

  it("date_suspect 在未來第 90 天為 false、第 91 天為 true", () => {
    const today = new Date("2026-07-23T12:00:00Z");
    expect(isRegwatchDateSuspect("2026-10-21", today)).toBe(false);
    expect(isRegwatchDateSuspect("2026-10-22", today)).toBe(true);
    expect(isRegwatchDateSuspect("2026-10-22", new Date("2026-07-23T16:30:00Z"))).toBe(false);
  });

  it("多檔文字以檔名標頭分隔後串接", () => {
    expect(combineRegwatchFileTexts([
      { name: "主文.txt", text: "公告主文\n" },
      { name: "對照表.txt", text: " 修正條文 " },
    ])).toBe("【檔案：主文.txt】\n公告主文\n\n【檔案：對照表.txt】\n修正條文");
  });

  it("辨識對照表、修正條文與現行條文訊號", () => {
    expect(hasRegwatchComparisonSignals("附件為條文對照表")).toBe(true);
    expect(hasRegwatchComparisonSignals("修正條文如下")).toBe(true);
    expect(hasRegwatchComparisonSignals("現行條文採紙本")).toBe(true);
    expect(hasRegwatchComparisonSignals("一般公告主文")).toBe(false);
  });

  it("正規化保留獨立前後對照段落並統一條列", () => {
    const [entry] = normalizeExtractedEntries([{
      entry_date: "2026-07-20",
      title: "修正公告",
      key_points: "立法目的摘要。\n**修正重點（前後對照）**\n第3條：紙本→線上",
    }]);
    expect(entry.key_points).toBe("立法目的摘要。\n修正重點（前後對照）\n• 第3條：紙本→線上");
  });

  it("migration 0008 建 junction 並回填既有 file_id", () => {
    const migration = readFileSync(new URL("../migrations/0008_v10.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE reg_entry_files");
    expect(migration).toContain("UNIQUE(entry_id, file_id)");
    expect(migration).toContain("SELECT id, file_id, 0");
    expect(migration).toContain("WHERE file_id IS NOT NULL");
  });

  it("列表合併 junction 與 legacy file_id 時依 entry/file 去重", () => {
    const shared = { entry_id: "reg-1", id: "file-1", filename: "主文.txt", size: 10, content_type: "text/plain" };
    const merged = mergeRegwatchAttachments(
      [{ ...shared, position: 2 }, { ...shared, id: "file-2", filename: "對照表.txt", position: 1 }],
      [{ ...shared, position: 0 }],
    );
    expect(merged.get("reg-1")?.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: "file-1", position: 0 },
      { id: "file-2", position: 1 },
    ]);
  });

  it("刪除條目時只把無 junction 與 legacy 引用的候選檔判為孤兒", () => {
    expect(orphanRegwatchFileIds(["file-1", "file-2", "file-1"], ["file-2"])).toEqual(["file-1"]);
  });

  it("i18n 新增字串維持 key parity 且英文日期標題為 Announced", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(zh["regwatch.announcedDate"]).toBe("公告日期");
    expect(en["regwatch.announcedDate"]).toBe("Announced");
  });
});
