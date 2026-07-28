import { Hono } from "hono";
import type { AppContext, ProjectAccess } from "../types";
import { createId, getProjectAccess, touchProject } from "../services/db";
import { optionalString, requiredString } from "../services/http";
import { canEditProgress, canViewFees, canViewProject } from "../services/permissions";
import { accessFrom, projectRows } from "./projects";
import { currentTaipeiQuarter, taipeiDate } from "../services/time";
import { recomputeAutoProgress } from "../services/auto-progress";
import { runAutomationRules } from "../services/automation";

export const generalRoutes = new Hono<AppContext>();

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(",");
}

generalRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const visible = (await projectRows(c.env.DB)).filter((row) => canViewProject(user, accessFrom(row)));
  const ids = visible.map((row) => row.id);
  const today = taipeiDate();
  let overdue = 0;
  let updates: Record<string, unknown>[] = [];
  let enrollments: Record<string, unknown>[] = [];
  let fees: Record<string, unknown>[] = [];
  let licenseAlerts: Record<string, unknown>[] = [];
  const quarter = currentTaipeiQuarter();
  let keyResults = { completed: 0, total: 0 };
  if (ids.length) {
    const inList = placeholders(ids.length);
    const [overdueResult, updateResult, enrollmentResult] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) AS value FROM milestones WHERE kind='milestone' AND done=0 AND due_date < ? AND project_id IN (${inList})`).bind(today, ...ids).first<number>("value"),
      c.env.DB.prepare(`SELECT pu.*,p.name AS project_name,u.name AS author_name FROM progress_updates pu JOIN projects p ON p.id=pu.project_id JOIN users u ON u.id=pu.author_id WHERE pu.project_id IN (${inList}) ORDER BY pu.created_at DESC LIMIT 12`).bind(...ids).all<Record<string, unknown>>(),
      c.env.DB.prepare(`SELECT ce.record_date,ce.count,ce.project_id,p.name AS project_name,cs.target_n FROM clinical_enrollments ce JOIN projects p ON p.id=ce.project_id JOIN clinical_settings cs ON cs.project_id=p.id WHERE ce.project_id IN (${inList}) ORDER BY ce.record_date`).bind(...ids).all<Record<string, unknown>>(),
    ]);
    overdue = overdueResult ?? 0;
    updates = updateResult.results;
    enrollments = enrollmentResult.results;
    const feeIds = visible.filter((row) => canViewFees(user, accessFrom(row))).map((row) => row.id);
    if (feeIds.length) fees = (await c.env.DB.prepare(`SELECT substr(fee_date,1,7) AS month,currency,SUM(amount) AS total FROM bd_fees WHERE project_id IN (${placeholders(feeIds.length)}) GROUP BY month,currency ORDER BY month`).bind(...feeIds).all<Record<string, unknown>>()).results;
    const krCounts = await c.env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='完成' THEN 1 ELSE 0 END) AS completed FROM key_results WHERE quarter=? AND project_id IN (${inList})`).bind(quarter, ...ids).first<{ completed: number | null; total: number }>();
    keyResults = { completed: Number(krCounts?.completed ?? 0), total: Number(krCounts?.total ?? 0) };
    if (user.role === "admin" || user.group_id === "grp_qa") {
      const qaIds = visible.filter((row) => row.group_type === "qa").map((row) => row.id);
      if (qaIds.length) licenseAlerts = (await c.env.DB.prepare(`SELECT l.id,l.name,l.subject,l.expires_at,l.status,p.id AS project_id,p.name AS project_name FROM licenses l JOIN projects p ON p.id=l.project_id WHERE l.status!='已停用' AND l.expires_at<=? AND l.project_id IN (${placeholders(qaIds.length)}) ORDER BY l.expires_at`).bind(addDaysForDashboard(today, 90), ...qaIds).all<Record<string, unknown>>()).results;
    }
  }
  const todoCount = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM todos WHERE user_id=? AND done=0 AND due_date=?").bind(user.id, today).first<number>("value");
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const weekUpdates = ids.length ? await c.env.DB.prepare(`SELECT COUNT(*) AS value FROM progress_updates WHERE created_at>=? AND project_id IN (${placeholders(ids.length)})`).bind(weekAgo, ...ids).first<number>("value") : 0;
  const groupStatus = new Map<string, Record<string, number | string>>();
  for (const project of visible) {
    const item = groupStatus.get(project.group_id) ?? { group: project.group_name, active: 0, paused: 0, done: 0, archived: 0 };
    item[project.status] = Number(item[project.status]) + 1;
    groupStatus.set(project.group_id, item);
  }
  return c.json({
    kpis: { active_projects: visible.filter((row) => row.status === "active").length, overdue_milestones: overdue, today_todos: todoCount ?? 0, week_updates: weekUpdates ?? 0 },
    projects: visible.map(({ member_ids_csv: _memberIds, ...row }) => row), recent_updates: updates,
    charts: { group_status: [...groupStatus.values()], clinical_enrollments: enrollments, bd_fees: fees },
    v6: { quarter, key_results: keyResults, license_alerts: licenseAlerts },
  });
});

