import { describe, expect, it } from "vitest";
import { calculateAutoProgress } from "../worker/services/auto-progress";
import { canTransitionCcr, formatCcrNo, nextCcrSequenceNumber, nextCcrStatuses } from "../worker/services/ccr";
import { importItemExists, isIsoDate, progressUpdateImportKey, resolveImportUser } from "../worker/services/importer";
import { daysUntilDate, licenseBadgeLevel, licenseNotificationStage } from "../worker/services/licenses";
import { canManageRegwatch } from "../worker/services/regwatch";

describe("V6 CCR", () => {
  it("同年度從 001 起編號", () => expect(nextCcrSequenceNumber([], 2026)).toBe(1));
  it("同年度取最大號加一", () => expect(nextCcrSequenceNumber(["CCR-2026-001", "CCR-2026-009"], 2026)).toBe(10));
  it("忽略其他年度與格式", () => expect(nextCcrSequenceNumber(["CCR-2025-099", "bad"], 2026)).toBe(1));
  it("補滿三位流水號", () => expect(formatCcrNo(2026, 7)).toBe("CCR-2026-007"));
  it("申請只能進評估中", () => expect(nextCcrStatuses("申請")).toEqual(["評估中"]));
  it("評估中可核准或駁回", () => expect(nextCcrStatuses("評估中")).toEqual(["已核准", "駁回"]));
  it("完整主路徑合法", () => expect([["申請", "評估中"], ["評估中", "已核准"], ["已核准", "執行中"], ["執行中", "效期確認"], ["效期確認", "已結案"]].every(([from, to]) => canTransitionCcr(from as never, to as never))).toBe(true));
  it("終態一般使用者不可流轉", () => expect(canTransitionCcr("已結案", "評估中")).toBe(false));
  it("admin 可重開終態到評估中", () => expect(canTransitionCcr("駁回", "評估中", true)).toBe(true));
  it("不可跳過狀態", () => expect(canTransitionCcr("申請", "已核准")).toBe(false));
});

describe("V6 license", () => {
  it("計算到期天數", () => expect(daysUntilDate("2026-08-20", "2026-07-21")).toBe(30));
  it("90 天觸發", () => expect(licenseNotificationStage("2026-10-19", "2026-07-21")).toBe("90"));
  it("60 天觸發", () => expect(licenseNotificationStage("2026-09-19", "2026-07-21")).toBe("60"));
  it("30 天觸發", () => expect(licenseNotificationStage("2026-08-20", "2026-07-21")).toBe("30"));
  it("7 天觸發", () => expect(licenseNotificationStage("2026-07-28", "2026-07-21")).toBe("7"));
  it("逾期首次觸發", () => expect(licenseNotificationStage("2026-07-20", "2026-07-21")).toBe("expired"));
  it("相同里程碑不重複", () => expect(licenseNotificationStage("2026-08-20", "2026-07-21", "30")).toBeNull());
  it("非里程碑不觸發", () => expect(licenseNotificationStage("2026-08-15", "2026-07-21")).toBeNull());
  it("倒數 badge 分級", () => expect(["2027-02-01", "2026-12-01", "2026-09-01", "2026-08-01", "2026-07-20"].map((date) => licenseBadgeLevel(date, "2026-07-21"))).toEqual(["green", "yellow", "orange", "red", "expired"]));
});

describe("V6 OKR, import and regwatch", () => {
  it("KR 納入 auto 進度分母", () => expect(calculateAutoProgress({ completedTasks: 1, totalTasks: 2, completedMilestones: 1, totalMilestones: 1, completedTodos: 0, totalTodos: 1, completedKeyResults: 1, totalKeyResults: 2 }, 0)).toBe(50));
  it("沒有任何項目維持現值", () => expect(calculateAutoProgress({ completedTasks: 0, totalTasks: 0, completedMilestones: 0, totalMilestones: 0, completedTodos: 0, totalTodos: 0, completedKeyResults: 0, totalKeyResults: 0 }, 37)).toBe(37));
  it("email 對應成功", () => expect(resolveImportUser("USER@example.com", new Map([["user@example.com", "usr_1"]]), "admin")).toEqual({ userId: "usr_1", notePrefix: "" }));
  it("email 缺漏 fallback 並保留原負責人", () => expect(resolveImportUser("missing@example.com", new Map(), "admin")).toEqual({ userId: "admin", notePrefix: "【原負責人：missing@example.com】", warning: "找不到使用者 missing@example.com，已改掛執行管理員" }));
  it("進度判重只取前 40 字", () => expect(progressUpdateImportKey("2026-01-01", "a".repeat(45)) === progressUpdateImportKey("2026-01-01", `${"a".repeat(40)}tail`)).toBe(true));
  it("既有鍵會 skip", () => expect(importItemExists(new Set(["key"]), "key")).toBe(true));
  it("不存在鍵會 create", () => expect(importItemExists(new Set(["key"]), "other")).toBe(false));
  it("只接受有效 YYYY-MM-DD", () => expect([isIsoDate("2026-02-28"), isIsoDate("2026-02-30"), isIsoDate("26-02-28")]).toEqual([true, false, false]));
  it("不存在的月份與日期回 false，不丟例外", () => expect(["2026-13-01", "2026-00-10", "2026-01-00", "2026-01-32"].map(isIsoDate)).toEqual([false, false, false, false]));
  it("admin 可管理法規動態", () => expect(canManageRegwatch({ role: "admin", group_id: "grp_clinical" })).toBe(true));
  it("RA/PV member 可管理法規動態", () => expect(canManageRegwatch({ role: "member", group_id: "grp_general" })).toBe(true));
  it("intern 與其他組 member 只能讀", () => expect([canManageRegwatch({ role: "intern", group_id: "grp_general" }), canManageRegwatch({ role: "member", group_id: "grp_qa" })]).toEqual([false, false]));
});
