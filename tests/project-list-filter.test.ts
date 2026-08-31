import { describe, expect, it } from "vitest";
import { defaultProjectGroup, readProjectGroup, writeProjectGroup } from "../src/project-list-filter";

const store = (value?: string) => ({ getItem: () => value ?? null, setItem: () => {} });
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

describe("記住的組別", () => {
  it("沒有紀錄時回傳 null，不是空字串", () => {
    // 空字串代表「明確選了全部組別」，兩者不能混為一談。
    expect(readProjectGroup(store())).toBeNull();
  });

  it("明確選了全部組別時回傳空字串", () => {
    expect(readProjectGroup(store(""))).toBe("");
  });

  it("localStorage 丟例外時不讓畫面壞掉", () => {
    expect(readProjectGroup(throwing)).toBeNull();
    expect(() => writeProjectGroup("g", throwing)).not.toThrow();
  });
});

describe("預設組別", () => {
  const member = { group_id: "grp_ra", role: "member" };

  it("沒選過時預設自己的組別", () => {
    expect(defaultProjectGroup(null, member)).toBe("grp_ra");
  });

  it("選過就尊重選擇，包含選了全部組別", () => {
    expect(defaultProjectGroup("grp_bd", member)).toBe("grp_bd");
    expect(defaultProjectGroup("", member)).toBe("");
  });

  it("管理員一樣預設自己的組別", () => {
    // 管理員多半也隸屬某一組，先看自己的案子比先看全公司合理。
    expect(defaultProjectGroup(null, { group_id: "grp_ra", role: "admin" })).toBe("grp_ra");
  });

  it("實習生不套用預設", () => {
    // 只看得到被指派的專案，沒有雜訊要濾；再篩組別會藏掉跨組指派的案子。
    expect(defaultProjectGroup(null, { group_id: "grp_ra", role: "intern" })).toBe("");
  });

  it("尚未取得使用者時不預設", () => {
    expect(defaultProjectGroup(null, null)).toBe("");
  });
});
