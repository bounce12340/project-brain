import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/pages/ProjectDetailPage.tsx", import.meta.url), "utf8");
const dashboardCharts = readFileSync(new URL("../src/components/DashboardCharts.tsx", import.meta.url), "utf8");
const enrollmentChart = readFileSync(new URL("../src/components/EnrollmentChart.tsx", import.meta.url), "utf8");
const general = readFileSync(new URL("../worker/routes/general.ts", import.meta.url), "utf8");

describe("recharts stays off the critical path", () => {
  it("is not imported by either page that used to pull it eagerly", () => {
    // recharts 是最大的 chunk（gzip 約 107KB）。靜態 import 會讓它擋在頁面內容前面。
    expect(dashboard).not.toContain('from "recharts"');
    expect(detail).not.toContain('from "recharts"');
  });

  it("lives only in chunks the pages load lazily", () => {
    expect(dashboardCharts).toContain('from "recharts"');
    expect(enrollmentChart).toContain('from "recharts"');
    expect(dashboard).toContain('lazy(() => import("../components/DashboardCharts"))');
    expect(detail).toContain('lazy(() => import("../components/EnrollmentChart"))');
  });

  it("keeps a Suspense boundary around each lazy chart", () => {
    expect(dashboard).toContain("<Suspense");
    expect(dashboard).toContain("<DashboardCharts");
    expect(detail).toContain("<Suspense");
    expect(detail).toContain("<EnrollmentChart");
  });

  it("reserves the chart height while it loads, so content does not jump", () => {
    expect(dashboard).toMatch(/fallback=\{[^}]*h-\[318px\]/);
    expect(detail).toMatch(/fallback=\{[^}]*h-\[300px\]/);
  });
});

describe("dashboard D1 round trips", () => {
  /** 取出 /dashboard handler 的內容。 */
  const handler = (() => {
    const start = general.indexOf('generalRoutes.get("/dashboard"');
    expect(start).toBeGreaterThan(-1);
    return general.slice(start, general.indexOf("\n});", start));
  })();

  it("issues the independent queries as one batch, not one after another", () => {
    const batches = [...handler.matchAll(/Promise\.all\(/g)];
    expect(batches).toHaveLength(1);
  });

  it("leaves only the project lookup awaited on its own", () => {
    // 除了 Promise.all 本身，唯一的循序 await 應該是 projectRows（後面全部依賴它算出的 ids）
    const sequential = handler.split("\n").filter((line) =>
      /await\b/.test(line) && !/Promise\.all/.test(line) && /DB\.prepare|projectRows\(/.test(line));

    expect(sequential).toHaveLength(1);
    expect(sequential[0]).toContain("projectRows(");
  });

  it("still guards every query that needs a non-empty id list", () => {
    for (const guard of ["ids.length ?", "feeIds.length ?", "qaIds.length ?"]) {
      expect(handler).toContain(guard);
    }
  });
});
