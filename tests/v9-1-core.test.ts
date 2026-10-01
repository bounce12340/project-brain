import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const crystal = readFileSync(resolve("src/components/AuthCrystal.tsx"), "utf8");
const css = readFileSync(resolve("src/styles.css"), "utf8");

describe("v9.1 auth crystal", () => {
  it("shows the static brand emblem (the site icon) instead of the glowing SVG crystal", () => {
    expect(crystal).toContain('src="/favicon.svg"');
    expect(crystal).toContain('aria-hidden="true"');
    expect(crystal).not.toContain("<polygon");
  });

  it("keeps the shared crystal in normal flow before auth headings", () => {
    for (const file of ["src/pages/LoginPage.tsx", "src/pages/RegisterPage.tsx"]) {
      const page = readFileSync(resolve(file), "utf8");
      expect(page.indexOf("<AuthCrystal />")).toBeGreaterThan(-1);
      expect(page.indexOf("<AuthCrystal />")).toBeLessThan(page.indexOf('t("app.internal")'));
      expect(page).toContain("auth-stage");
      expect(page).toContain("auth-panel");
    }
    const crystalRule = css.match(/\.auth-crystal\s*\{[^}]+\}/)?.[0] ?? "";
    expect(crystalRule).toContain("margin-bottom: 16px");
    expect(crystalRule).not.toContain("position: absolute");
    expect(css).not.toContain(".login-panel::before");
    expect(css).not.toContain(".login-panel::after");
  });

  it("keeps the cover quiet: no pulsing halo or drifting stars, UIC INTERNAL is a stamp", () => {
    expect(css).toMatch(/\.auth-crystal-svg\s*\{[^}]*height: 56px/);
    expect(css).not.toContain("crystal-pulse");
    expect(css).not.toContain("star-drift");
    for (const file of ["src/pages/LoginPage.tsx", "src/pages/RegisterPage.tsx"]) {
      expect(readFileSync(resolve(file), "utf8")).toContain('<span className="stamp stamp-red !text-sm">{t("app.internal")}</span>');
    }
  });
});
