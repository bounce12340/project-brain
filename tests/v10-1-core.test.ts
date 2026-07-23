import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";

const page = readFileSync(resolve("src/pages/RegwatchPage.tsx"), "utf8");
const css = readFileSync(resolve("src/styles.css"), "utf8");

describe("SPEC-V10-1 法規列表列層級刪除 icon", () => {
  it("只對 can_manage 顯示列層級按鈕，並沿用既有刪除流程", () => {
    expect(page).toMatch(/data\.can_manage && <button[^>]+data-regwatch-row-delete/);
    expect(page).toContain('aria-label={t("common.delete")}');
    expect(page).toContain('title={t("common.delete")}');
    expect(page).toMatch(/data-regwatch-row-delete[\s\S]+event\.stopPropagation\(\); void remove\(item\);/);
    expect(page).toContain('<svg aria-hidden="true" viewBox="0 0 24 24">');
  });

  it("保留展開內容底部既有編輯與刪除按鈕", () => {
    expect(page).toContain('<button className="btn-secondary" onClick={() => setEditing(item)}>{t("common.edit")}</button><button className="btn-danger" onClick={() => void remove(item)}>{t("common.delete")}</button>');
  });

  it("使用雙主題 token 呈現 star-dim、danger hover 與微光暈", () => {
    expect(css).toContain(".regwatch-row-delete");
    expect(css).toContain("@apply inline-flex h-8 w-8 shrink-0 items-center justify-center text-star-dim hover:text-danger;");
    expect(css).toContain("box-shadow: 0 0 12px rgb(var(--color-danger) / .35);");
    expect(css).toContain("stroke: currentColor");
    expect(css).toContain('button, input, select, textarea { @apply focus-visible:outline');
  });

  it("刪除輔助文字維持中英 parity", () => {
    expect(zh["common.delete"]).toBe("刪除");
    expect(en["common.delete"]).toBe("Delete");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
