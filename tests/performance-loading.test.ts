import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../tailwind.config.js";

/** 首頁少下載一點：字型用電腦內建的、英文另成一檔、儀表板圖表捲到才載。 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []; });
}
const srcDir = new URL("../src", import.meta.url).pathname;

describe("字型用電腦內建的微軟正黑體", () => {
  it("不再向 Google 下載字型", () => {
    expect(read("index.html")).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(read("src/styles.css")).not.toMatch(/@import|@font-face/);
  });

  it("字型清單以微軟正黑體開頭，Mac 與 Android 退回各自內建的黑體；沒有另外的明體", () => {
    const families = (config.theme.extend as unknown as { fontFamily: Record<string, string[]> }).fontFamily;
    expect(families.sans.slice(0, 3)).toEqual(["Microsoft JhengHei", "微軟正黑體", "PingFang TC"]);
    expect(families.serif).toBeUndefined();
    for (const file of sourceFiles(srcDir)) expect(readFileSync(file, "utf8"), file).not.toContain("font-serif");
  });
});

describe("英文另成一檔，切到英文才下載", () => {
  it("網站的程式不會直接 import 英文檔（只有 LangContext 用動態載入）", () => {
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, "utf8");
      if (file.endsWith("translations-all.ts")) continue;
      expect(text, file).not.toMatch(/from ["'][./]*(i18n\/)?translations-(en|all)["']/);
      if (!file.endsWith("LangContext.tsx")) expect(text, file).not.toContain("translations-en");
    }
    expect(read("src/i18n/translations.ts")).not.toMatch(/export const en\b/);
  });

  it("英文載好之前先用中文，載好之後換成英文", async () => {
    const { dictionary, isLanguageLoaded, loadLanguage } = await import("../src/i18n/LangContext");
    expect(isLanguageLoaded("zh")).toBe(true);
    if (!isLanguageLoaded("en")) expect(dictionary("en")["nav.dashboard"]).toBe("儀表板");
    await loadLanguage("en");
    expect(isLanguageLoaded("en")).toBe(true);
    expect(dictionary("en")["nav.dashboard"]).toBe("Dashboard");
    await loadLanguage("zh");
    expect(dictionary("zh")["nav.dashboard"]).toBe("儀表板");
  });
});

describe("儀表板的圖表捲到附近才載", () => {
  it("圖表包在 WhenVisible 裡，沒捲到之前是同高度的空白卡片", () => {
    const page = read("src/pages/DashboardPage.tsx");
    expect(page).toMatch(/<WhenVisible placeholder=\{chartsPlaceholder\}>\s*<Suspense fallback=\{chartsPlaceholder\}>\s*<DashboardCharts/);
    expect(page).toContain('const DashboardCharts = lazy(() => import("../components/DashboardCharts"));');
    expect(read("src/components/WhenVisible.tsx")).toContain("IntersectionObserver");
  });
});
