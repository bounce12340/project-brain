import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, activeNavGroup } from "../src/nav-structure";
import { zh } from "../src/i18n/translations";

/** 主導覽分成「專案」與「資源」兩個下拉選單；每個頁面都要找得到入口。 */
describe("主導覽的階層", () => {
  it("專案底下：專案列表、會議記錄、待辦、時間軸、報表、歸檔；資源底下：法規動態、公司外訓、聯絡人", () => {
    expect(NAV_GROUPS.map((group) => [zh[group.label], group.items.map((item) => zh[item.label])])).toEqual([
      ["專案", ["專案列表", "會議記錄", "待辦", "時間軸", "報表", "歸檔"]],
      ["資源", ["法規動態", "公司外訓", "聯絡人"]],
    ]);
  });

  it("目前頁面屬於哪個選單：專案內頁與批次匯入也算專案", () => {
    expect(activeNavGroup("/projects")).toBe("projects");
    expect(activeNavGroup("/projects/prj_1")).toBe("projects");
    expect(activeNavGroup("/import")).toBe("projects");
    expect(activeNavGroup("/meetings")).toBe("projects");
    expect(activeNavGroup("/courses")).toBe("resources");
    expect(activeNavGroup("/contacts")).toBe("resources");
    expect(activeNavGroup("/")).toBeNull();
    expect(activeNavGroup("/notifications")).toBeNull();
    expect(activeNavGroup("/projectsX")).toBeNull();
  });

  it("App 裡每個主要頁面都有導覽入口", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
    const reachable = new Set(["/", "/notifications", "/admin", "/help", "/profile", ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))]);
    // 登入前的頁面、專案內頁、匯入（從專案列表進去）不在導覽列上
    const exempt = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/change-password", "/projects/:id", "/import", "*"]);
    for (const route of routes.filter((path) => !exempt.has(path))) expect(reachable.has(route), route).toBe(true);
  });
});
