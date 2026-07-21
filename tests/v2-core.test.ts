import { describe, expect, it } from "vitest";
import { calculateAutoProgress } from "../worker/services/auto-progress";
import { crossedProgressThreshold, isValidRuleCombination, ruleMatches } from "../worker/services/automation";
import { wouldCreateDependencyCycle } from "../worker/services/dependencies";
import { parseMentionedUserIds } from "../worker/services/mentions";

describe("v2 core", () => {
  it("calculates auto progress across all item types", () => expect(calculateAutoProgress({ completedTasks: 1, totalTasks: 2, completedMilestones: 1, totalMilestones: 1, completedTodos: 0, totalTodos: 1 }, 9)).toBe(50));
  it("rounds auto progress", () => expect(calculateAutoProgress({ completedTasks: 2, totalTasks: 3, completedMilestones: 0, totalMilestones: 0, completedTodos: 0, totalTodos: 0 }, 0)).toBe(67));
  it("keeps current progress when denominator is zero", () => expect(calculateAutoProgress({ completedTasks: 0, totalTasks: 0, completedMilestones: 0, totalMilestones: 0, completedTodos: 0, totalTodos: 0 }, 42)).toBe(42));
  it("parses and de-duplicates known mentions", () => expect(parseMentionedUserIds("請 @陳收案 與 @陳收案 確認", [{ id: "u1", name: "陳收案" }])).toEqual(["u1"]));
  it("ignores unknown mentions", () => expect(parseMentionedUserIds("@不存在 請確認", [{ id: "u1", name: "陳收案" }])).toEqual([]));
  it("does not match a longer unknown name", () => expect(parseMentionedUserIds("@陳收案助理 請確認", [{ id: "u1", name: "陳收案" }])).toEqual([]));
  it("normalizes mention width and case", () => expect(parseMentionedUserIds("＠ＡＬＩＣＥ 請確認".replace("＠", "@"), [{ id: "u1", name: "Alice" }])).toEqual(["u1"]));
  it("rejects a direct dependency cycle", () => expect(wouldCreateDependencyCycle("a", "b", [{ task_id: "b", depends_on_task_id: "a" }])).toBe(true));
  it("rejects a transitive dependency cycle", () => expect(wouldCreateDependencyCycle("a", "b", [{ task_id: "b", depends_on_task_id: "c" }, { task_id: "c", depends_on_task_id: "a" }])).toBe(true));
  it("allows an acyclic dependency", () => expect(wouldCreateDependencyCycle("a", "b", [{ task_id: "b", depends_on_task_id: "c" }])).toBe(false));
  it("rejects self dependency", () => expect(wouldCreateDependencyCycle("a", "a", [])).toBe(true));
  it("fires progress only when crossing upward", () => expect(crossedProgressThreshold(49, 50, 50)).toBe(true));
  it("does not refire above threshold", () => expect(crossedProgressThreshold(50, 75, 50)).toBe(false));
  it("does not fire on downward crossing", () => expect(crossedProgressThreshold(60, 40, 50)).toBe(false));
  it("blocks recursive automation", () => expect(ruleMatches({ trigger_type: "task_done", trigger_param: null, action_type: "notify_user", enabled: 1 }, { type: "task_done", taskId: "t", depth: 1 })).toBe(false));
  it("matches a target stage", () => expect(ruleMatches({ trigger_type: "task_moved_to_stage", trigger_param: "s2", action_type: "notify_user", enabled: 1 }, { type: "task_moved_to_stage", taskId: "t", stageId: "s2" })).toBe(true));
  it("blocks assignment for non-task triggers", () => expect(isValidRuleCombination("progress_reached", "assign_task_to")).toBe(false));
  it("allows assignment for task triggers", () => expect(isValidRuleCombination("task_done", "assign_task_to")).toBe(true));
});
