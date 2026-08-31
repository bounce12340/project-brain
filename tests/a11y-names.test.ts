import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translations } from "../src/i18n/translations";

const root = new URL("../src/", import.meta.url).pathname;
const sources: Array<[string, string]> = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith(".tsx")) sources.push([full.slice(root.length), readFileSync(full, "utf8")]);
  }
})(root);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("表單控制項都拿得到可存取名稱", () => {
  it("兄弟 <label> 後面的控制項必須自己帶名稱", () => {
    // 這個 codebase 有兩種寫法：<label><span class="label">…</span><control></label> 會關聯，
    // 而 <label class="label">…</label><control> 只是視覺上相鄰，從來沒有真的關聯過。
    // 後者在瀏覽器裡量到的可存取名稱是空的，靠名稱定位的工具就抓不到。
    const orphans: string[] = [];
    for (const [file, source] of sources) {
      for (const match of source.matchAll(/<\/label>\s*<(input|select|textarea)\b([^>]*)>/g)) {
        const attributes = match[2];
        if (/aria-label|aria-labelledby|htmlFor|\bid="|placeholder=|type="hidden"/.test(attributes)) continue;
        orphans.push(`${file}: <${match[1]}${attributes.slice(0, 60)}>`);
      }
    }
    expect(orphans, orphans.join("\n")).toEqual([]);
  });

  it("每個 a11y 名稱兩種語言都有", () => {
    const keys = Object.keys(translations.zh).filter((key) => key.startsWith("a11y."));
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) expect(translations.en[key as keyof typeof translations.en], key).toBeTruthy();
  });
});

describe("同一頁的重複名稱要能分辨", () => {
  it("說明按鈕帶上該欄位的定義，不是每個都叫同一個名字", () => {
    // 專案詳情頁一次會有 13 個說明按鈕。
    const source = read("components/HelpTip.tsx");
    expect(source).toContain("${content.what}");
    expect(source).not.toContain('aria-label={lang === "zh" ? "顯示欄位說明" : "Show field help"}');
  });

  it("列表中的刪除與狀態控制項要說明操作對象", () => {
    for (const [file, needle] of [
      ["pages/TodosPage.tsx", 'a11y.deleteNamed", { title: item.title }'],
      ["components/OkrPanel.tsx", 'a11y.deleteNamed", { title: item.title }'],
      ["components/OkrPanel.tsx", 'a11y.krStatusOf", { title: item.title }'],
      ["components/OkrPanel.tsx", 'a11y.krDone", { title: item.title }'],
      ["components/ProjectTimeline.tsx", 'a11y.deleteNamed", { title: row.item.title }'],
      ["pages/ProjectDetailPage.tsx", 'a11y.removeMember", { name: member.name }'],
    ] as const) {
      expect(read(file), `${file} ${needle}`).toContain(needle);
    }
  });

  it("報表頁上下兩區的期間與組別不會撞名", () => {
    // 上方 AI 報告區用 <label> 包覆，本來就叫「期間」「組別」；下方統計區必須另取名稱。
    const source = read("pages/ReportsPage.tsx");
    expect(source).toContain('a11y.summaryPreset');
    expect(source).toContain('a11y.summaryGroup');
    expect(source).not.toContain('aria-label={t("reports.period")}');
    expect(source).not.toContain('aria-label={t("reports.group")}');
  });
});

describe("狀態不能只用顏色表達", () => {
  it("逾期除了紅框還有文字", () => {
    // 只有 border-danger 的話，DOM 裡讀不到「逾期」，色覺障礙者也分不出來。
    const source = read("components/ProjectTimeline.tsx");
    expect(source).toContain('{t("timeline.overdueBadge")}');
    expect(source).toMatch(/row\.isOverdue &&[\s\S]{0,120}timeline\.overdueBadge/);
    for (const language of ["zh", "en"] as const) expect(translations[language]["timeline.overdueBadge"]).toBeTruthy();
  });
});
