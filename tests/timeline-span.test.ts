import { describe, expect, it } from "vitest";
import { hasNoSchedule, projectSpan, type SpanProject } from "../src/timeline-span";

const project = (over: Partial<SpanProject> = {}): SpanProject =>
  ({ start_date: null, target_date: null, tasks: [], markers: [], ...over });

describe("projectSpan", () => {
  it("有填專案起訖就直接用", () => {
    expect(projectSpan(project({ start_date: "2026-01-01", target_date: "2026-06-30" })))
      .toEqual({ start: "2026-01-01", end: "2026-06-30" });
  });

  it("沒填就用裡面的任務與里程碑推出區間", () => {
    // 正式資料的實況：RA：Apply the PMF for Pathone 兩個日期都是 null，
    // 但它有 7 筆有日期的里程碑，跨 2026-05-11 ~ 2026-08-22。
    const result = projectSpan(project({
      markers: [{ due_date: "2026-05-11", end_date: null }, { due_date: "2026-08-01", end_date: "2026-08-22" }],
    }));
    expect(result).toEqual({ start: "2026-05-11", end: "2026-08-22" });
  });

  it("任務與里程碑一起算", () => {
    const result = projectSpan(project({
      tasks: [{ start_date: "2026-03-01", due_date: "2026-04-01" }],
      markers: [{ due_date: "2026-09-30", end_date: null }],
    }));
    expect(result).toEqual({ start: "2026-03-01", end: "2026-09-30" });
  });

  it("只填了目標日時，開始由內容決定", () => {
    const result = projectSpan(project({
      target_date: "2026-09-09",
      tasks: [{ start_date: "2026-08-27", due_date: null }],
    }));
    expect(result).toEqual({ start: "2026-08-27", end: "2026-09-09" });
  });

  it("只填了開始日時，結束由內容決定", () => {
    const result = projectSpan(project({
      start_date: "2026-01-01",
      markers: [{ due_date: "2026-03-15", end_date: null }],
    }));
    expect(result).toEqual({ start: "2026-01-01", end: "2026-03-15" });
  });

  it("只有一端有資料時，兩端相同", () => {
    expect(projectSpan(project({ target_date: "2026-09-09" }))).toEqual({ start: "2026-09-09", end: "2026-09-09" });
    expect(projectSpan(project({ start_date: "2026-01-01" }))).toEqual({ start: "2026-01-01", end: "2026-01-01" });
  });

  it("完全沒有日期就回 null，而不是退回時間軸原點", () => {
    // 這正是原本的 bug：`project.start_date ?? start` 把專案釘在整條軸線最左邊。
    expect(projectSpan(project())).toBeNull();
    expect(projectSpan(project({ tasks: [{ start_date: null, due_date: null }] }))).toBeNull();
    expect(projectSpan(project({ markers: [{ due_date: null, end_date: null }] }))).toBeNull();
    expect(hasNoSchedule(project())).toBe(true);
  });

  it("填反了也不會畫出負長度", () => {
    expect(projectSpan(project({ start_date: "2026-06-30", target_date: "2026-01-01" })))
      .toEqual({ start: "2026-01-01", end: "2026-06-30" });
  });

  it("不拿 created_at 當開始日", () => {
    // 一批專案同時匯入時，created_at 會讓它們全部從匯入那天長出來。
    const withCreated = project({ tasks: [{ start_date: null, due_date: "2026-05-01" }] });
    expect(projectSpan(withCreated)).toEqual({ start: "2026-05-01", end: "2026-05-01" });
  });
});
