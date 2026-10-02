import { describe, expect, it } from "vitest";
import { cleanMonth, formatRecordTime, inMonthRange, monthPresets, rangeLabel, recordMatches, recordsReport, recordYears, splitRecords, taipeiNowLocal } from "../src/meeting-records";

describe("會議與外訓的時間顯示", () => {
  it("同一天寫成「日期 開始–結束」，沒有結束時間就只有開始", () => {
    expect(formatRecordTime("2026-10-01T14:00", "2026-10-01T15:30", "zh")).toBe("2026/10/01（四）14:00–15:30");
    expect(formatRecordTime("2026-10-01T14:00", null, "zh")).toBe("2026/10/01（四）14:00");
    expect(formatRecordTime("2026-10-01T14:00", "2026-10-01T15:30", "en")).toBe("Thu, Oct 1, 2026 14:00–15:30");
  });

  it("跨日時結束那端也寫日期；跨年才再寫年份", () => {
    expect(formatRecordTime("2026-10-01T09:00", "2026-10-02T17:00", "zh")).toBe("2026/10/01（四）09:00 – 10/02（五）17:00");
    expect(formatRecordTime("2026-12-31T09:00", "2027-01-01T12:00", "zh")).toBe("2026/12/31（四）09:00 – 2027/01/01（五）12:00");
  });
});

describe("接下來與已舉行", () => {
  const records = [
    { id: "a", starts_at: "2026-10-05T09:00", ends_at: null },
    { id: "b", starts_at: "2026-10-01T09:00", ends_at: "2026-10-01T18:00" },
    { id: "c", starts_at: "2026-09-01T09:00", ends_at: null },
    { id: "d", starts_at: "2026-10-03T09:00", ends_at: null },
    { id: "e", starts_at: "2026-09-20T09:00", ends_at: null },
  ];
  it("還沒結束的（包括進行中的）由近到遠；結束了的由新到舊", () => {
    const { upcoming, past } = splitRecords(records, "2026-10-01T12:00");
    expect(upcoming.map((item) => item.id)).toEqual(["b", "d", "a"]);
    expect(past.map((item) => item.id)).toEqual(["e", "c"]);
  });

  it("台北時間的現在比 UTC 多 8 小時", () => {
    expect(taipeiNowLocal(new Date("2026-09-30T20:30:00Z"))).toBe("2026-10-01T04:30");
  });
});

describe("搜尋", () => {
  const record = { title: "GDP 實務研習", location: "臺大醫院", attendees: "Elvis、王小明", organizer: "TFDA", summary: "溫控運輸稽核重點", project_name: null, starts_at: "2026-09-20T09:00" };
  it("名稱、地點、人員、主辦單位、摘要與日期都找得到，全形半形不拘", () => {
    for (const query of ["gdp", "ＧＤＰ", "臺大", "王小明", "tfda", "稽核", "2026-09-20", "elvis 溫控"]) expect(recordMatches(record, query), query).toBe(true);
    expect(recordMatches(record, "GMP")).toBe(false);
    expect(recordMatches(record, "  ")).toBe(true);
  });
});

describe("年月範圍篩選", () => {
  const at = (starts_at: string) => ({ starts_at });
  it("以開始時間的月份判斷，含頭尾；沒填的那端不限；起訖顛倒會自動對調", () => {
    expect(inMonthRange(at("2026-10-01T09:00"), { from: "2026-10", to: "2026-10" })).toBe(true);
    expect(inMonthRange(at("2026-09-30T23:00"), { from: "2026-10", to: "2026-10" })).toBe(false);
    expect(inMonthRange(at("2026-11-01T09:00"), { from: "2026-10", to: null })).toBe(true);
    expect(inMonthRange(at("2025-01-01T09:00"), { from: null, to: "2026-10" })).toBe(true);
    expect(inMonthRange(at("2026-09-15T09:00"), { from: "2026-10", to: "2026-08" })).toBe(true);
    expect(inMonthRange(at("2026-09-15T09:00"), { from: null, to: null })).toBe(true);
  });

  it("快速選項：本月、上個月（跨年也對）、今年", () => {
    expect(monthPresets("2026-10-02T10:00")).toEqual({ thisMonth: { from: "2026-10", to: "2026-10" }, lastMonth: { from: "2026-09", to: "2026-09" }, thisYear: { from: "2026-01", to: "2026-12" } });
    expect(monthPresets("2027-01-05T10:00").lastMonth).toEqual({ from: "2026-12", to: "2026-12" });
  });

  it("網址帶來的值不合法就當沒填；年份選項是紀錄的年份加今年，新的在前", () => {
    expect(cleanMonth("2026-10")).toBe("2026-10");
    expect(cleanMonth("2026-13")).toBeNull();
    expect(cleanMonth("abc")).toBeNull();
    expect(recordYears([at("2024-05-01T09:00"), at("2026-01-01T09:00"), at("2024-07-01T09:00")], "2026-10-02T10:00")).toEqual(["2026", "2024"]);
  });

  it("範圍的文字", () => {
    expect(rangeLabel({ from: "2026-10", to: "2026-10" }, "zh")).toBe("2026/10");
    expect(rangeLabel({ from: "2026-11", to: "2026-09" }, "zh")).toBe("2026/09–2026/11");
    expect(rangeLabel({ from: "2026-09", to: null }, "zh")).toBe("2026/09 起");
    expect(rangeLabel({ from: null, to: "2026-10" }, "en")).toBe("until 2026/10");
    expect(rangeLabel({ from: null, to: null }, "zh")).toBeNull();
  });
});

describe("複製到報告的清單", () => {
  const base = { id: "", ends_at: null, location: "", attendees: "", organizer: "", summary: "很長的摘要不放進清單", project_id: null, project_name: null, created_by: null, created_by_name: null, updated_by_name: null, created_at: "", updated_at: "", can_edit: false };
  it("一行一筆、依時間先後；外訓帶主辦單位，空的欄位不寫", () => {
    const report = recordsReport([
      { ...base, kind: "course", title: "藥物安全研討會", starts_at: "2026-10-20T13:30", location: "線上" },
      { ...base, kind: "course", title: "GDP 實務研習", starts_at: "2026-10-01T09:00", ends_at: "2026-10-01T16:00", organizer: "TFDA", location: "臺大醫院", attendees: "Elvis" },
    ], "公司外訓（2026/10，共 2 筆）", { organizer: "主辦", location: "地點", attendees: "參加", project: "專案" }, "zh");
    expect(report).toBe([
      "公司外訓（2026/10，共 2 筆）",
      "1. 2026/10/01（四）09:00–16:00　GDP 實務研習｜主辦：TFDA｜地點：臺大醫院｜參加：Elvis",
      "2. 2026/10/20（二）13:30　藥物安全研討會｜地點：線上",
    ].join("\n"));
    expect(report).not.toContain("很長的摘要");
  });
});
