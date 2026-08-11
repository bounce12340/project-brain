import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES, ARCHIVE_STATUSES, archiveDate, archiveSummary,
  bucketOf, bucketStatuses, groupArchiveByYear, statusQuery,
} from "../src/project-archive";
import { requestedStatuses } from "../worker/routes/projects";
import type { Project } from "../src/types";

const project = (patch: Partial<Project>): Project => ({
  id: "p", name: "案", description: "", group_id: "g", group_name: "G", group_type: "general",
  owner_id: "u", owner_name: "U", visibility: "group", status: "done", progress: 100,
  progress_mode: "manual", goal_summary: "", start_date: null, target_date: null,
  auto_archive: 1, archived_at: null, last_activity_at: "2026-01-01 00:00:00",
  risk_level: null, risk_summary: null, risk_suggestions: null, risk_updated_at: null, ...patch,
});

describe("兩個籃子涵蓋全部狀態且互斥", () => {
  it("四種狀態各歸一籃，沒有遺漏也沒有重複", () => {
    const all = [...ACTIVE_STATUSES, ...ARCHIVE_STATUSES];
    expect([...new Set(all)].sort()).toEqual(["active", "archived", "done", "paused"]);
  });

  it.each([["active", "active"], ["paused", "active"], ["done", "archive"], ["archived", "archive"]] as const)(
    "%s 屬於 %s 籃", (status, bucket) => expect(bucketOf(status)).toBe(bucket));

  it("兩籃沒有交集", () => {
    expect(ACTIVE_STATUSES.filter((status) => (ARCHIVE_STATUSES as readonly string[]).includes(status))).toEqual([]);
  });
});

describe("statusQuery 一定帶值", () => {
  it("未選狀態時送出整籃，而不是空字串", () => {
    // 送空字串等於不帶 status，後端會回傳全部狀態，歸檔專案就會漏進專案清單。
    expect(statusQuery("active", "")).toBe("active,paused");
    expect(statusQuery("archive", "")).toBe("done,archived");
  });

  it("選了籃內的單一狀態就只送那一個", () => {
    expect(statusQuery("active", "paused")).toBe("paused");
    expect(statusQuery("archive", "archived")).toBe("archived");
  });

  it("籃外的狀態一律忽略，改送整籃", () => {
    // 從歸檔專區切回專案清單時，舊的篩選值可能還留在 state 裡。
    expect(statusQuery("active", "archived")).toBe("active,paused");
    expect(statusQuery("archive", "active")).toBe("done,archived");
    expect(statusQuery("active", "'; DROP TABLE projects;--")).toBe("active,paused");
  });
});

describe("後端 requestedStatuses", () => {
  it("解析逗號分隔的多個狀態", () => {
    expect([...requestedStatuses("done,archived")].sort()).toEqual(["archived", "done"]);
  });

  it("單一值與先前行為相同", () => expect([...requestedStatuses("active")]).toEqual(["active"]));

  it("未指定時回空集合，代表不過濾（維持舊呼叫端的行為）", () => {
    for (const raw of [undefined, null, "", "   "]) expect(requestedStatuses(raw).size).toBe(0);
  });

  it("丟掉不認識的狀態，不讓它變成永遠不匹配的過濾條件", () => {
    expect([...requestedStatuses("done,bogus")]).toEqual(["done"]);
    expect(requestedStatuses("bogus").size).toBe(0);
  });
});

describe("archiveDate", () => {
  it("已歸檔的用 archived_at", () =>
    expect(archiveDate(project({ archived_at: "2025-03-04 08:00:00", last_activity_at: "2026-01-01 00:00:00" }))).toBe("2025-03-04"));

  it("已完成但尚未歸檔的沒有 archived_at，退回最後活動時間", () =>
    expect(archiveDate(project({ archived_at: null, last_activity_at: "2024-11-20 09:30:00" }))).toBe("2024-11-20"));
});

describe("groupArchiveByYear", () => {
  const rows = [
    project({ id: "a", name: "B案", archived_at: "2024-05-01 00:00:00" }),
    project({ id: "b", name: "A案", archived_at: "2026-02-01 00:00:00" }),
    project({ id: "c", name: "C案", archived_at: "2024-09-15 00:00:00" }),
    project({ id: "d", name: "D案", archived_at: null, last_activity_at: "" }),
  ];

  it("年份新的排前面", () => expect(groupArchiveByYear(rows).map((item) => item.year)).toEqual(["2026", "2024", "—"]));

  it("同一年內依歸檔日期由新到舊", () => {
    const year2024 = groupArchiveByYear(rows).find((item) => item.year === "2024");
    expect(year2024?.projects.map((item) => item.id)).toEqual(["c", "a"]);
  });

  it("沒有日期的歸到未標示年份，不會被丟掉", () => {
    const unknown = groupArchiveByYear(rows).find((item) => item.year === "—");
    expect(unknown?.projects.map((item) => item.id)).toEqual(["d"]);
  });

  it("每個專案都只出現一次", () => {
    const flattened = groupArchiveByYear(rows).flatMap((item) => item.projects.map((project) => project.id));
    expect(flattened.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("空清單回空陣列", () => expect(groupArchiveByYear([])).toEqual([]));
});

describe("archiveSummary", () => {
  it("分別計算完成與歸檔的件數", () => {
    expect(archiveSummary([
      project({ id: "1", status: "done" }), project({ id: "2", status: "archived" }),
      project({ id: "3", status: "archived" }),
    ])).toEqual({ total: 3, done: 1, archived: 2 });
  });

  it("空清單三個數字都是 0", () => expect(archiveSummary([])).toEqual({ total: 0, done: 0, archived: 0 }));
});

describe("bucketStatuses", () => {
  it("回傳的是該籃全部狀態", () => {
    expect([...bucketStatuses("active")]).toEqual(["active", "paused"]);
    expect([...bucketStatuses("archive")]).toEqual(["done", "archived"]);
  });
});
