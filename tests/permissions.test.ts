import { describe, expect, it } from "vitest";
import { canEditProgress, canManageProject, canViewFees, canViewProject } from "../worker/services/permissions";
import type { AuthUser, ProjectAccess, Role, Visibility } from "../worker/types";

const user = (id: string, role: Role, group = "g1"): AuthUser => ({
  id, role, group_id: group, email: `${id}@test`, name: id, group_name: group, group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1, approval_status: "approved",
});
const project = (visibility: Visibility, members: string[] = []): ProjectAccess => ({ id: "p1", owner_id: "owner", group_id: "g1", visibility, member_ids: members });

describe("canViewProject 權限矩陣", () => {
  const cases: Array<[string, AuthUser, ProjectAccess, boolean]> = [
    ["admin 可看 all", user("admin", "admin", "g2"), project("all"), true],
    ["admin 可看 group", user("admin", "admin", "g2"), project("group"), true],
    ["admin 可看 private", user("admin", "admin", "g2"), project("private"), true],
    ["intern 未加入看不到 all", user("intern", "intern"), project("all"), false],
    ["intern 未加入看不到 group", user("intern", "intern"), project("group"), false],
    ["intern 未加入看不到 private", user("intern", "intern"), project("private"), false],
    ["intern 加入可看 all", user("intern", "intern"), project("all", ["intern"]), true],
    ["intern 加入可看 group", user("intern", "intern"), project("group", ["intern"]), true],
    ["intern 加入可看 private", user("intern", "intern"), project("private", ["intern"]), true],
    ["member 可看 all", user("other", "member", "g2"), project("all"), true],
    ["同組 member 可看 group", user("same", "member"), project("group"), true],
    ["跨組 member 看不到 group", user("other", "member", "g2"), project("group"), false],
    ["被加入的跨組 member 可看 group", user("other", "member", "g2"), project("group", ["other"]), true],
    ["owner 可看 private", user("owner", "member", "g2"), project("private"), true],
    ["被加入 member 可看 private", user("other", "member", "g2"), project("private", ["other"]), true],
    ["同組但未加入 member 看不到 private", user("same", "member"), project("private"), false],
  ];
  it.each(cases)("%s", (_name, actor, target, expected) => expect(canViewProject(actor, target)).toBe(expected));
});

describe("擁有者一律看得到自己的專案", () => {
  // 正式站實況：Michael／Dennis 屬 RA/PV 組，卻擁有 7 個「同組可見」的 BD 組專案，
  // 且專案成員名單是空的。修正前 owner 判斷只寫在 private 分支，group 分支先 return，
  // 導致他們開自己的專案得到 403「沒有檢視權限」。
  const bdProject = (visibility: Visibility): ProjectAccess =>
    ({ id: "p_bd", owner_id: "michael", group_id: "g_bd", visibility, member_ids: [] });
  const michael = user("michael", "member", "g_rapv");

  it.each(["all", "group", "private"] as const)("跨組 owner 可看 visibility=%s 的專案", (visibility) => {
    expect(canViewProject(michael, bdProject(visibility))).toBe(true);
  });

  it("owner 身分不因角色是 intern 而失效", () => {
    // 其餘五個權限函式（編輯／管理／費用／自動化）本來就認 owner，
    // 唯獨檢視不認，會出現「能刪專案卻不能開專案」的矛盾。
    expect(canViewProject(user("michael", "intern", "g_rapv"), bdProject("group"))).toBe(true);
  });

  it("放寬僅限 owner 與成員，其他人不受影響", () => {
    const outsider = user("outsider", "member", "g_rapv");
    expect(canViewProject(outsider, bdProject("group"))).toBe(false);
    expect(canViewProject(outsider, bdProject("private"))).toBe(false);
    expect(canViewProject(user("i", "intern", "g_bd"), bdProject("group"))).toBe(false);
  });

  it("五個權限函式對 owner 的認定一致", () => {
    const target = bdProject("group");
    expect([
      canViewProject(michael, target), canEditProgress(michael, target),
      canManageProject(michael, target), canViewFees(michael, target),
    ]).toEqual([true, true, true, true]);
  });
});

describe("修改與管理權限", () => {
  it("admin 可修改與管理", () => { expect(canEditProgress(user("a", "admin"), project("private"))).toBe(true); expect(canManageProject(user("a", "admin"), project("private"))).toBe(true); });
  it("owner 可修改與管理", () => { expect(canEditProgress(user("owner", "member", "g2"), project("private"))).toBe(true); expect(canManageProject(user("owner", "member", "g2"), project("private"))).toBe(true); });
  it("同組 member 可修改但不可管理", () => { expect(canEditProgress(user("m", "member"), project("group"))).toBe(true); expect(canManageProject(user("m", "member"), project("group"))).toBe(false); });
  it("加入的 intern 可修改但不可管理", () => { expect(canEditProgress(user("i", "intern"), project("private", ["i"]))).toBe(true); expect(canManageProject(user("i", "intern"), project("private", ["i"]))).toBe(false); });
  it("未加入 intern 不可修改", () => expect(canEditProgress(user("i", "intern"), project("all"))).toBe(false));
  it("跨組 member 不可修改", () => expect(canEditProgress(user("m", "member", "g2"), project("all"))).toBe(false));
});

describe("費用可見權限", () => {
  it("admin 可看", () => expect(canViewFees(user("a", "admin", "g2"), project("group"))).toBe(true));
  it("owner 可看", () => expect(canViewFees(user("owner", "member", "g2"), project("group"))).toBe(true));
  it("同組 member 可看", () => expect(canViewFees(user("m", "member"), project("group"))).toBe(true));
  it("加入但跨組 member 不可看", () => expect(canViewFees(user("m", "member", "g2"), project("group", ["m"]))).toBe(false));
  it("同組 intern 不可看", () => expect(canViewFees(user("i", "intern"), project("group", ["i"]))).toBe(false));
});