function addDaysForDashboard(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

generalRoutes.get("/metadata", async (c) => {
  const [groups, templates, users] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM groups ORDER BY name").all(),
    c.env.DB.prepare("SELECT * FROM stage_templates ORDER BY name").all(),
    c.env.DB.prepare("SELECT id,name,email,role,group_id FROM users WHERE is_active=1 ORDER BY name").all(),
  ]);
  return c.json({ groups: groups.results, templates: templates.results, users: users.results });
});

generalRoutes.get("/todos", async (c) => {
  const result = await c.env.DB.prepare("SELECT t.*,p.name AS project_name FROM todos t LEFT JOIN projects p ON p.id=t.project_id WHERE t.user_id=? ORDER BY t.done,t.due_date,t.created_at DESC").bind(c.get("user").id).all();
  return c.json({ todos: result.results });
});

generalRoutes.post("/todos", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = requiredString(body, "title");
  if (!title) return c.json({ error: "請輸入待辦事項" }, 422);
  const projectId = optionalString(body, "project_id");
  if (projectId) {
    const access = await getProjectAccess(c.env.DB, projectId);
    if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "無法關聯此專案" }, 403);
  }
  const id = createId("todo");
  await c.env.DB.prepare("INSERT INTO todos (id,user_id,title,due_date,project_id) VALUES (?,?,?,?,?)").bind(id, c.get("user").id, title, optionalString(body, "due_date"), projectId).run();
  if (projectId) {
    await touchProject(c.env.DB, projectId);
    const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
    if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  }
  return c.json({ id }, 201);
});

generalRoutes.patch("/todos/:id", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT * FROM todos WHERE id=? AND user_id=?").bind(c.req.param("id"), c.get("user").id).first<{ title: string; due_date: string | null; project_id: string | null; done: number }>();
  if (!current) return c.json({ error: "找不到待辦事項" }, 404);
  const done = "done" in body ? (body.done ? 1 : 0) : current.done;
  const nextProjectId = "project_id" in body ? optionalString(body, "project_id") : current.project_id;
  if (nextProjectId) {
    const access = await getProjectAccess(c.env.DB, nextProjectId);
    if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "無法關聯此專案" }, 403);
  }
  await c.env.DB.prepare("UPDATE todos SET title=?,due_date=?,project_id=?,done=?,done_at=? WHERE id=? AND user_id=?")
    .bind(optionalString(body, "title") ?? current.title, "due_date" in body ? optionalString(body, "due_date") : current.due_date, nextProjectId, done, done ? new Date().toISOString() : null, c.req.param("id"), c.get("user").id).run();
  let projectProgress: number | undefined;
  for (const projectId of new Set([current.project_id, nextProjectId].filter((value): value is string => !!value))) {
    await touchProject(c.env.DB, projectId);
    const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id, projectId === nextProjectId && !current.done && done ? `完成待辦「${current.title}」` : undefined);
    if (projectId === nextProjectId) projectProgress = progress?.progress;
    if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  }
  return c.json({ ok: true, project_progress: projectProgress });
});

generalRoutes.delete("/todos/:id", async (c) => {
  const current = await c.env.DB.prepare("SELECT project_id FROM todos WHERE id=? AND user_id=?").bind(c.req.param("id"), c.get("user").id).first<{ project_id: string | null }>();
  await c.env.DB.prepare("DELETE FROM todos WHERE id=? AND user_id=?").bind(c.req.param("id"), c.get("user").id).run();
  if (current?.project_id) {
    await touchProject(c.env.DB, current.project_id);
    const progress = await recomputeAutoProgress(c.env.DB, current.project_id, c.get("user").id);
    if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, current.project_id, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  }
  return c.json({ ok: true });
});

generalRoutes.get("/notifications", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(c.get("user").id).all();
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM notifications WHERE user_id=? AND read=0").bind(c.get("user").id).first<number>("value");
  return c.json({ notifications: result.results, unread: unread ?? 0 });
});

generalRoutes.post("/notifications/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=?").bind(c.req.param("id"), c.get("user").id).run();
  return c.json({ ok: true });
});

generalRoutes.post("/notifications/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read=1 WHERE user_id=?").bind(c.get("user").id).run();
  return c.json({ ok: true });
});

generalRoutes.patch("/profile", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const enabled = body.email_notifications === true || body.email_notifications === 1 ? 1 : 0;
  await c.env.DB.prepare("UPDATE users SET email_notifications=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(enabled, c.get("user").id).run();
  return c.json({ ok: true });
});
