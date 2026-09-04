import { describe, expect, it } from "vitest";
import { SITE_UNSET, defaultProjectGroup, filterProjectsBySite, hasUnsetSite, projectSites, readProjectGroup, resolveSite, writeProjectGroup } from "../src/project-list-filter";

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

describe("廠區篩選", () => {
  const rows = [
    { id: "a", site: "Pathone, Inc." }, { id: "b", site: "Pathone, Inc." },
    { id: "c", site: "Norgine" }, { id: "d", site: "" }, { id: "e", site: "  " },
  ];

  it("只列出實際出現過的廠區，去重並排序", () => {
    expect(projectSites(rows)).toEqual(["Norgine", "Pathone, Inc."]);
  });

  it("前後空白視為同一個廠區", () => {
    expect(projectSites([{ site: "健亞" }, { site: " 健亞 " }])).toEqual(["健亞"]);
  });

  it("沒有人填廠區時回空陣列，畫面就不必顯示這個篩選器", () => {
    expect(projectSites([{ site: "" }, {}])).toEqual([]);
  });

  it("選了某個廠區只留該廠區", () => {
    expect(filterProjectsBySite(rows, "Pathone, Inc.").map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("未指定選項只留沒填的，含只有空白的", () => {
    // 正在補資料時要找得到還沒填的那些。
    expect(filterProjectsBySite(rows, SITE_UNSET).map((x) => x.id)).toEqual(["d", "e"]);
  });

  it("全部廠區不過濾", () => {
    expect(filterProjectsBySite(rows, "")).toHaveLength(rows.length);
  });

  it("選過的廠區已不在清單裡就退回全部", () => {
    // 例如切換組別之後，原本選的廠區在新組裡一件都沒有。
    expect(resolveSite("Pathone, Inc.", ["Norgine"])).toBe("");
    expect(resolveSite("Norgine", ["Norgine"])).toBe("Norgine");
  });

  it("未指定不受清單影響，永遠有效", () => {
    // 「沒填廠區的專案」在任何情況下都是一個成立的問題。
    expect(resolveSite(SITE_UNSET, [])).toBe(SITE_UNSET);
  });
});

describe("hasUnsetSite", () => {
  it("回報清單裡有沒有沒填廠區的專案", () => {
    expect(hasUnsetSite([{ site: "Norgine" }, { site: "" }])).toBe(true);
    expect(hasUnsetSite([{ site: "Norgine" }, { site: " 健亞 " }])).toBe(false);
    expect(hasUnsetSite([{ site: "   " }])).toBe(true);
    expect(hasUnsetSite([{}])).toBe(true);
    expect(hasUnsetSite([])).toBe(false);
  });

  it("全部都填了廠區時，「未指定」不再是可選值", () => {
    // 沒有專案是空的話，選了「未指定廠區」必定得到空清單——退回「全部廠區」。
    expect(resolveSite(SITE_UNSET, ["Norgine"], false)).toBe("");
    expect(resolveSite(SITE_UNSET, ["Norgine"], true)).toBe(SITE_UNSET);
  });
});
