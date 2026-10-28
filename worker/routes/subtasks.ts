import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, getProjectAccess, touchProject } from "../services/db";
import { optionalString, requiredString } from "../services/http";
import { isIsoDate } from "../services/importer";
import { canEditProgress, canViewProject } from "../services/permissions";

/**
 * 子任務：任務底下的輕量檢查清單（名稱、完成、可選的負責人與到期日）。
 * 權限跟著所屬任務的專案走；只顯示在任務上（例如 2/4），不計入專案自動進度。
 */
export const subtasksRoutes = new Hono<AppContext>();

export const SUBTASK_TITLE_MAX = 200;
export const MAX_SUBTASKS = 50;

export interface SubtaskRow { id: string; task_id: string; title: string; done: number; done_at: string | null; assignee_id: string | null; assignee_name?: string | null; due_date: string | null; position: number; created_at: string }

const taskProjectId = (db: D1Database, taskId: string) => db.prepare("SELECT project_id FROM tasks WHERE id=?").bind(taskId).first<string>("project_id");

export const listSubtasks = async (db: D1Database, taskId: string) =>
  (await db.prepare("SELECT s.*,u.name AS assignee_name FROM subtasks s LEFT JOIN users u ON u.id=s.assignee_id WHERE s.task_id=? ORDER BY s.position,s.created_at").bind(taskId).all<SubtaskRow>()).results;

/** 檢查欄位；回傳錯誤訊息，或可直接寫入的值（undefined＝沒傳、不改）。 */
async function readFields(db: D1Database, body: Record<string, unknown>): Promise<{ error: string } | { title?: string; assignee_id?: string | null; due_date?: string | null; done?: number }> {
  const fields: { title?: string; assignee_id?: string | null; due_date?: string | null; done?: number } = {};
  if ("title" in body) {
    const title = requiredString(body, "title");
    if (!title) return { error: "請輸入子任務名稱" };
    if ([...title].length > SUBTASK_TITLE_MAX) return { error: `子任務名稱最多 ${SUBTASK_TITLE_MAX} 字` };
    fields.title = title;
  }
  if ("assignee_id" in body) {
    const assignee = optionalString(body, "assignee_id");
    if (assignee && !(await db.prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(assignee).first())) return { error: "找不到負責人" };
    fields.assignee_id = assignee;
  }
  if ("due_date" in body) {
    const due = optionalString(body, "due_date");
    if (due && !isIsoDate(due)) return { error: "到期日格式不正確" };
    fields.due_date = due;
  }
  if ("done" in body) fields.done = body.done ? 1 : 0;
  return fields;
}

subtasksRoutes.get("/tasks/:id/subtasks", async (c) => {
  const projectId = await taskProjectId(c.env.DB, c.req.param("id"));
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  return c.json({ subtasks: await listSubtasks(c.env.DB, c.req.param("id")) });
});

subtasksRoutes.post("/tasks/:id/subtasks", async (c) => {
  const taskId = c.req.param("id");
  const projectId = await taskProjectId(c.env.DB, taskId);
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const fields = await readFields(c.env.DB, { title: "", ...body });
  if ("error" in fields) return c.json(fields, 422);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id=?").bind(taskId).first<{ n: number; next: number }>();
  if ((count?.n ?? 0) >= MAX_SUBTASKS) return c.json({ error: `一個任務最多 ${MAX_SUBTASKS} 個子任務` }, 422);
  const id = createId("sub");
  const done = fields.done ?? 0;
  await c.env.DB.prepare("INSERT INTO subtasks (id,task_id,title,done,done_at,assignee_id,due_date,position) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, taskId, fields.title!, done, done ? new Date().toISOString() : null, fields.assignee_id ?? null, fields.due_date ?? null, count?.next ?? 0).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

subtasksRoutes.patch("/subtasks/:id", async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT s.*,t.project_id FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=?").bind(id).first<SubtaskRow & { project_id: string }>();
  if (!current) return c.json({ error: "找不到子任務" }, 404);
  const access = await getProjectAccess(c.env.DB, current.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const fields = await readFields(c.env.DB, body);
  if ("error" in fields) return c.json(fields, 422);
  const position = "position" in body && Number.isInteger(body.position) ? Number(body.position) : current.position;
  const done = fields.done ?? current.done;
  const doneAt = done ? (current.done ? current.done_at : new Date().toISOString()) : null;
  await c.env.DB.prepare("UPDATE subtasks SET title=?,done=?,done_at=?,assignee_id=?,due_date=?,position=? WHERE id=?")
    .bind(fields.title ?? current.title, done, doneAt, fields.assignee_id !== undefined ? fields.assignee_id : current.assignee_id, fields.due_date !== undefined ? fields.due_date : current.due_date, position, id).run();
  await touchProject(c.env.DB, current.project_id);
  return c.json({ ok: true });
});

subtasksRoutes.delete("/subtasks/:id", async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT t.project_id FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=?").bind(id).first<{ project_id: string }>();
  if (!current) return c.json({ error: "找不到子任務" }, 404);
  const access = await getProjectAccess(c.env.DB, current.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM subtasks WHERE id=?").bind(id).run();
  await touchProject(c.env.DB, current.project_id);
  return c.json({ ok: true });
});
