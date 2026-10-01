import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");

/** 取出 max-width: 1023px 這段 media query 的內容，斷言才不會誤中其他區塊。 */
function touchBlock(): string {
  const start = styles.indexOf("@media (max-width: 1023px)");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = styles.indexOf("{", start); i < styles.length; i += 1) {
    if (styles[i] === "{") depth += 1;
    if (styles[i] === "}") { depth -= 1; if (depth === 0) return styles.slice(start, i + 1); }
  }
  throw new Error("unterminated media query");
}

describe("horizontal scroll containment", () => {
  it("stops wide charts from chaining their scroll to the page", () => {
    expect(styles).toContain(".overflow-x-auto { overscroll-behavior-x: contain; }");
  });
});

describe("touch targets", () => {
  const block = touchBlock();

  it("raises navigation, tabs and opt-in targets to 44px", () => {
    expect(block).toContain("nav a, nav button, .project-tabs button, .touch-target");
    expect(block).toContain("min-height: 44px");
    expect(block).toContain("min-width: 44px");
  });

  it("covers form controls and buttons without forcing a display change", () => {
    expect(block).toContain("select, textarea { min-height: 44px; }");
    expect(block).toContain("button { min-height: 44px; min-width: 44px; }");
    // block/w-full 按鈕若被改成 inline-flex 會破版，所以那條規則只給指定選擇器
    expect(block).not.toMatch(/\bbutton \{[^}]*display:/);
  });


  it("excludes checkbox, radio and range from the min-height rule", () => {
    for (const type of ["checkbox", "radio", "range"]) expect(block).toContain(`:not([type="${type}"])`);
  });
});

describe("mobile density", () => {
  it("lays the dashboard KPI cards out two per row on phones", () => {
    // 一張紙上用細線分欄的登記列：手機兩欄、桌機五欄。
    expect(dashboard).toContain('className="mb-6 grid grid-cols-2 gap-px border border-nexus-line bg-nexus-line');
    expect(dashboard).toContain("lg:grid-cols-5");
    expect(dashboard).not.toContain("grid gap-4 sm:grid-cols-2 lg:grid-cols-5");
  });
});
