import { describe, expect, it } from "vitest";
import { formatQuarter, quarterEndDate, quarterOfDate, quarterOptions, quarterValue, resolveTargetDate, targetLabel } from "../src/project-quarter";

describe("quarterEndDate", () => {
  it("季度換算成該季最後一天——「第幾季完成」是期限，不是起點", () => {
    expect(quarterEndDate(2026, 1)).toBe("2026-03-31");
    expect(quarterEndDate(2026, 2)).toBe("2026-06-30");
    expect(quarterEndDate(2026, 3)).toBe("2026-09-30");
    expect(quarterEndDate(2026, 4)).toBe("2026-12-31");
  });

  it("Q1 一律是 3/31，不受閏年影響", () => {
    expect(quarterEndDate(2028, 1)).toBe("2028-03-31");
  });

  it("不合法的輸入回空字串，不回一個看起來像日期的東西", () => {
    for (const [year, quarter] of [[2026, 0], [2026, 5], [2026, 1.5], [1800, 1], [3000, 1], [NaN, 1]] as const) {
      expect(quarterEndDate(year, quarter)).toBe("");
    }
  });
});

describe("quarterOfDate", () => {
  it("剛好落在季末的日期才算一個季度", () => {
    expect(quarterOfDate("2026-12-31")).toEqual({ year: 2026, quarter: 4 });
    expect(quarterOfDate("2026-06-30")).toEqual({ year: 2026, quarter: 2 });
  });

  it("其他日期不是季度——那是使用者明確填的期限", () => {
    // 正式資料上這兩筆就是明確日期，不該被顯示成季度。
    expect(quarterOfDate("2026-09-09")).toBeNull();
    expect(quarterOfDate("2026-09-12")).toBeNull();
    expect(quarterOfDate("2026-12-30")).toBeNull();
  });

  it("空值與壞格式都回 null，不丟例外", () => {
    for (const value of [null, undefined, "", "2026", "2026-12", "abc", 42 as unknown as string]) {
      expect(quarterOfDate(value)).toBeNull();
    }
  });
});

describe("targetLabel", () => {
  it("季末顯示成季度，其他日期原樣顯示", () => {
    expect(targetLabel("2026-12-31")).toBe("2026 Q4");
    expect(targetLabel("2026-09-09")).toBe("2026-09-09");
  });

  it("沒有值就是空字串", () => {
    expect(targetLabel(null)).toBe("");
    expect(targetLabel(undefined)).toBe("");
  });
});

describe("resolveTargetDate", () => {
  it("季度選項換成季末日期", () => {
    expect(resolveTargetDate("2026-4")).toBe("2026-12-31");
    expect(resolveTargetDate("2027-1")).toBe("2027-03-31");
  });

  it("空字串代表清除", () => {
    expect(resolveTargetDate("")).toBeNull();
  });

  it("既有的明確日期原樣保留", () => {
    // 選單會把「非季末的既有日期」當成一個選項列出來。若這裡不認得它，
    // 使用者只要打開設定按一次儲存，原本填的 2026-09-09 就會被改掉。
    expect(resolveTargetDate("2026-09-09")).toBe("2026-09-09");
  });

  it("認不得的值回 undefined，讓呼叫端選擇不送出", () => {
    for (const value of ["2026-5", "2026", "Q4", "next year", "2026-13-01"]) {
      expect(resolveTargetDate(value)).toBeUndefined();
    }
  });
});

describe("quarterOptions", () => {
  it("以今年為中心，往前一年往後三年，共 20 個季度", () => {
    const options = quarterOptions("2026-09-09");
    expect(options).toHaveLength(20);
    expect(options[0]).toEqual({ year: 2025, quarter: 1 });
    expect(options.at(-1)).toEqual({ year: 2029, quarter: 4 });
  });

  it("選項值與顯示文字", () => {
    expect(quarterValue({ year: 2026, quarter: 4 })).toBe("2026-4");
    expect(formatQuarter({ year: 2026, quarter: 4 })).toBe("2026 Q4");
  });

  it("壞掉的日期回空陣列，不會讓選單炸掉", () => {
    expect(quarterOptions("bad")).toEqual([]);
  });
});
