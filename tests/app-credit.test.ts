import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";

const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("app credit line", () => {
  it("names the author in both languages", () => {
    expect(zh["app.credit"]).toBe("此專案程式由蔡忠栩進行構思、架構、建造、執行而成");
    expect(en["app.credit"]).toContain("Tsai Chung-Hsu");
  });

  it("renders bold, sized from a relative unit so it follows the font-size preference", () => {
    expect(login).toContain('className="app-credit mt-3 font-bold text-star"');
    expect(login).not.toContain("text-[15px]");
    expect(styles).toContain(".app-credit { font-size: calc(15rem / 17); }");
  });

  it("resolves to the requested 15px at the default root size", () => {
    const root = /html \{ font-size: (\d+(?:\.\d+)?)px;/.exec(styles);
    const large = /html\[data-fontsize="large"\] \{ font-size: (\d+(?:\.\d+)?)px;/.exec(styles);

    expect(root).not.toBeNull();
    expect(Number(root?.[1])).toBe(17);
    expect(15 / 17 * Number(root?.[1])).toBeCloseTo(15, 10);
    // 大字體偏好時等比放大，而非固定在 15px
    expect(15 / 17 * Number(large?.[1])).toBeGreaterThan(15);
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
