import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_DEFINITIONS } from "../src/components/OnboardingTour";
import { CONCEPT_DEFINITIONS } from "../src/help-topics";
import { HELP_MANUAL } from "../src/pages/HelpPage";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
describe("SPEC-V13 help content", () => {
  it("keeps the concept comparison table bilingual and complete", () => {
    const keys = ["historyEvent", "milestone", "progressUpdate", "task", "todo"];
    expect(CONCEPT_DEFINITIONS.zh.map((item) => item.key).sort()).toEqual(keys);
    expect(CONCEPT_DEFINITIONS.en.map((item) => item.key).sort()).toEqual(keys);
  });

  // 欄位旁的「?」說明鈕已依使用者要求拿掉；說明改集中在說明頁。
  it("does not bring back the per-field help buttons", () => {
    expect(existsSync(resolve(root, "src/components/HelpTip.tsx"))).toBe(false);
    expect(read("src/styles.css")).not.toContain("help-tip");
  });
});

describe("SPEC-V13 tours and manual", () => {
  it("provides a 12–16 step project tour and an 8–10 step regulatory tour", () => {
    expect(TOUR_DEFINITIONS.project.length).toBeGreaterThanOrEqual(12);
    expect(TOUR_DEFINITIONS.project.length).toBeLessThanOrEqual(16);
    expect(TOUR_DEFINITIONS.regulatory.length).toBeGreaterThanOrEqual(8);
    expect(TOUR_DEFINITIONS.regulatory.length).toBeLessThanOrEqual(10);
  });

  it("keeps every tour step bilingual and concise", () => {
    for (const [name, steps] of Object.entries(TOUR_DEFINITIONS)) {
      for (const [index, step] of steps.entries()) {
        expect([...step.text.zh].length, `${name}.${index}.zh`).toBeLessThanOrEqual(40);
        expect(step.text.en.trim().split(/\s+/).length, `${name}.${index}.en`).toBeLessThanOrEqual(20);
        expect(step.selector, `${name}.${index}.selector`).toMatch(/^\[/);
      }
    }
  });

  it("persists a running tour across route-level Layout remounts", () => {
    const source = read("src/components/OnboardingTour.tsx");
    expect(source).toContain("readTourSession");
    expect(source).toContain("window.sessionStorage.setItem(TOUR_SESSION_KEY");
    expect(source).toContain("window.sessionStorage.removeItem(TOUR_SESSION_KEY)");
  });

  it("points data-tour steps at attributes present outside the tour definition", () => {
    const targets = [
      "src/components/AutomationPanel.tsx", "src/components/Layout.tsx", "src/components/ProgressComposer.tsx",
      "src/components/ProjectCard.tsx", "src/components/ProjectTimeline.tsx",
      "src/components/ProjectFiles.tsx",
      "src/components/TaskDrawer.tsx", "src/components/TaskViews.tsx", "src/pages/DashboardPage.tsx",
      "src/pages/ProjectDetailPage.tsx", "src/pages/ProjectsPage.tsx", "src/pages/RegwatchPage.tsx",
      "src/pages/ReportsPage.tsx", "src/pages/TimelinePage.tsx",
    ].map(read).join("\n");
    for (const steps of Object.values(TOUR_DEFINITIONS)) {
      for (const step of steps) {
        const tourTarget = step.selector.match(/\[data-tour='([^']+)'\]/)?.[1];
        if (tourTarget) expect(targets, tourTarget).toContain(`"${tourTarget}"`);
      }
    }
  });

  it("renders the three manual sections and all deep-link quickstarts", () => {
    const source = read("src/pages/HelpPage.tsx");
    for (const anchor of ["quickstart", "quickstart-a", "quickstart-b", "quickstart-c", "concepts", "feature-index"]) {
      expect(source).toContain(`"${anchor}"`);
    }
  });

  it("gives each quickstart five to eight concrete steps", () => {
    for (const language of ["zh", "en"] as const) {
      for (const scenario of HELP_MANUAL[language].scenarios) {
        expect(scenario.steps.length, `${language}.${scenario.id}`).toBeGreaterThanOrEqual(5);
        expect(scenario.steps.length, `${language}.${scenario.id}`).toBeLessThanOrEqual(8);
      }
    }
  });
});
