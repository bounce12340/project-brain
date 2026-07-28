import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { boundedNumber, integer, optionalString, requiredString } from "../services/http";
import { canEditProgress, canEditProgressUpdate, canViewFees, canViewProject } from "../services/permissions";
import { recomputeAutoProgress } from "../services/auto-progress";
import { runAutomationRules, type AutomationEvent } from "../services/automation";
import { progressAuditExcerpt } from "../services/progress-updates";

export const resourcesRoutes = new Hono<AppContext>();

async function parentProjectId(db: D1Database, table: "stages" | "tasks" | "milestones" | "clinical_enrollments" | "bd_cases" | "bd_fees", id: string): Promise<string | null> {
  return await db.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).bind(id).first<string>("project_id");
}

async function eventProjectId(db: D1Database, id: string): Promise<string | null> {
  return await db.prepare("SELECT bc.project_id FROM bd_case_events e JOIN bd_cases bc ON bc.id=e.case_id WHERE e.id=?").bind(id).first<string>("project_id");
}

resourcesRoutes.post("/projects/:id/stages", async (c) => {
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  if (!name) return c.json({ error: "請輸入階段名稱" }, 422);
  const position = await c.env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS value FROM stages WHERE project_id=?").bind(id).first<number>("value");
  const stageId = createId("stage");
  await c.env.DB.prepare("INSERT INTO stages (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)").bind(stageId, id, name, optionalString(body, "color") ?? "#6366f1", position ?? 0).run();
  await touchProject(c.env.DB, id);
  return c.json({ id: stageId }, 201);
});

