/**
 * AI 產生的「專案內容與時程」草稿，在送到畫面與資料庫之前先消毒。
 *
 * 模型會回一坨自由格式的 JSON：階段名可能是它自己編的、日期可能是「下個月」、
 * 標題可能是空字串或一整段文章。這裡把它壓成一定寫得進資料庫的形狀，
 * 因為後端的建立端點只做「必填」檢查，不會替我們擋掉幻覺。
 */

export interface PlanTask { title: string; stage: string; due_date: string }
export interface PlanMilestone { title: string; due_date: string; end_date: string }
export interface ProjectPlan { tasks: PlanTask[]; milestones: PlanMilestone[] }

/** 一次最多提幾項。模型偶爾會一口氣列出七十條，那不是草稿，是垃圾。 */
export const MAX_PLAN_TASKS = 30;
export const MAX_PLAN_MILESTONES = 15;
const MAX_TITLE = 200;

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const cleanTitle = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";

const asDate = (value: unknown): string => (isIsoDate(value) ? value : "");

/**
 * 階段名一律對回專案裡真的存在的那幾個。模型很愛回「待辦」「To Do」這種它以為有的名字；
 * 後端會用 422 擋下不屬於這個專案的階段，但那時使用者已經按了確認，看到的是一排失敗。
 */
function resolveStage(value: unknown, stages: string[]): string {
  const wanted = typeof value === "string" ? value.trim().toLowerCase() : "";
  const exact = stages.find((stage) => stage.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const partial = wanted ? stages.find((stage) => stage.toLowerCase().includes(wanted) || wanted.includes(stage.toLowerCase())) : undefined;
  return partial ?? stages[0] ?? "";
}

export function sanitizePlan(raw: unknown, stages: string[]): ProjectPlan {
  const source = (raw ?? {}) as Record<string, unknown>;
  const seenTask = new Set<string>();
  const tasks: PlanTask[] = [];
  for (const item of Array.isArray(source.tasks) ? source.tasks : []) {
    if (tasks.length >= MAX_PLAN_TASKS) break;
    const row = (item ?? {}) as Record<string, unknown>;
    const title = cleanTitle(row.title);
    const stage = resolveStage(row.stage, stages);
    // 沒有階段就寫不進去（後端必填），沒有標題的項目對使用者也毫無意義。
    if (!title || !stage) continue;
    const key = `${title} ${stage}`;
    if (seenTask.has(key)) continue;
    seenTask.add(key);
    tasks.push({ title, stage, due_date: asDate(row.due_date) });
  }

  const seenMilestone = new Set<string>();
  const milestones: PlanMilestone[] = [];
  for (const item of Array.isArray(source.milestones) ? source.milestones : []) {
    if (milestones.length >= MAX_PLAN_MILESTONES) break;
    const row = (item ?? {}) as Record<string, unknown>;
    const title = cleanTitle(row.title);
    if (!title) continue;
    const dueDate = asDate(row.due_date);
    let endDate = asDate(row.end_date);
    // 結束日早於開始日的話整段期間是壞的；丟掉結束日比丟掉整條里程碑好。
    if (endDate && (!dueDate || endDate < dueDate)) endDate = "";
    // 後端用「標題＋開始日」判重複並回 409。先在這裡去掉，使用者才不會看到一排「相同里程碑已存在」。
    const key = `${title} ${dueDate}`;
    if (seenMilestone.has(key)) continue;
    seenMilestone.add(key);
    milestones.push({ title, due_date: dueDate, end_date: endDate });
  }
  return { tasks, milestones };
}

export function planCount(plan: ProjectPlan): number {
  return plan.tasks.length + plan.milestones.length;
}
