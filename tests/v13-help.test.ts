import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_DEFINITIONS } from "../src/components/OnboardingTour";
import { CONCEPT_DEFINITIONS, HELP_TOPICS, HELP_TOPIC_PLACEMENTS } from "../src/help-topics";
import { HELP_MANUAL } from "../src/pages/HelpPage";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const placementSources = [
  "src/components/AutomationPanel.tsx",
  "src/components/OkrPanel.tsx",
  "src/components/ProgressLinkDialog.tsx",
  "src/components/ProjectFiles.tsx",
  "src/components/QaPanel.tsx",
  "src/components/TaskDrawer.tsx",
  "src/components/TaskViews.tsx",
  "src/pages/NotificationsPage.tsx",
  "src/pages/ProjectDetailPage.tsx",
  "src/pages/RegwatchPage.tsx",
  "src/pages/ReportsPage.tsx",
  "src/pages/TimelinePage.tsx",
  "src/pages/TodosPage.tsx",
].map(read).join("\n");

describe("SPEC-V13 help content", () => {
  it("keeps the required placement list unique", () => {
    expect(new Set(HELP_TOPIC_PLACEMENTS).size).toBe(HELP_TOPIC_PLACEMENTS.length);
  });

  it("has exactly one content record for every required topic", () => {
    expect(Object.keys(HELP_TOPICS).sort()).toEqual([...HELP_TOPIC_PLACEMENTS].sort());
  });

  it("places every required topic in a real UI source file", () => {
    for (const key of HELP_TOPIC_PLACEMENTS) expect(placementSources, key).toContain(`"${key}"`);
  });

  it("uses only valid topic keys in literal HelpTip placements", () => {
    const literals = [...placementSources.matchAll(/<HelpTip\s+topic="([^"]+)"/g)].map((match) => match[1]);
    expect(literals.length).toBeGreaterThan(30);
    for (const key of literals) expect(HELP_TOPIC_PLACEMENTS).toContain(key as typeof HELP_TOPIC_PLACEMENTS[number]);
  });

  it("keeps Chinese and English content structures in parity", () => {
    for (const [key, topic] of Object.entries(HELP_TOPICS)) {
      expect(Object.keys(topic.zh).sort(), key).toEqual(Object.keys(topic.en).sort());
    }
  });

  it("fills every required section and deep link", () => {
    for (const [key, topic] of Object.entries(HELP_TOPICS)) {
      for (const language of ["zh", "en"] as const) {
        expect(topic[language].what.trim().length, `${key}.${language}.what`).toBeGreaterThan(3);
        expect(topic[language].fill.trim().length, `${key}.${language}.fill`).toBeGreaterThan(5);
        expect(topic[language].href, `${key}.${language}.href`).toMatch(/^\/help#[a-z0-9-]+$/);
        expect(topic[language].linkLabel.trim().length, `${key}.${language}.linkLabel`).toBeGreaterThan(3);
      }
    }
  });

  it("keeps Chinese definition and guidance within the specified limits", () => {
    for (const [key, topic] of Object.entries(HELP_TOPICS)) {
      expect([...topic.zh.what].length, `${key}.zh.what`).toBeLessThanOrEqual(30);
      expect([...topic.zh.fill].length, `${key}.zh.fill`).toBeLessThanOrEqual(40);
      if (topic.zh.difference) expect([...topic.zh.difference].length, `${key}.zh.difference`).toBeLessThanOrEqual(40);
    }
  });

  it("keeps English tooltip paragraphs concise", () => {
    for (const [key, topic] of Object.entries(HELP_TOPICS)) {
      for (const field of ["what", "fill", "difference"] as const) {
        const value = topic.en[field];
        if (value) expect(value.trim().split(/\s+/).length, `${key}.en.${field}`).toBeLessThanOrEqual(20);
      }
    }
  });

  it("gives every topic a concrete example signal", () => {
    const signal = /例|Example|→|20\d{2}|TWD|35%|12\/12|Hina|Friday|three|五個|five/i;
    for (const [key, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.zh.fill, `${key}.zh.fill`).toMatch(signal);
      expect(topic.en.fill, `${key}.en.fill`).toMatch(signal);
    }
  });

  it("avoids tautological Chinese definitions", () => {
    const banned = ["用於管理里程碑", "用於管理任務", "用於管理專案", "用來管理通知", "管理自動化規則"];
    const all = Object.values(HELP_TOPICS).flatMap((topic) => [topic.zh.what, topic.zh.fill, topic.zh.difference ?? ""]).join("\n");
    for (const phrase of banned) expect(all).not.toContain(phrase);
  });

  it("uses the comparison table as the source for core concept meanings", () => {
    const zh = Object.fromEntries(CONCEPT_DEFINITIONS.zh.map((item) => [item.key, item]));
    const en = Object.fromEntries(CONCEPT_DEFINITIONS.en.map((item) => [item.key, item]));
    expect(HELP_TOPICS.taskCards.zh.what).toBe(zh.task.meaning);
    expect(HELP_TOPICS.milestones.zh.what).toBe(zh.milestone.meaning);
    expect(HELP_TOPICS.historyEvents.zh.what).toBe(zh.historyEvent.meaning);
    expect(HELP_TOPICS.progressUpdates.zh.what).toBe(zh.progressUpdate.meaning);
    expect(HELP_TOPICS.todos.zh.what).toBe(zh.todo.meaning);
    expect(HELP_TOPICS.taskCards.en.what).toBe(en.task.meaning);
  });

  it("links every tooltip to an anchor rendered by the manual", () => {
    const helpPage = read("src/pages/HelpPage.tsx");
    const anchors = new Set(Object.values(HELP_TOPICS).map((topic) => topic.zh.href.split("#")[1]));
    for (const anchor of anchors) expect(helpPage, anchor).toContain(`"${anchor}"`);
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
      "src/components/AutomationPanel.tsx", "src/components/Layout.tsx", "src/components/ProjectFiles.tsx",
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

  it("keeps HelpTip static and keyboard-accessible", () => {
    const source = read("src/components/HelpTip.tsx");
    expect(source).toContain('role="button"');
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("onPointerEnter");
    expect(source).toContain("onClick={() => setOpen(true)}");
    expect(source).toContain("createPortal");
    expect(source).not.toMatch(/\b(fetch|api)\s*\(/);
  });
});
