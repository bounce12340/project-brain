import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Empty } from "../src/components/UI";
import { LangProvider } from "../src/i18n/LangContext";
import { en, zh } from "../src/i18n/translations-all";
import { TodoGroups, groupTodos, type Todo } from "../src/pages/TodosPage";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const css = read("styles.css");

type Rgb = [number, number, number];
/** 直接從 styles.css 讀 token，數值改了測試就跟著重算，不另外抄一份色票。 */
function palette(theme: "light" | "dark"): Record<string, Rgb> {
  const start = css.indexOf(theme === "light" ? ':root, :root[data-theme="light"] {' : ':root[data-theme="dark"] {');
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--color-([a-z-]+): (\d+) (\d+) (\d+);/g)].map((match) => [match[1], [Number(match[2]), Number(match[3]), Number(match[4])] as Rgb]));
}
const luminance = (color: Rgb) => color.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
function contrast(a: Rgb, b: Rgb): number { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
/** 半透明的前景疊在底色上之後實際看到的顏色。 */
const over = (front: Rgb, back: Rgb, alpha: number) => front.map((value, index) => value * alpha + back[index] * (1 - alpha)) as Rgb;
const rule = (selector: string) => css.split(/\r?\n/).find((line) => line.trim().startsWith(`${selector} {`)) ?? "";

describe.each(["light", "dark"] as const)("%s 主題的文字對比至少 4.5:1", (theme) => {
  const color = palette(theme);

  it("讀得到完整的 token", () => {
    for (const token of ["void", "nexus", "nexus-raised", "gold-bright", "psi-deep", "star", "star-dim", "ok", "danger"]) expect(color[token], token).toHaveLength(3);
  });

  it("甘特圖的月份與年份標籤用標題墨色，不被淺色主題改成卷宗米", () => {
    expect(css).not.toMatch(/data-theme="light"\] \.gantt-(month|year)-label/);
    expect(rule(".gantt-month-label")).toContain("--color-gold-bright");
    expect(rule(".gantt-year-label")).toContain("--color-gold-bright");
    expect(contrast(color["gold-bright"], color.nexus)).toBeGreaterThanOrEqual(4.5);
  });

  it("日曆上非本月的日期比本月淡，但仍讀得到", () => {
    const calendar = read("components/TaskViews.tsx");
    expect(calendar).toContain('"bg-nexus-raised text-star-dim"');
    expect(calendar).not.toContain("text-star-dim/60");
    expect(contrast(color["star-dim"], color["nexus-raised"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color["star-dim"], color["nexus-raised"])).toBeLessThan(contrast(color.star, color["nexus-raised"]));
  });

  it("日曆的任務小籤在兩種格底上都讀得到", () => {
    expect(read("components/TaskViews.tsx")).toContain("bg-psi-deep/30 px-1.5 py-1 text-xs text-star");
    for (const cell of ["nexus", "nexus-raised"]) expect(contrast(color.star, over(color["psi-deep"], color[cell], 0.3)), cell).toBeGreaterThanOrEqual(4.5);
  });

  it("淡墨章不再靠透明度變淡", () => {
    expect(rule(".stamp-faint")).toContain("opacity: 1;");
    for (const surface of ["void", "nexus", "nexus-raised"]) expect(contrast(color["star-dim"], color[surface]), surface).toBeGreaterThanOrEqual(4.5);
  });

  it("實心刪除按鈕的字在章紅底上讀得到", () => {
    expect(rule(':root[data-theme="dark"] .btn-danger')).toContain("text-void");
    const text: Rgb = theme === "dark" ? color.void : [255, 255, 255];
    expect(contrast(text, color.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it("不塗底的刪除與「＋」在各種紙面上讀得到", () => {
    for (const surface of ["void", "nexus", "nexus-raised"]) {
      expect(contrast(color.danger, color[surface]), `danger on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color.psi, color[surface]), `psi on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("完成提示是綠框綠字的紙條，不是綠底白字", () => {
    expect(rule(".toast")).toContain("border-ok bg-nexus-raised");
    expect(rule(".toast")).toContain("text-ok");
    expect(contrast(color.ok, color["nexus-raised"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("完成提示共用同一個樣式", () => {
  it.each(["pages/TodosPage.tsx", "pages/RegwatchPage.tsx", "pages/ProjectDetailPage.tsx"])("%s", (file) => {
    const source = read(file);
    expect(source).toMatch(/\{toast && <div className="toast fixed /);
    expect(source).not.toContain("bg-ok");
  });
});

describe("按鈕層級：一個畫面一個實心主要按鈕", () => {
  it("專案標題列與首頁批次操作的刪除不是實心章紅", () => {
    expect(read("pages/ProjectDetailPage.tsx")).toContain('<button className="btn-danger-quiet !py-1.5" onClick={() => void remove()}>');
    expect(read("pages/DashboardPage.tsx")).toMatch(/className="btn-danger-quiet[^"]*" disabled=\{!pending \|\| busy\} onClick=\{\(\) => void deleteSelected\(\)\}/);
    expect(rule(".btn-danger-quiet")).toContain("bg-transparent");
    expect(rule(".btn-danger-quiet")).toContain("text-danger");
  });

  it("專案總覽只有「儲存進度」是實心", () => {
    const source = read("pages/ProjectDetailPage.tsx");
    const overview = source.slice(source.indexOf("function Overview("), source.indexOf("function Updates("));
    expect(overview.length).toBeGreaterThan(1000);
    const solid = [...overview.matchAll(/className="btn(?: [^"]*)?"/g)].map((match) => match[0]);
    expect(solid).toEqual(['className="btn mt-3"']);
    expect(overview).toContain('<button className="btn mt-3" onClick={() => void saveProgress()}>');
  });

  it("看板每一欄的「＋」不塗底，仍保有觸控尺寸與名稱", () => {
    const source = read("components/Kanban.tsx");
    expect(source).toContain('<button className="btn-ghost touch-target" aria-label={taskSubmitting ? undefined : t("kanban.newTask")} disabled={taskSubmitting}>');
    expect([...source.matchAll(/className="btn(?: [^"]*)?"/g)]).toHaveLength(1);
    expect(rule(".btn-ghost")).toContain("bg-transparent");
  });
});

describe("Empty 元件", () => {
  it("只給文字時跟以前一樣是一句話", () => {
    const html = renderToStaticMarkup(createElement(Empty, { children: "尚無附件" }));
    expect(html).toBe('<div class="empty-state"><div>尚無附件</div></div>');
  });

  it("action 與 icon 會畫在文字前後，圖示不進無障礙樹", () => {
    const html = renderToStaticMarkup(createElement(Empty, {
      icon: createElement("svg", { "data-icon": "" }),
      action: createElement("button", { className: "btn" }, "新增"),
      children: "還沒有資料",
    }));
    expect(html).toContain('<div class="empty-state-icon" aria-hidden="true"><svg data-icon=""></svg></div>');
    expect(html).toContain('<div class="empty-state-action"><button class="btn">新增</button></div>');
    expect(html.indexOf("empty-state-icon")).toBeLessThan(html.indexOf("還沒有資料"));
    expect(html.indexOf("還沒有資料")).toBeLessThan(html.indexOf("empty-state-action"));
  });
});

describe("我的待辦的空狀態", () => {
  const noop = () => undefined;
  const todo = (fields: Partial<Todo>): Todo => ({ id: "t1", title: "寄送審文件", due_date: null, done: 0, project_id: null, project_name: null, ...fields });
  const render = (todos: Todo[]) => renderToStaticMarkup(createElement(LangProvider, null,
    createElement(TodoGroups, { todos, currentDate: "2026-10-05", onToggle: noop, onDelete: noop, onAddFirst: noop })));

  it("依日期分成今日、逾期、未排程、之後、已完成", () => {
    const groups = groupTodos([
      todo({ id: "a", due_date: "2026-10-05" }), todo({ id: "b", due_date: "2026-10-01" }), todo({ id: "c" }),
      todo({ id: "d", due_date: "2026-10-09" }), todo({ id: "e", due_date: "2026-10-01", done: 1 }),
    ], "2026-10-05");
    expect(groups.map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
      ["todos.today", ["a"]], ["todos.overdue", ["b"]], ["todos.unscheduled", ["c"]], ["todos.later", ["d"]], ["todos.completed", ["e"]],
    ]);
  });

  it("全部都空時只有一個空狀態和一個動作，不是五個「沒有項目」", () => {
    const html = render([]);
    expect(html.match(/class="empty-state"/g)).toHaveLength(1);
    expect(html).toContain(zh["todos.empty"]);
    expect(html).toContain(`<button type="button" class="btn-secondary">${zh["todos.addFirst"]}</button>`);
    expect(html).not.toContain('class="panel"');
    expect(html).not.toContain(zh["common.noItems"]);
  });

  it("有項目時只畫有項目的分組", () => {
    const html = render([todo({ due_date: "2026-10-05" })]);
    expect(html.match(/class="panel"/g)).toHaveLength(1);
    expect(html).toContain(zh["todos.today"]);
    expect(html).not.toContain(zh["todos.completed"]);
    expect(html).not.toContain("empty-state");
  });

  it("新字串中英都有", () => {
    for (const key of ["todos.empty", "todos.addFirst", "projects.empty", "projects.emptyReadOnly", "projects.clearFilters"] as const) {
      expect(zh[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});

describe("沒有內容時不畫用不到的控制項", () => {
  it("專案清單：完全沒有專案時收起篩選列，篩選無結果時留著並提供清除", () => {
    const source = read("pages/ProjectsPage.tsx");
    expect(source).toContain("const noData = !!projects && !projects.length && unfiltered;");
    expect(source).toContain("{!noData && <div className={`panel mb-5 grid gap-3");
    expect(source).toContain('<Empty action={<button className="btn-secondary" onClick={clearFilters}>{t("projects.clearFilters")}</button>}>{t("projects.notFound")}</Empty>');
    expect(source).toContain('t(canCreate ? "projects.empty" : "projects.emptyReadOnly")');
  });

  it("甘特圖：沒有排上日期的項目時只給空狀態，不先畫一張空圖", () => {
    const source = read("components/TaskViews.tsx");
    const gantt = source.slice(source.indexOf("function ProjectGantt("));
    expect(gantt).toContain('{dated.length === 0 ? <section className="panel"><Empty icon={<CalendarIcon />}>{t("views.noGantt")}</Empty></section> : <section className="panel overflow-x-auto !px-0">');
    expect(gantt).not.toContain("{dated.length === 0 && <Empty>");
  });
});

describe("Markdown 的行長與行高", () => {
  it("一行不超過約 38 個全形字，行高 1.75rem", () => {
    const source = read("components/UI.tsx");
    expect(source).toContain('<div className="max-w-[38em] space-y-2 text-sm !leading-7">');
  });
});
