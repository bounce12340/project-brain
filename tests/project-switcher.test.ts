import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupProjectsForSwitch, nextProjectId, orderProjectsForSwitch, type SwitchableProject } from "../src/project-switcher";

const project = (id: string, name: string, groupId: string, groupName: string): SwitchableProject => ({ id, name, group_id: groupId, group_name: groupName });

// 名稱刻意用 A/B/C 前綴：定序不受繁中筆劃規則影響，測的才是分組與接續邏輯本身。
const projects = [
  project("p-qa-1", "QA1 稽核追蹤", "g-qa", "QA 組"),
  project("p-rapv-2", "B 變更登記", "g-rapv", "RA/PV 組"),
  project("p-bd-1", "BD1 授權洽談", "g-bd", "BD 組"),
  project("p-rapv-1", "A 查驗登記", "g-rapv", "RA/PV 組"),
  project("p-rapv-3", "C 年度報告", "g-rapv", "RA/PV 組"),
];

describe("project switcher ordering", () => {
  it("puts the current group first and marks it", () => {
    const groups = groupProjectsForSwitch(projects, "g-rapv");

    expect(groups.map((group) => group.name)).toEqual(["RA/PV 組", "BD 組", "QA 組"]);
    expect(groups[0].isCurrentGroup).toBe(true);
    expect(groups.slice(1).every((group) => !group.isCurrentGroup)).toBe(true);
  });

  it("sorts remaining groups and projects by name", () => {
    const groups = groupProjectsForSwitch(projects, "g-rapv");

    expect(groups[0].projects.map((item) => item.id)).toEqual(["p-rapv-1", "p-rapv-2", "p-rapv-3"]);
    expect(groups.slice(1).map((group) => group.name)).toEqual(["BD 組", "QA 組"]);
  });

  it("re-anchors the order when the current project is in another group", () => {
    expect(orderProjectsForSwitch(projects, "g-bd").map((item) => item.group_name)[0]).toBe("BD 組");
    expect(orderProjectsForSwitch(projects, "g-qa").map((item) => item.group_name)[0]).toBe("QA 組");
  });

  it("keeps a stable order regardless of input order", () => {
    const shuffled = [projects[4], projects[0], projects[3], projects[2], projects[1]];

    expect(orderProjectsForSwitch(shuffled, "g-rapv").map((item) => item.id))
      .toEqual(orderProjectsForSwitch(projects, "g-rapv").map((item) => item.id));
  });
});

describe("next project", () => {
  it("walks through the current group before leaving it", () => {
    expect(nextProjectId(projects, { id: "p-rapv-1", group_id: "g-rapv" })).toBe("p-rapv-2");
    expect(nextProjectId(projects, { id: "p-rapv-2", group_id: "g-rapv" })).toBe("p-rapv-3");
  });

  it("moves on to the next group after the last project of the current group", () => {
    expect(nextProjectId(projects, { id: "p-rapv-3", group_id: "g-rapv" })).toBe("p-bd-1");
  });

  it("wraps around from the last project", () => {
    expect(nextProjectId(projects, { id: "p-qa-1", group_id: "g-qa" })).toBe("p-bd-1");
  });

  it("returns null when there is nothing to switch to", () => {
    expect(nextProjectId([], { id: "p-rapv-1", group_id: "g-rapv" })).toBeNull();
    expect(nextProjectId([projects[3]], { id: "p-rapv-1", group_id: "g-rapv" })).toBeNull();
  });

  it("falls back to the first project when the current one is not visible in the list", () => {
    expect(nextProjectId(projects, { id: "p-missing", group_id: "g-rapv" })).toBe("p-rapv-1");
  });
});

describe("project detail wiring", () => {
  const page = readFileSync(new URL("../src/pages/ProjectDetailPage.tsx", import.meta.url), "utf8");

  it("renders the switcher in the page header", () => {
    expect(page).toContain("<ProjectSwitcher projects={siblings} current={data.project} />");
    expect(page).toContain("data-project-switcher");
  });

  it("resets to overview when the new project has no tab of the current kind", () => {
    expect(page).toContain('if (groupType && !projectTabs(groupType).some(([key]) => key === tab)) setTab("overview");');
  });

  it("clears the previous project and resets to core while the next one loads", () => {
    expect(page).toContain("setData(null); setError(\"\"); setSections([\"core\"]); void load([\"core\"]);");
  });
});
