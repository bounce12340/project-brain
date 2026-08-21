import { describe, expect, it } from "vitest";
import {
  dashboardGroups, filterProjectsByGroup, filterUpdatesByGroup,
  readDashboardGroup, resolveDashboardGroup, writeDashboardGroup,
} from "../src/dashboard-filter";
import type { Project } from "../src/types";

const project = (id: string, groupId: string, groupName: string): Project => ({
  id, name: id, description: "", group_id: groupId, group_name: groupName, group_type: "general",
  owner_id: "u", owner_name: "U", visibility: "group", status: "active", progress: 0,
  progress_mode: "manual", goal_summary: "", start_date: null, target_date: null,
  auto_archive: 1, archived_at: null, last_activity_at: "2026-01-01 00:00:00",
  risk_level: null, risk_summary: null, risk_suggestions: null, risk_updated_at: null,
});

const rows = [
  project("bd1", "g_bd", "BD組"),
  project("ra1", "g_ra", "RA/PV組"),
  project("bd2", "g_bd", "BD組"),
];

describe("dashboardGroups", () => {
  it("每組只出現一次", () => expect(dashboardGroups(rows)).toHaveLength(2));

  it("只列出真的有專案的組別，避免選了就空白", () => {
    expect(dashboardGroups(rows).map((group) => group.id).sort()).toEqual(["g_bd", "g_ra"]);
  });

  it("依組名排序，順序穩定", () => {
    expect(dashboardGroups(rows).map((group) => group.name)).toEqual(["BD組", "RA/PV組"]);
    expect(dashboardGroups([...rows].reverse()).map((group) => group.name)).toEqual(["BD組", "RA/PV組"]);
  });

  it("沒有專案時回空陣列", () => expect(dashboardGroups([])).toEqual([]));
});

describe("resolveDashboardGroup", () => {
  const groups = dashboardGroups(rows);

  it("記住的組別還在就沿用", () => expect(resolveDashboardGroup("g_ra", groups)).toBe("g_ra"));

  it("記住的組別已無專案時退回全部，而不是給一個空清單", () => {
    // 該組專案可能全部歸檔了，或使用者權限變動後看不到了。
    expect(resolveDashboardGroup("g_qa", groups)).toBe("");
    expect(resolveDashboardGroup("g_ra", [])).toBe("");
  });

  it("沒有偏好時就是全部", () => expect(resolveDashboardGroup("", groups)).toBe(""));
});

describe("filterProjectsByGroup", () => {
  it("指定組別時只留該組", () => {
    expect(filterProjectsByGroup(rows, "g_bd").map((row) => row.id)).toEqual(["bd1", "bd2"]);
  });

  it("空字串代表全部，不做過濾", () => expect(filterProjectsByGroup(rows, "")).toHaveLength(3));

  it("不存在的組別回空陣列", () => expect(filterProjectsByGroup(rows, "g_none")).toEqual([]));
});

describe("filterUpdatesByGroup", () => {
  const updates = [
    { id: "u1", project_id: "bd1" },
    { id: "u2", project_id: "ra1" },
    { id: "u3", project_id: "bd2" },
  ];

  it("只留下屬於篩選結果的動態", () => {
    const visible = filterProjectsByGroup(rows, "g_bd");
    expect(filterUpdatesByGroup(updates, visible, "g_bd").map((row) => row.id)).toEqual(["u1", "u3"]);
  });

  it("未篩選時原封不動回傳", () => {
    expect(filterUpdatesByGroup(updates, rows, "")).toHaveLength(3);
  });

  it("動態指向已不在清單上的專案時會被濾掉", () => {
    // 伺服器只回最新 12 筆，其中可能包含已歸檔專案的紀錄。
    expect(filterUpdatesByGroup(updates, [], "g_bd")).toEqual([]);
  });
});

describe("記住選擇", () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return { getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; }, data };
  };

  it("寫入後讀得回來", () => {
    const storage = store();
    writeDashboardGroup("g_ra", storage);
    expect(readDashboardGroup(storage)).toBe("g_ra");
  });

  it("沒存過時回空字串", () => expect(readDashboardGroup(store())).toBe(""));

  it("localStorage 丟例外時不會讓畫面壞掉", () => {
    // 無痕視窗或瀏覽器封鎖站台資料時，存取本身就會 throw。
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readDashboardGroup(blocked)).toBe("");
    expect(() => writeDashboardGroup("g_ra", blocked)).not.toThrow();
  });
});
