import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const crystal = readFileSync(resolve("src/components/AuthCrystal.tsx"), "utf8");
const css = readFileSync(resolve("src/styles.css"), "utf8");

describe("v9.1 auth crystal", () => {
  it("uses the specified slender six-facet SVG geometry and gold frame", () => {
    expect(crystal).toContain('viewBox="0 0 100 180"');
    expect(crystal.match(/<polygon/g)).toHaveLength(8);
    for (const color of ["#1A6FA8", "#35C8FF", "#12507E", "#2AA6DB", "#0E3A5C", "#1E86C2"]) {
      expect(crystal).toContain(`fill="${color}"`);
    }
    expect(crystal).toContain('points="50,4 78,42 70,130 50,176 30,130 22,42"');
    expect(crystal).toContain('stroke="#C8A24A"');
    expect(crystal).toContain('strokeWidth="1.5"');
    expect((78 - 22) / (176 - 4)).toBeLessThanOrEqual(0.6);
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

  it("uses an 80px crystal, theme-specific halo, and reduced-motion fallback", () => {
    expect(css).toMatch(/\.auth-crystal-svg\s*\{[^}]*height: 80px/);
    expect(css).toContain(':root[data-theme="light"] .auth-crystal-halo');
    expect(css).toContain("animation: crystal-pulse 4s ease-in-out infinite");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.auth-crystal-halo\s*\{ animation: none; \}/);
  });
});
