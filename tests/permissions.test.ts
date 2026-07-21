import { describe, expect, it } from "vitest";
import { canEditProgress, canManageProject, canViewFees, canViewProject } from "../worker/services/permissions";
import type { AuthUser, ProjectAccess, Role, Visibility } from "../worker/types";

const user = (id: string, role: Role, group = "g1"): AuthUser => ({
  id, role, group_id: group, email: `${id}@test`, name: id, group_name: group, group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1,
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
