import { Hono } from "hono";
import type { AppContext } from "../types";
import { getProjectAccess } from "../services/db";
import { requiredString } from "../services/http";
import { llmChat } from "../services/llm";
import { canEditProgress, canViewFees, canViewProject } from "../services/permissions";
import { regenerateWeeklyReports } from "../services/reports";
import { accessFrom, projectRows } from "./projects";

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
  if (c.get("user").role !== "admin") return c.json({ reports: [] });
  const result = await c.env.DB.prepare("SELECT ar.*,CASE WHEN ar.scope='all' THEN '全公司' ELSE g.name END AS scope_name FROM ai_reports ar LEFT JOIN groups g ON g.id=ar.scope ORDER BY ar.created_at DESC LIMIT 50").all();
  return c.json({ reports: result.results });
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

aiRoutes.post("/draft-update", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const rawText = requiredString(body, "raw_text");
  const projectId = requiredString(body, "project_id");
  if (!rawText || !projectId) return c.json({ error: "請提供雜記與專案" }, 422);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access) || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  try {
    const draft = await llmChat(c.env, [
      { role: "system", content: "你是專案管理助理。將使用者雜記整理成繁體中文 Markdown，固定分為「本期進展」「風險或阻礙」「下一步」三段，每段用條列，不能捏造。只輸出草稿。" },
      { role: "user", content: rawText },
    ]);
    return c.json({ draft });
  } catch (error) {
    console.error(JSON.stringify({ message: "AI 快寫降級", error: error instanceof Error ? error.message : String(error) }));
    return c.json({ draft: `## 本期進展\n- ${rawText}\n\n## 風險或阻礙\n- 待補充\n\n## 下一步\n- 待補充`, fallback: true });
  }
});
