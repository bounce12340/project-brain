import { Hono } from "hono";
import type { AppContext } from "../types";
import { getProjectAccess } from "../services/db";
import { requiredString } from "../services/http";
import { llmChat, parseLooseJson } from "../services/llm";
import { canEditProgress, canViewFees, canViewProject } from "../services/permissions";
import { canGenerateReport, canReadReport, generateReport, regenerateWeeklyReports } from "../services/reports";
import { reportPeriod, taipeiDate, type ReportPeriodPreset } from "../services/time";
import { accessFrom, projectRows } from "./projects";
import { createId } from "../services/db";
import { aiLanguageInstruction, draftFallback, normalizeAiLang, riskFallback, scheduleReason, taskFallback } from "../services/ai-language";
import { buildProgressLinksPrompt, progressLinksFallback, sanitizeProgressLinks, type ProgressLinkTask } from "../services/progress-links";

export const reportsRoutes = new Hono<AppContext>();

function placeholders(length: number): string { return Array.from({ length }, () => "?").join(","); }

reportsRoutes.get("/summary", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const group = c.req.query("group");
  if (!from || !to) return c.json({ error: "請提供報表起訖日" }, 422);
  const user = c.get("user");
  const visibleRows = (await projectRows(c.env.DB)).filter((row) => canViewProject(user, accessFrom(row)) && (!group || row.group_id === group));
  const ids = visibleRows.map((row) => row.id);
  if (!ids.length) return c.json({ projects: [], totals: { completed_tasks: 0, enrollments: 0, bd_events: 0 }, fees: [] });
  const marks = placeholders(ids.length);
  const [updates, tasks, enrollments, events] = await Promise.all([
    c.env.DB.prepare(`SELECT project_id,MIN(progress_snapshot) AS first_progress,MAX(progress_snapshot) AS last_progress,COUNT(*) AS updates FROM progress_updates WHERE date(created_at) BETWEEN ? AND ? AND project_id IN (${marks}) GROUP BY project_id`).bind(from, to, ...ids).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT t.project_id,COUNT(*) AS count FROM tasks t JOIN stages s ON s.id=t.stage_id WHERE date(t.updated_at) BETWEEN ? AND ? AND (s.name LIKE '%完成%' OR s.name LIKE '%結案%') AND t.project_id IN (${marks}) GROUP BY t.project_id`).bind(from, to, ...ids).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT project_id,SUM(count) AS count FROM clinical_enrollments WHERE record_date BETWEEN ? AND ? AND project_id IN (${marks}) GROUP BY project_id`).bind(from, to, ...ids).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT bc.project_id,COUNT(*) AS count FROM bd_case_events e JOIN bd_cases bc ON bc.id=e.case_id WHERE e.event_date BETWEEN ? AND ? AND bc.project_id IN (${marks}) GROUP BY bc.project_id`).bind(from, to, ...ids).all<Record<string, unknown>>(),
  ]);
  const feeIds = visibleRows.filter((row) => canViewFees(user, accessFrom(row))).map((row) => row.id);
  const fees = feeIds.length ? (await c.env.DB.prepare(`SELECT project_id,currency,SUM(amount) AS total FROM bd_fees WHERE fee_date BETWEEN ? AND ? AND project_id IN (${placeholders(feeIds.length)}) GROUP BY project_id,currency`).bind(from, to, ...feeIds).all<Record<string, unknown>>()).results : [];
  const byId = (rows: Record<string, unknown>[]) => new Map(rows.map((row) => [String(row.project_id), row]));
  const updateMap = byId(updates.results); const taskMap = byId(tasks.results); const enrollmentMap = byId(enrollments.results); const eventMap = byId(events.results);
  const projects = visibleRows.map((row) => ({ id: row.id, name: row.name, group_name: row.group_name, progress: row.progress, progress_change: Number(updateMap.get(row.id)?.last_progress ?? row.progress) - Number(updateMap.get(row.id)?.first_progress ?? row.progress), updates: Number(updateMap.get(row.id)?.updates ?? 0), completed_tasks: Number(taskMap.get(row.id)?.count ?? 0), enrollments: Number(enrollmentMap.get(row.id)?.count ?? 0), bd_events: Number(eventMap.get(row.id)?.count ?? 0) }));
  return c.json({ projects, totals: { completed_tasks: projects.reduce((sum, row) => sum + row.completed_tasks, 0), enrollments: projects.reduce((sum, row) => sum + row.enrollments, 0), bd_events: projects.reduce((sum, row) => sum + row.bd_events, 0) }, fees });
});

reportsRoutes.get("/ai", async (c) => {
  const user = c.get("user");
  const statement = user.role === "admin"
    ? c.env.DB.prepare("SELECT ar.*,CASE WHEN ar.scope='all' THEN '全公司' ELSE g.name END AS scope_name FROM ai_reports ar LEFT JOIN groups g ON g.id=ar.scope ORDER BY ar.created_at DESC LIMIT 50")
    : c.env.DB.prepare("SELECT ar.*,g.name AS scope_name FROM ai_reports ar JOIN groups g ON g.id=ar.scope WHERE ar.scope=? AND ar.include_private=0 ORDER BY ar.created_at DESC LIMIT 50").bind(user.group_id);
  const result = await statement.all();
  return c.json({ reports: result.results });
});

reportsRoutes.get("/ai/:id", async (c) => {
  const report = await c.env.DB.prepare("SELECT ar.*,CASE WHEN ar.scope='all' THEN '全公司' ELSE g.name END AS scope_name FROM ai_reports ar LEFT JOIN groups g ON g.id=ar.scope WHERE ar.id=?")
    .bind(c.req.param("id")).first<Record<string, unknown> & { scope: string; include_private: number }>();
  if (!report) return c.json({ error: "找不到報告" }, 404);
  if (!canReadReport(c.get("user"), report)) return c.json({ error: "沒有報告讀取權限" }, 403);
  return c.json({ report });
});

const reportPresets = new Set<ReportPeriodPreset>(["this-week", "last-week", "this-month", "last-month"]);

reportsRoutes.post("/ai/generate", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const scope = requiredString(body, "scope");
  const preset = requiredString(body, "period") as ReportPeriodPreset | undefined;
  const includePrivate = body.include_private === true;
  if (!scope || !preset || !reportPresets.has(preset)) return c.json({ error: "請選擇組別與報告期間" }, 422);
  const user = c.get("user");
  if (!canGenerateReport(user, scope, includePrivate)) return c.json({ error: "沒有此範圍的報告產生權限" }, 403);
  if (scope !== "all") {
    const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id=?").bind(scope).first();
    if (!group) return c.json({ error: "找不到組別" }, 404);
  }
  const period = reportPeriod(preset);
  const generated = await generateReport(c.env, { start: period.start, end: period.end, scope, periodType: period.periodType, includePrivate });
  const report = await c.env.DB.prepare("SELECT ar.*,CASE WHEN ar.scope='all' THEN '全公司' ELSE g.name END AS scope_name FROM ai_reports ar LEFT JOIN groups g ON g.id=ar.scope WHERE ar.id=?")
    .bind(generated.id).first();
  return c.json({ report, fallback: generated.fallback }, 201);
});

reportsRoutes.post("/ai/regenerate", async (c) => {
  if (c.get("user").role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const start = requiredString(body, "period_start");
  const end = requiredString(body, "period_end");
  const result = await regenerateWeeklyReports(c.env, start && end ? { start, end } : undefined);
  return c.json(result);
});

export const aiRoutes = new Hono<AppContext>();

aiRoutes.post("/progress-links", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const projectId = requiredString(body, "project_id");
  const content = requiredString(body, "content");
  const lang = normalizeAiLang(body.lang);
  if (!projectId || !content) return c.json({ error: "請提供專案與進度內容" }, 422);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  try {
    const [taskRows, stageRows] = await Promise.all([
      c.env.DB.prepare(`
        SELECT t.id,t.title,s.name AS stage_name
        FROM tasks t JOIN stages s ON s.id=t.stage_id
        WHERE t.project_id=? AND t.done=0
        ORDER BY s.position,t.position,t.created_at
      `).bind(projectId).all<ProgressLinkTask>(),
      c.env.DB.prepare("SELECT name FROM stages WHERE project_id=? ORDER BY position").bind(projectId).all<{ name: string }>(),
    ]);
    const stages = stageRows.results.map((stage) => stage.name);
    const text = await llmChat(c.env, [
      { role: "system", content: buildProgressLinksPrompt(lang) },
      { role: "user", content: JSON.stringify({ today: taipeiDate(), progress: content, unfinished_tasks: taskRows.results, stages, progress_update_id: requiredString(body, "progress_update_id") }) },
    ], { json: true });
    const parsed = parseLooseJson<Record<string, unknown>>(text);
    if (!parsed || !Array.isArray(parsed.complete) || !Array.isArray(parsed.create) || !Array.isArray(parsed.milestones) || !Array.isArray(parsed.dates)) throw new Error("AI 任務連動格式不正確");
    return c.json({ ...sanitizeProgressLinks(parsed, taskRows.results, stages, content, taipeiDate()), fallback: false });
  } catch (error) {
    console.error(JSON.stringify({ message: "進度任務建議降級", project_id: projectId, error: error instanceof Error ? error.message : String(error) }));
    return c.json(progressLinksFallback());
  }
});

aiRoutes.post("/draft-update", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const rawText = requiredString(body, "raw_text");
  const projectId = requiredString(body, "project_id");
  const lang = normalizeAiLang(body.lang);
  if (!rawText || !projectId) return c.json({ error: "請提供雜記與專案" }, 422);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access) || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  try {
    const draft = await llmChat(c.env, [
      { role: "system", content: `${aiLanguageInstruction(lang)} Organize the notes as Markdown with exactly three sections covering progress, risks or blockers, and next steps. Use bullet points, do not invent facts, and output only the draft.` },
      { role: "user", content: rawText },
    ]);
    return c.json({ draft });
  } catch (error) {
    console.error(JSON.stringify({ message: "AI 快寫降級", error: error instanceof Error ? error.message : String(error) }));
    return c.json({ draft: draftFallback(rawText, lang), fallback: true });
  }
});

interface RiskResult { level: "low" | "medium" | "high"; summary: string; suggestions: string[] }
interface ScheduleSuggestion { task_id: string; start_date: string; due_date: string; reason: string }

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function validRisk(value: unknown): value is RiskResult {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return ["low", "medium", "high"].includes(String(row.level)) && typeof row.summary === "string" && Array.isArray(row.suggestions) && row.suggestions.every((item) => typeof item === "string");
}

aiRoutes.post("/task-summary", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const taskId = requiredString(body, "task_id");
  const lang = normalizeAiLang(body.lang);
  if (!taskId) return c.json({ error: "請提供任務" }, 422);
  const task = await c.env.DB.prepare("SELECT t.*,s.name AS stage_name FROM tasks t JOIN stages s ON s.id=t.stage_id WHERE t.id=?").bind(taskId).first<Record<string, unknown>>();
  if (!task) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, String(task.project_id));
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const comments = await c.env.DB.prepare("SELECT u.name,tc.content,tc.created_at FROM task_comments tc JOIN users u ON u.id=tc.author_id WHERE tc.task_id=? ORDER BY tc.created_at").bind(taskId).all();
  const source = JSON.stringify({ task, comments: comments.results });
  try {
    const text = await llmChat(c.env, [
      { role: "system", content: `${aiLanguageInstruction(lang)} Return JSON only: {summary:string, unresolved:string[]}. Limit summary to three sentences; unresolved lists open items. Do not invent facts.` },
      { role: "user", content: source },
    ], { json: true });
    const parsed = parseLooseJson<{ summary?: unknown; unresolved?: unknown }>(text);
    if (parsed && typeof parsed.summary === "string" && Array.isArray(parsed.unresolved) && parsed.unresolved.every((item) => typeof item === "string")) return c.json({ summary: parsed.summary, unresolved: parsed.unresolved, fallback: false });
    throw new Error("AI 摘要格式不正確");
  } catch (error) {
    console.error(JSON.stringify({ message: "任務摘要降級", task_id: taskId, error: error instanceof Error ? error.message : String(error) }));
    return c.json({ ...taskFallback(task, comments.results.length, lang), fallback: true });
  }
});

aiRoutes.post("/project-risk", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const projectId = requiredString(body, "project_id");
  const lang = normalizeAiLang(body.lang);
  if (!projectId) return c.json({ error: "請提供專案" }, 422);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access) || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有分析權限" }, 403);
  const [project, overdueTasks, overdueMilestones, updates] = await Promise.all([
    c.env.DB.prepare("SELECT id,name,progress,start_date,target_date,last_activity_at FROM projects WHERE id=?").bind(projectId).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM tasks WHERE project_id=? AND done=0 AND due_date<date('now')").bind(projectId).first<number>("value"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM milestones WHERE project_id=? AND done=0 AND due_date<date('now')").bind(projectId).first<number>("value"),
    c.env.DB.prepare("SELECT content,created_at FROM progress_updates WHERE project_id=? ORDER BY created_at DESC LIMIT 5").bind(projectId).all(),
  ]);
  if (!project) return c.json({ error: "找不到專案" }, 404);
  const start = isDate(project.start_date) ? new Date(`${project.start_date}T00:00:00Z`).getTime() : Date.now();
  const target = isDate(project.target_date) ? new Date(`${project.target_date}T00:00:00Z`).getTime() : start;
  const elapsedRatio = target > start ? Math.max(0, Math.min(1.5, (Date.now() - start) / (target - start))) : 0;
  const stagnationDays = Math.max(0, Math.floor((Date.now() - new Date(String(project.last_activity_at)).getTime()) / 86_400_000));
  const input = { project, elapsed_ratio: elapsedRatio, overdue_tasks: overdueTasks ?? 0, overdue_milestones: overdueMilestones ?? 0, stagnation_days: stagnationDays, recent_updates: updates.results };
  let result: RiskResult;
  let fallback = false;
  try {
    const text = await llmChat(c.env, [
      { role: "system", content: `${aiLanguageInstruction(lang)} You are a project risk analyst. Return JSON only: {level:'low'|'medium'|'high',summary:string,suggestions:string[]}. Use only facts from the input.` },
      { role: "user", content: JSON.stringify(input) },
    ], { json: true });
    const parsed = parseLooseJson<unknown>(text);
    if (!validRisk(parsed)) throw new Error("AI 風險格式不正確");
    result = parsed;
  } catch (error) {
    fallback = true;
    const high = (overdueTasks ?? 0) + (overdueMilestones ?? 0) >= 3 || stagnationDays > 21 || elapsedRatio - Number(project.progress) / 100 > 0.3;
    const medium = (overdueTasks ?? 0) + (overdueMilestones ?? 0) > 0 || stagnationDays > 10 || elapsedRatio - Number(project.progress) / 100 > 0.15;
    result = riskFallback(high, medium, lang) as RiskResult;
    console.error(JSON.stringify({ message: "專案風險降級", project_id: projectId, error: error instanceof Error ? error.message : String(error) }));
  }
  await c.env.DB.prepare("UPDATE projects SET risk_level=?,risk_summary=?,risk_suggestions=?,risk_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(result.level, result.summary, JSON.stringify(result.suggestions), projectId).run();
  return c.json({ ...result, fallback });
});

function validateSuggestions(
  suggestions: unknown,
  tasks: Array<{ id: string; start_date: string | null; due_date: string | null }>,
  edges: Array<{ task_id: string; depends_on_task_id: string }>,
  projectStart: string,
  projectEnd: string,
): ScheduleSuggestion[] {
  if (!Array.isArray(suggestions)) return [];
  const taskIds = new Set(tasks.map((task) => task.id));
  const parsed = suggestions.filter((item): item is ScheduleSuggestion => {
    if (typeof item !== "object" || item === null) return false;
    const row = item as Record<string, unknown>;
    return typeof row.task_id === "string" && taskIds.has(row.task_id) && isDate(row.start_date) && isDate(row.due_date) && typeof row.reason === "string" && row.start_date >= projectStart && row.due_date <= projectEnd && row.start_date <= row.due_date;
  });
  const dates = new Map(tasks.map((task) => [task.id, { start: task.start_date, due: task.due_date }]));
  for (const item of parsed) dates.set(item.task_id, { start: item.start_date, due: item.due_date });
  return parsed.filter((item) => edges.filter((edge) => edge.task_id === item.task_id).every((edge) => {
    const prerequisite = dates.get(edge.depends_on_task_id);
    return !prerequisite?.due || prerequisite.due <= item.start_date;
  }));
}

aiRoutes.post("/schedule-suggest", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const projectId = requiredString(body, "project_id");
  const lang = normalizeAiLang(body.lang);
  if (!projectId) return c.json({ error: "請提供專案" }, 422);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有排程權限" }, 403);
  const project = await c.env.DB.prepare("SELECT id,name,start_date,target_date FROM projects WHERE id=?").bind(projectId).first<{ id: string; name: string; start_date: string | null; target_date: string | null }>();
  if (!project?.start_date || !project.target_date) return c.json({ error: "請先設定專案起訖日" }, 422);
  const tasks = await c.env.DB.prepare("SELECT id,title,start_date,due_date,created_at,stage_id FROM tasks WHERE project_id=? ORDER BY created_at").bind(projectId).all<{ id: string; title: string; start_date: string | null; due_date: string | null; created_at: string; stage_id: string }>();
  const edges = await c.env.DB.prepare("SELECT td.task_id,td.depends_on_task_id FROM task_dependencies td JOIN tasks t ON t.id=td.task_id WHERE t.project_id=?").bind(projectId).all<{ task_id: string; depends_on_task_id: string }>();
  if (body.apply === true) {
    const valid = validateSuggestions(body.suggestions, tasks.results, edges.results, project.start_date, project.target_date);
    if (!Array.isArray(body.suggestions) || valid.length !== body.suggestions.length) return c.json({ error: "排程建議超出專案日期或違反依賴先後" }, 422);
    if (valid.length) await c.env.DB.batch(valid.map((item) => c.env.DB.prepare("UPDATE tasks SET start_date=?,due_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?").bind(item.start_date, item.due_date, item.task_id, projectId)));
    await c.env.DB.prepare("UPDATE projects SET last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(projectId).run();
    return c.json({ applied: valid.length, suggestions: valid, fallback: false });
  }
  let suggestions: ScheduleSuggestion[] = [];
  let fallback = false;
  try {
    const text = await llmChat(c.env, [
      { role: "system", content: `${aiLanguageInstruction(lang)} Propose dates for tasks that have no schedule. Return JSON only: {suggestions:[{task_id,start_date,due_date,reason}]}. Dates must be within the project range, and each prerequisite due_date must be no later than the dependent task start_date.` },
      { role: "user", content: JSON.stringify({ project, tasks: tasks.results, dependencies: edges.results }) },
    ], { json: true });
    const parsed = parseLooseJson<{ suggestions?: unknown }>(text);
    suggestions = validateSuggestions(parsed?.suggestions, tasks.results, edges.results, project.start_date, project.target_date);
    if (!suggestions.length && tasks.results.some((task) => !task.start_date || !task.due_date)) throw new Error("AI 排程沒有有效建議");
  } catch (error) {
    fallback = true;
    let cursor = project.start_date;
    const raw = tasks.results.filter((task) => !task.start_date || !task.due_date).map((task) => {
      const startDate = task.start_date ?? cursor;
      const due = task.due_date ?? new Date(Math.min(new Date(`${project.target_date}T00:00:00Z`).getTime(), new Date(`${startDate}T00:00:00Z`).getTime() + 2 * 86_400_000)).toISOString().slice(0, 10);
      cursor = new Date(Math.min(new Date(`${project.target_date}T00:00:00Z`).getTime(), new Date(`${due}T00:00:00Z`).getTime() + 86_400_000)).toISOString().slice(0, 10);
      return { task_id: task.id, start_date: startDate, due_date: due, reason: scheduleReason(lang) };
    });
    suggestions = validateSuggestions(raw, tasks.results, edges.results, project.start_date, project.target_date);
    console.error(JSON.stringify({ message: "排程建議降級", project_id: projectId, error: error instanceof Error ? error.message : String(error) }));
  }
  return c.json({ suggestions, fallback });
});
