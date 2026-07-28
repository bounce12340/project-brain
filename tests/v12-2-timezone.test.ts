import { describe, expect, it } from "vitest";
import { formatDate } from "../src/api";
import { formatProgressEditedAt } from "../src/progress-updates";
import { relativeTime } from "../src/utils/localized";
import { parseServerDate } from "../src/utils/server-date";

describe("SPEC-V12-2 server timestamp parsing", () => {
  it("treats space and T naive datetimes as UTC", () => {
    expect(parseServerDate("2026-07-28 02:07:18").toISOString()).toBe("2026-07-28T02:07:18.000Z");
    expect(parseServerDate("2026-07-28T02:07:18").toISOString()).toBe("2026-07-28T02:07:18.000Z");
    expect(formatDate("2026-07-28 02:07:18", true, "zh")).toContain("10:07");
    expect(formatDate("2026-07-28T02:07:18", true, "zh")).toContain("10:07");
    expect(formatProgressEditedAt("2026-07-28 02:07:18", "zh")).toBe("2026/07/28 10:07");
  });

  it("does not offset timestamps that already include Z", () => {
    expect(parseServerDate("2026-07-28T02:07:18Z").toISOString()).toBe("2026-07-28T02:07:18.000Z");
    expect(formatDate("2026-07-28T02:07:18Z", true, "zh")).toContain("10:07");
  });

  it("keeps date-only values at Taipei midnight", () => {
    expect(parseServerDate("2026-07-28").toISOString()).toBe("2026-07-27T16:00:00.000Z");
    expect(formatDate("2026-07-28", false, "zh")).toMatch(/2026.*7.*28/);
  });

  it("calculates relative time from the normalized UTC instant", () => {
    const now = Date.parse("2026-07-28T05:07:18Z");
    expect(relativeTime("2026-07-28 02:07:18", "zh", now)).toBe("3 小時前");
  });
});