resourcesRoutes.patch("/stages/:id", async (c) => {
  const stageId = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "stages", stageId);
  if (!projectId) return c.json({ error: "找不到階段" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT name,color,position FROM stages WHERE id=?").bind(stageId).first<{ name: string; color: string; position: number }>();
  await c.env.DB.prepare("UPDATE stages SET name=?, color=?, position=? WHERE id=?").bind(optionalString(body, "name") ?? current?.name, optionalString(body, "color") ?? current?.color, "position" in body ? integer(body, "position") : current?.position, stageId).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.delete("/stages/:id", async (c) => {
  const stageId = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "stages", stageId);
  if (!projectId) return c.json({ error: "找不到階段" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM tasks WHERE stage_id=?").bind(stageId).first<number>("value");
  if (count) return c.json({ error: "請先搬走此階段的工作卡片" }, 422);
  await c.env.DB.prepare("DELETE FROM stages WHERE id=?").bind(stageId).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/tasks", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = requiredString(body, "title");
  const stageId = requiredString(body, "stage_id");
  if (!title || !stageId) return c.json({ error: "請填工作名稱與階段" }, 422);
  const stage = await c.env.DB.prepare("SELECT id FROM stages WHERE id=? AND project_id=?").bind(stageId, projectId).first();
  if (!stage) return c.json({ error: "階段不屬於此專案" }, 422);
  const position = await c.env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS value FROM tasks WHERE stage_id=?").bind(stageId).first<number>("value");
  const id = createId("task");
  await c.env.DB.prepare("INSERT INTO tasks (id,project_id,stage_id,title,description,assignee_id,due_date,position) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, projectId, stageId, title, optionalString(body, "description") ?? "", optionalString(body, "assignee_id"), optionalString(body, "due_date"), position ?? 0).run();
  await touchProject(c.env.DB, projectId);
  const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
  if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  return c.json({ id }, 201);
});

resourcesRoutes.patch("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "tasks", id);
  if (!projectId) return c.json({ error: "找不到工作" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT * FROM tasks WHERE id=?").bind(id).first<{ title: string; description: string; stage_id: string; assignee_id: string | null; start_date: string | null; due_date: string | null; position: number; done: number }>();
  if (!current) return c.json({ error: "找不到工作" }, 404);
  const stageId = optionalString(body, "stage_id") ?? current.stage_id;
  const stage = await c.env.DB.prepare("SELECT id FROM stages WHERE id=? AND project_id=?").bind(stageId, projectId).first();
  if (!stage) return c.json({ error: "階段不屬於此專案" }, 422);
  const done = "done" in body ? (body.done ? 1 : 0) : current.done;
  await c.env.DB.prepare("UPDATE tasks SET title=?,description=?,stage_id=?,assignee_id=?,start_date=?,due_date=?,position=?,done=?,done_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "title") ?? current.title, optionalString(body, "description") ?? current.description, stageId, "assignee_id" in body ? optionalString(body, "assignee_id") : current.assignee_id, "start_date" in body ? optionalString(body, "start_date") : current.start_date, "due_date" in body ? optionalString(body, "due_date") : current.due_date, "position" in body ? integer(body, "position") : current.position, done, done ? (current.done ? await c.env.DB.prepare("SELECT done_at FROM tasks WHERE id=?").bind(id).first<string>("done_at") : new Date().toISOString()) : null, id).run();
  await touchProject(c.env.DB, projectId);
  const events: AutomationEvent[] = [];
  if (!current.done && done) events.push({ type: "task_done", taskId: id });
  if (stageId !== current.stage_id) events.push({ type: "task_moved_to_stage", taskId: id, stageId });
  if (done !== current.done) {
    const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id, !current.done && done ? `完成任務「${current.title}」` : undefined);
    if (progress?.changed) events.push({ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress });
  }
  if (events.length) await runAutomationRules(c.env.DB, c.get("user").id, projectId, events);
  return c.json({ ok: true });
});

resourcesRoutes.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "tasks", id);
  if (!projectId) return c.json({ error: "找不到工作" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM tasks WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
  if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/milestones", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = requiredString(body, "title");
  if (!title) return c.json({ error: "請輸入里程碑" }, 422);
  const dueDate = optionalString(body, "due_date");
  const duplicate = await c.env.DB.prepare("SELECT id FROM milestones WHERE project_id=? AND title=? AND due_date IS ? LIMIT 1").bind(projectId, title, dueDate).first();
  if (duplicate) return c.json({ error: "相同里程碑已存在" }, 409);
  const position = await c.env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM milestones WHERE project_id=?").bind(projectId).first<number>("value");
  const id = createId("ms");
  await c.env.DB.prepare("INSERT INTO milestones (id,project_id,title,due_date,position) VALUES (?,?,?,?,?)").bind(id, projectId, title, dueDate, position ?? 0).run();
  await touchProject(c.env.DB, projectId);
  const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
  if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  return c.json({ id }, 201);
});

resourcesRoutes.patch("/milestones/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "milestones", id);
  if (!projectId) return c.json({ error: "找不到里程碑" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT * FROM milestones WHERE id=?").bind(id).first<{ title: string; due_date: string | null; done: number; position: number }>();
  if (!current) return c.json({ error: "找不到里程碑" }, 404);
  const done = "done" in body ? (body.done ? 1 : 0) : current.done;
  await c.env.DB.prepare("UPDATE milestones SET title=?,due_date=?,done=?,done_at=?,position=? WHERE id=?").bind(optionalString(body, "title") ?? current.title, "due_date" in body ? optionalString(body, "due_date") : current.due_date, done, done ? new Date().toISOString() : null, "position" in body ? integer(body, "position") : current.position, id).run();
  await touchProject(c.env.DB, projectId);
  const events: AutomationEvent[] = [];
  if (!current.done && done) events.push({ type: "milestone_done" });
  if (done !== current.done) {
    const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id, !current.done && done ? `完成里程碑「${current.title}」` : undefined);
    if (progress?.changed) events.push({ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress });
  }
  if (events.length) await runAutomationRules(c.env.DB, c.get("user").id, projectId, events);
  return c.json({ ok: true });
});

resourcesRoutes.delete("/milestones/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "milestones", id);
  if (!projectId) return c.json({ error: "找不到里程碑" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM milestones WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
  if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/progress-updates", async (c) => {
  const projectId = c.req.param("id");
  const user = c.get("user");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const content = requiredString(body, "content");
  if (!content) return c.json({ error: "請輸入進度內容" }, 422);
  const snapshot = "progress_snapshot" in body ? boundedNumber(body, "progress_snapshot", 0, 100) : null;
  const id = createId("upd");
  await c.env.DB.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot) VALUES (?,?,?,?,?)").bind(id, projectId, user.id, content, snapshot).run();
  if (snapshot !== null) await c.env.DB.prepare("UPDATE projects SET progress=? WHERE id=?").bind(snapshot, projectId).run();
  await touchProject(c.env.DB, projectId);
  if (user.id !== access.owner_id) await writeAudit(c.env.DB, user, "support_update", "project", projectId, `${user.name} 支援填寫進度`);
  return c.json({ id }, 201);
});

resourcesRoutes.patch("/progress-updates/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const update = await c.env.DB.prepare("SELECT id,project_id,author_id,content,progress_snapshot FROM progress_updates WHERE id=?").bind(id).first<{ id: string; project_id: string; author_id: string; content: string; progress_snapshot: number | null }>();
  if (!update) return c.json({ error: "找不到進度紀錄" }, 404);
  const access = await getProjectAccess(c.env.DB, update.project_id);
  if (!access || !canEditProgressUpdate(user, access, update.author_id)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const content = requiredString(body, "content");
  if (!content) return c.json({ error: "請輸入進度內容" }, 422);
  const editedAt = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE progress_updates SET content=?,edited_at=?,edited_by=? WHERE id=?").bind(content, editedAt, user.id, id),
    c.env.DB.prepare("UPDATE projects SET last_activity_at=?,updated_at=? WHERE id=?").bind(editedAt, editedAt, update.project_id),
    c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)")
      .bind(createId("audit"), user.id, "progress_edited", "progress_update", id, `編輯進度紀錄：「${progressAuditExcerpt(content)}」`),
  ]);
  return c.json({ ok: true, edited_at: editedAt });
});

resourcesRoutes.delete("/progress-updates/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const update = await c.env.DB.prepare("SELECT id,project_id,author_id,content,progress_snapshot FROM progress_updates WHERE id=?").bind(id).first<{ id: string; project_id: string; author_id: string; content: string; progress_snapshot: number | null }>();
  if (!update) return c.json({ error: "找不到進度紀錄" }, 404);
  const access = await getProjectAccess(c.env.DB, update.project_id);
  if (!access || !canEditProgressUpdate(user, access, update.author_id)) return c.json({ error: "沒有刪除權限" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)")
      .bind(createId("audit"), user.id, "progress_deleted", "progress_update", id, `刪除進度紀錄：「${progressAuditExcerpt(update.content)}」`),
    c.env.DB.prepare("DELETE FROM progress_updates WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true });
});

resourcesRoutes.put("/projects/:id/clinical/settings", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const target = boundedNumber(body, "target_n", 0, 1_000_000);
  if (target === null) return c.json({ error: "收案目標不正確" }, 422);
  await c.env.DB.prepare("INSERT INTO clinical_settings (project_id,target_n) VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET target_n=excluded.target_n").bind(projectId, Math.round(target)).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/clinical/enrollments", async (c) => {
  const projectId = c.req.param("id");
  const user = c.get("user");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const date = requiredString(body, "record_date");
  const count = boundedNumber(body, "count", 0, 1_000_000);
  if (!date || count === null) return c.json({ error: "日期或人數不正確" }, 422);
  const id = createId("enr");
  await c.env.DB.prepare("INSERT INTO clinical_enrollments (id,project_id,record_date,site,count,note,created_by) VALUES (?,?,?,?,?,?,?)").bind(id, projectId, date, optionalString(body, "site"), Math.round(count), optionalString(body, "note") ?? "", user.id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

resourcesRoutes.delete("/clinical/enrollments/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "clinical_enrollments", id);
  if (!projectId) return c.json({ error: "找不到收案紀錄" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM clinical_enrollments WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/bd/cases", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const caseName = requiredString(body, "case_name");
  const product = requiredString(body, "product_name");
  const type = requiredString(body, "case_type");
  if (!caseName || !product || !type) return c.json({ error: "請填案名、產品與類別" }, 422);
  const id = createId("case");
  await c.env.DB.prepare("INSERT INTO bd_cases (id,project_id,case_name,product_name,case_type,submission_no,current_status,submitted_at,expected_approval,note) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, caseName, product, type, optionalString(body, "submission_no"), optionalString(body, "current_status") ?? "準備文件", optionalString(body, "submitted_at"), optionalString(body, "expected_approval"), optionalString(body, "note") ?? "").run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

resourcesRoutes.patch("/bd/cases/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "bd_cases", id);
  if (!projectId) return c.json({ error: "找不到案件" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT * FROM bd_cases WHERE id=?").bind(id).first<Record<string, string | null>>();
  if (!current) return c.json({ error: "找不到案件" }, 404);
  await c.env.DB.prepare("UPDATE bd_cases SET case_name=?,product_name=?,case_type=?,submission_no=?,current_status=?,submitted_at=?,expected_approval=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "case_name") ?? current.case_name, optionalString(body, "product_name") ?? current.product_name, optionalString(body, "case_type") ?? current.case_type, "submission_no" in body ? optionalString(body, "submission_no") : current.submission_no, optionalString(body, "current_status") ?? current.current_status, "submitted_at" in body ? optionalString(body, "submitted_at") : current.submitted_at, "expected_approval" in body ? optionalString(body, "expected_approval") : current.expected_approval, optionalString(body, "note") ?? current.note, id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.delete("/bd/cases/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "bd_cases", id);
  if (!projectId) return c.json({ error: "找不到案件" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM bd_cases WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.post("/bd/cases/:id/events", async (c) => {
  const caseId = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "bd_cases", caseId);
  if (!projectId) return c.json({ error: "找不到案件" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access || !canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const date = requiredString(body, "event_date");
  const type = requiredString(body, "event_type");
  const description = requiredString(body, "description");
  if (!date || !type || !description) return c.json({ error: "請完整填寫案件歷程" }, 422);
  const id = createId("evt");
  await c.env.DB.prepare("INSERT INTO bd_case_events (id,case_id,event_date,event_type,description,created_by) VALUES (?,?,?,?,?,?)").bind(id, caseId, date, type, description, user.id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

resourcesRoutes.delete("/bd/events/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await eventProjectId(c.env.DB, id);
  if (!projectId) return c.json({ error: "找不到案件歷程" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM bd_case_events WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

resourcesRoutes.post("/projects/:id/bd/fees", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewFees(user, access)) return c.json({ error: "沒有費用權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const date = requiredString(body, "fee_date");
  const category = requiredString(body, "category");
  const amount = boundedNumber(body, "amount", 0, 1_000_000_000);
  if (!date || !category || amount === null) return c.json({ error: "費用日期、類別或金額不正確" }, 422);
  const id = createId("fee");
  await c.env.DB.prepare("INSERT INTO bd_fees (id,project_id,case_id,fee_date,category,amount,currency,note,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, optionalString(body, "case_id"), date, category, amount, optionalString(body, "currency") ?? "TWD", optionalString(body, "note") ?? "", user.id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

resourcesRoutes.delete("/bd/fees/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = await parentProjectId(c.env.DB, "bd_fees", id);
  if (!projectId) return c.json({ error: "找不到費用" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canViewFees(c.get("user"), access)) return c.json({ error: "沒有費用權限" }, 403);
  await c.env.DB.prepare("DELETE FROM bd_fees WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});
