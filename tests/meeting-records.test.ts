import { describe, expect, it } from "vitest";
import { formatRecordTime, recordMatches, splitRecords, taipeiNowLocal } from "../src/meeting-records";

describe("會議與上課的時間顯示", () => {
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
