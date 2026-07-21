import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";
import { scheduledJobForCron } from "../worker/services/schedule";
import { canGenerateReport, canReadReport, reportProjectVisible } from "../worker/services/reports";
import { reportPeriod } from "../worker/services/time";
import { groupTimelineProjects } from "../worker/services/timeline";

const member = { id: "usr_bd", role: "member" as const, group_id: "grp_bd" };
const intern = { id: "usr_intern", role: "intern" as const, group_id: "grp_bd" };
const admin = { id: "usr_v8_manager", role: "admin" as const, group_id: "grp_general" };

describe("V8 report periods and privacy", () => {
  it("calculates the previous Taipei month across a year boundary", () => {
    expect(reportPeriod("last-month", new Date("2026-01-15T12:00:00Z"))).toEqual({ periodType: "month", start: "2025-12-01", end: "2025-12-31" });
  });

  it("uses the Taipei calendar date near a UTC boundary", () => {
    expect(reportPeriod("this-month", new Date("2025-12-31T16:30:00Z"))).toEqual({ periodType: "month", start: "2026-01-01", end: "2026-01-31" });
  });

  it("excludes private projects unless an admin explicitly includes them", () => {
    expect(reportProjectVisible({ group_id: "grp_bd", visibility: "private" }, "grp_bd", false)).toBe(false);
    expect(reportProjectVisible({ group_id: "grp_bd", visibility: "private" }, "grp_bd", true)).toBe(true);
    expect(reportProjectVisible({ group_id: "grp_clinical", visibility: "all" }, "grp_bd", false)).toBe(false);
  });

  it("limits generation scope and private inclusion", () => {
    expect(canGenerateReport(member, "grp_bd", false)).toBe(true);
    expect(canGenerateReport(member, "grp_clinical", false)).toBe(false);
    expect(canGenerateReport(member, "grp_bd", true)).toBe(false);
    expect(canGenerateReport(admin, "all", true)).toBe(true);
  });

  it("allows same-group members and interns to read safe reports only", () => {
    const groupReport = { scope: "grp_bd", include_private: 0 };
    expect(canReadReport(member, groupReport)).toBe(true);
    expect(canReadReport(intern, groupReport)).toBe(true);
    expect(canReadReport({ ...member, group_id: "grp_clinical" }, groupReport)).toBe(false);
    expect(canReadReport(member, { ...groupReport, include_private: 1 })).toBe(false);
    expect(canReadReport(admin, { scope: "all", include_private: 1 })).toBe(true);
  });
});

describe("V8 cron, timeline and typography", () => {
  it("routes the monthly cron separately", () => {
    expect(scheduledJobForCron("30 0 1 * *")).toBe("monthly-reports");
    expect(scheduledJobForCron("30 0 * * 1")).toBe("weekly-reports");
    expect(scheduledJobForCron("0 1 * * *")).toBe("daily-reminders");
  });

  it("groups timeline projects into ordered group lanes", () => {
    expect(groupTimelineProjects([
      { id: "p2", group_id: "g2", group_name: "臨床組", name: "B" },
      { id: "p1", group_id: "g1", group_name: "BD組", name: "A" },
      { id: "p3", group_id: "g1", group_name: "BD組", name: "C" },
    ])).toEqual(expect.arrayContaining([
      { id: "g1", name: "BD組", projects: [{ id: "p1", group_id: "g1", group_name: "BD組", name: "A" }, { id: "p3", group_id: "g1", group_name: "BD組", name: "C" }] },
      { id: "g2", name: "臨床組", projects: [{ id: "p2", group_id: "g2", group_name: "臨床組", name: "B" }] },
    ]));
  });

  it("keeps the readability font tokens stable", () => {
    expect(tailwindConfig.theme.extend.fontSize).toMatchInlineSnapshot(`
      {
        "sm": [
          "15px",
          {
            "lineHeight": "22px",
          },
        ],
        "xs": [
          "13px",
          {
            "lineHeight": "18px",
          },
        ],
      }
    `);
  });
});
