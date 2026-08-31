import { describe, expect, it } from "vitest";
import { groupByProduct, hasClusters, relatedProjects } from "../src/project-grouping";

const p = (id: string, product: string, name = id) => ({ id, name, product });

describe("依產品分群", () => {
  it("兩件以上才成群，單獨的集中到最後的其他", () => {
    const sections = groupByProduct([p("a", "Salagen"), p("b", "Gastrilex"), p("c", "Salagen")]);
    expect(sections.map((s) => s.product)).toEqual(["Salagen", ""]);
    expect(sections[0].projects.map((x) => x.id)).toEqual(["a", "c"]);
    expect(sections[1].projects.map((x) => x.id)).toEqual(["b"]);
  });

  it("件數多的群排前面，同件數依產品名", () => {
    const sections = groupByProduct([
      p("a", "Salagen"), p("b", "DST"), p("c", "Salagen"), p("d", "DST"), p("e", "DST"),
      p("f", "Plenvu"), p("g", "Plenvu"),
    ]);
    expect(sections.map((s) => s.product)).toEqual(["DST", "Plenvu", "Salagen"]);
  });

  it("沒填產品的一律進其他，不會自成一群", () => {
    // 三件都沒填只代表都沒填，不代表彼此相關。
    const sections = groupByProduct([p("a", ""), p("b", ""), p("c", "  ")]);
    expect(sections).toEqual([{ product: "", projects: [p("a", ""), p("b", ""), p("c", "  ")] }]);
  });

  it("全部都成群時不產生空的其他區塊", () => {
    const sections = groupByProduct([p("a", "X"), p("b", "X")]);
    expect(sections).toHaveLength(1);
    expect(sections[0].product).toBe("X");
  });

  it("空清單回空陣列", () => {
    expect(groupByProduct([])).toEqual([]);
  });

  it("產品名前後空白視為同一個", () => {
    const sections = groupByProduct([p("a", "Salagen"), p("b", " Salagen ")]);
    expect(sections.map((s) => s.product)).toEqual(["Salagen"]);
  });

  it("每個專案只會出現在一個區塊裡", () => {
    const all = [p("a", "X"), p("b", "X"), p("c", "Y"), p("d", "")];
    const ids = groupByProduct(all).flatMap((s) => s.projects.map((x) => x.id));
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("相關專案", () => {
  const all = [p("a", "Salagen"), p("b", "Salagen"), p("c", "Plenvu"), p("d", "")];

  it("列出同產品的其他專案，不含自己", () => {
    expect(relatedProjects(all, p("a", "Salagen")).map((x) => x.id)).toEqual(["b"]);
  });

  it("沒填產品時不視為與任何人相關", () => {
    expect(relatedProjects(all, p("d", ""))).toEqual([]);
  });

  it("該產品只有自己時回空陣列", () => {
    expect(relatedProjects(all, p("c", "Plenvu"))).toEqual([]);
  });

  it("跨組別也抓得到——Plenvu 同時存在於 BD 與一般組", () => {
    const across = [p("bd", "Plenvu", "Plenvu"), p("ra", "Plenvu", "RA：啟動Plenvu註冊")];
    expect(relatedProjects(across, across[0]).map((x) => x.name)).toEqual(["RA：啟動Plenvu註冊"]);
  });
});

describe("是否有成群", () => {
  it("只有其他區塊時視為沒有分群", () => {
    expect(hasClusters(groupByProduct([p("a", ""), p("b", "X")]))).toBe(false);
  });
  it("有任何一群就是有分群", () => {
    expect(hasClusters(groupByProduct([p("a", "X"), p("b", "X")]))).toBe(true);
  });
});

describe("資料不完整時不讓整頁掛掉", () => {
  it("缺少 product 欄位時視為未指定，而不是丟例外", () => {
    // 型別上 product 必填，但這份清單來自 API；漏帶時 .trim() 會把整頁換成錯誤畫面。
    const rows = [{ id: "a", name: "A" }, { id: "b", name: "B", product: "X" }] as Array<{ id: string; name: string; product: string }>;
    expect(() => groupByProduct(rows)).not.toThrow();
    expect(groupByProduct(rows)).toEqual([{ product: "", projects: rows }]);
    expect(relatedProjects(rows, rows[0])).toEqual([]);
  });
});
