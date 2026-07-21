import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { en, translations, zh } from "../src/i18n/translations";
import { LANG_STORAGE_KEY, normalizeLang, readStoredLang } from "../src/i18n/LangContext";
import { backendErrorKeys, translateBackendError } from "../src/i18n/errors";
import { THEME_STORAGE_KEY, normalizeTheme, readStoredTheme } from "../src/theme/ThemeContext";
import { aiLanguageInstruction, draftFallback, normalizeAiLang, scheduleReason, taskFallback } from "../worker/services/ai-language";
import { relativeTime } from "../src/utils/localized";

describe("v9 i18n", () => {
  it("keeps zh and en keys in exact parity", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
  it("contains a non-empty professional English value for every key", () => {
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(translations.en[key].trim(), key).not.toBe("");
      if (key !== "lang.zh") expect(translations.en[key], key).not.toMatch(/\p{Script=Han}/u);
    }
    expect(en["nav.regwatch"]).toBe("Regulatory Watch");
  });
  it("defaults language to zh and restores a valid stored language", () => {
    expect(normalizeLang(undefined)).toBe("zh");
    expect(readStoredLang({ getItem: (key) => key === LANG_STORAGE_KEY ? "en" : null })).toBe("en");
    expect(readStoredLang({ getItem: () => "fr" })).toBe("zh");
  });
  it("maps common backend errors and preserves unknown messages", () => {
    expect(Object.keys(backendErrorKeys).length).toBeGreaterThanOrEqual(20);
    expect(translateBackendError("找不到專案", (key) => en[key])).toBe("Project not found.");
    expect(translateBackendError("保留原文", (key) => en[key])).toBe("保留原文");
  });
  it("formats relative time in the selected language", () => {
    const now = Date.parse("2026-07-22T00:10:00Z");
    expect(relativeTime("2026-07-22T00:05:00Z", "zh", now)).toBe("5 分鐘前");
    expect(relativeTime("2026-07-22T00:05:00Z", "en", now)).toBe("5 minutes ago");
  });
});

describe("v9 theme", () => {
  it("defaults theme to dark and restores only a valid light preference", () => {
    expect(normalizeTheme(undefined)).toBe("dark");
    expect(readStoredTheme({ getItem: (key) => key === THEME_STORAGE_KEY ? "light" : null })).toBe("light");
    expect(readStoredTheme({ getItem: () => "system" })).toBe("dark");
  });
  it("defines both token palettes and a pre-render FOUC guard", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(css).toContain(':root[data-theme="dark"]'); expect(css).toContain(':root[data-theme="light"]');
    expect(html).toContain('localStorage.getItem("AIUR_THEME")'); expect(html).toContain('data-theme="dark"');
  });
  it("meets light-palette contrast targets for text and interactive colors", () => {
    const colors = { void: "#F1EDE3", nexus: "#FBF9F4", raised: "#FFFFFF", goldBright: "#8A6D1F", psi: "#0B76B8", star: "#1B2436", starDim: "#55617A", ok: "#1F7A56", warn: "#9A6A14", danger: "#C22F40" };
    expect(contrast(colors.star, colors.nexus)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors.starDim, colors.nexus)).toBeGreaterThanOrEqual(4.5);
    for (const key of ["goldBright", "psi", "ok", "warn", "danger"] as const) expect(contrast(colors[key], colors.raised), key).toBeGreaterThanOrEqual(3);
  });
});

describe("v9 AI language", () => {
  it("defaults to zh and creates distinct language instructions", () => {
    expect(normalizeAiLang(undefined)).toBe("zh"); expect(normalizeAiLang("en")).toBe("en");
    expect(aiLanguageInstruction("en")).toContain("English"); expect(aiLanguageInstruction("zh")).toContain("繁體中文");
  });
  it("localizes every rule-based fallback", () => {
    expect(draftFallback("done", "en")).toContain("Progress this period"); expect(draftFallback("完成", "zh")).toContain("本期進展");
    expect(taskFallback({ title: "Task", stage_name: "Doing", done: 0 }, 0, "en").summary).toContain("in progress");
    expect(scheduleReason("en")).toContain("three-day"); expect(scheduleReason("zh")).toContain("三日");
  });
});

function contrast(a: string, b: string): number { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
function luminance(hex: string): number { return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); }
