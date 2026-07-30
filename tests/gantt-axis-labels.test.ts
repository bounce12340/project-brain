import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GANTT_YEAR_ROW_DAYS, ganttYearMarkers } from "../src/gantt";
import { addDays, daysBetween } from "../src/utils/dates";

function weeksBetween(start: string, end: string): string[] {
  return Array.from({ length: Math.ceil((daysBetween(start, end) + 1) / 7) + 1 }, (_, index) => addDays(start, index * 7));
}

const taskViews = readFileSync(new URL("../src/components/TaskViews.tsx", import.meta.url), "utf8");
const timeline = readFileSync(new URL("../src/pages/TimelinePage.tsx", import.meta.url), "utf8");
const legend = readFileSync(new URL("../src/components/GanttLegend.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("gantt year row", () => {
  it("stays empty for spans of one year or less", () => {
    const start = "2026-01-01";
    const end = addDays(start, GANTT_YEAR_ROW_DAYS);

    expect(daysBetween(start, end)).toBe(365);
    expect(ganttYearMarkers(weeksBetween(start, end), start, end)).toEqual([]);
  });

  it("marks one year per distinct year once the span passes a year", () => {
    const start = "2026-03-01";
    const end = addDays(start, GANTT_YEAR_ROW_DAYS + 1);
    const markers = ganttYearMarkers(weeksBetween(start, end), start, end);

    expect(markers.map((marker) => marker.year)).toEqual(["2026", "2027"]);
    expect(markers[0].date).toBe(start);
    expect(markers[1].date.startsWith("2027-01")).toBe(true);
  });

  it("covers every year of a multi-year span", () => {
    const start = "2025-06-15";
    const end = "2028-02-20";
    const markers = ganttYearMarkers(weeksBetween(start, end), start, end);

    expect(markers.map((marker) => marker.year)).toEqual(["2025", "2026", "2027", "2028"]);
    expect(new Set(markers.map((marker) => marker.year)).size).toBe(markers.length);
  });

  it("renders the year row above the week ticks in both charts", () => {
    expect(taskViews).toContain("data-gantt-year-label");
    expect(timeline).toContain("data-gantt-year-label");
    expect(taskViews).toContain("ganttYearMarkers(weeks, start, end)");
    expect(timeline).toContain("ganttYearMarkers(weeks, start, end)");
    expect(styles).toContain(".gantt-year-label");
  });
});

describe("gantt sticky label column", () => {
  it("splits both charts into a sticky label svg and a scrolling chart svg", () => {
    for (const source of [taskViews, timeline]) {
      expect(source).toContain("chart-surface gantt-sticky-labels");
      expect(source).toContain("data-gantt-label-width");
      expect(source).toContain("chart-surface shrink-0");
    }
  });

  it("pins the label column to the left edge of the scroll container", () => {
    expect(styles).toContain(".gantt-sticky-labels { position: sticky; left: 0;");
  });

  it("keeps chart geometry free of the label offset", () => {
    expect(taskViews).not.toContain("labelWidth + ganttPosition");
    expect(timeline).not.toContain("label + ganttPosition");
  });
});

describe("merged gantt status legend", () => {
  it("shows one entry per milestone and event kind instead of split point and period rows", () => {
    expect(legend).toContain("data-gantt-legend-milestone");
    expect(legend).toContain("data-gantt-legend-event");
    expect(legend).not.toContain("visible.milestonePoint");
    expect(legend).not.toContain("visible.eventPeriod");
  });

  it("keeps the period wording reachable through the merged entry title", () => {
    expect(legend).toContain("title={`${milestoneLabel}／${milestonePeriodLabel}`}");
    expect(legend).toContain("title={`${eventLabel}／${eventPeriodLabel}`}");
  });
});
