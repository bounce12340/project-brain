import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";

const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url), "utf8");

describe("app credit line", () => {
  it("names the author in both languages", () => {
    expect(zh["app.credit"]).toBe("此專案程式由蔡忠栩進行構思、架構、建造、執行而成");
    expect(en["app.credit"]).toContain("Tsai Chung-Hsu");
  });

  it("renders bold at 15px, as specified", () => {
    expect(login).toContain('className="mt-3 text-[15px] font-bold text-star"');
  });

  it("sits directly under the brand block, after the tagline", () => {
    const tagline = login.indexOf('t("app.tagline")');
    const credit = login.indexOf('t("app.credit")');
    const emailField = login.indexOf('t("auth.email")');

    expect(tagline).toBeGreaterThan(-1);
    expect(credit).toBeGreaterThan(tagline);
    expect(credit).toBeLessThan(emailField);
  });
});
