import { Hono } from "hono";
import type { AppContext } from "../types";
import { canViewProject } from "../services/permissions";
import { taipeiDate } from "../services/time";
import { accessFrom, projectRows } from "./projects";

/**
 * 跨專案的兩個檢視：
 * - /my-tasks：指派給我、還沒完成的任務與子任務（只算進行中與暫停的專案）。分組（逾期／今天／本週…）在前端做。
 * - /portfolio：所有看得到的專案一張表：燈號、進度、目標日、負責人、任務完成與逾期數、最近一次進度紀錄。
 */
export const workspaceRoutes = new Hono<AppContext>();

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(",");

workspaceRoutes.get("/my-tasks", async (c) => {
  const user = c.get("user");
  const projects = (await projectRows(c.env.DB)).filter((row) => (row.status === "active" || row.status === "paused") && canViewProject(user, accessFrom(row)));
  if (!projects.length) return c.json({ items: [], today: taipeiDate() });
  const ids = projects.map((row) => row.id);
  const names = new Map(projects.map((row) => [row.id, row.name]));
  const [tasks, subtasks] = await Promise.all([
    c.env.DB.prepare(`SELECT t.id,t.title,t.start_date,t.due_date,t.project_id,s.name AS stage,
        (SELECT COUNT(*) FROM subtasks x WHERE x.task_id=t.id) AS subtask_total,
        (SELECT COUNT(*) FROM subtasks x WHERE x.task_id=t.id AND x.done=1) AS subtask_done
      FROM tasks t JOIN stages s ON s.id=t.stage_id WHERE t.assignee_id=? AND t.done=0 AND t.project_id IN (${placeholders(ids.length)})`)
      .bind(user.id, ...ids).all<{ id: string; title: string; start_date: string | null; due_date: string | null; project_id: string; stage: string; subtask_total: number; subtask_done: number }>(),
    c.env.DB.prepare(`SELECT x.id,x.title,x.due_date,x.task_id,t.title AS task_title,t.project_id
      FROM subtasks x JOIN tasks t ON t.id=x.task_id WHERE x.assignee_id=? AND x.done=0 AND t.project_id IN (${placeholders(ids.length)})`)
      .bind(user.id, ...ids).all<{ id: string; title: string; due_date: string | null; task_id: string; task_title: string; project_id: string }>(),
  ]);
  const items = [
    ...tasks.results.map((task) => ({ kind: "task" as const, ...task, project_name: names.get(task.project_id) ?? "" })),
    ...subtasks.results.map((subtask) => ({ kind: "subtask" as const, ...subtask, project_name: names.get(subtask.project_id) ?? "" })),
  ];
  return c.json({ items, today: taipeiDate() });
});

workspaceRoutes.get("/portfolio", async (c) => {
  const user = c.get("user");
  const rows = (await projectRows(c.env.DB)).filter((row) => canViewProject(user, accessFrom(row)));
  if (!rows.length) return c.json({ projects: [], today: taipeiDate() });
  const ids = rows.map((row) => row.id);
  const today = taipeiDate();
  const [counts, updates] = await Promise.all([
    c.env.DB.prepare(`SELECT project_id, COUNT(*) AS total, SUM(done) AS done,
        SUM(CASE WHEN done=0 AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM tasks WHERE project_id IN (${placeholders(ids.length)}) GROUP BY project_id`).bind(today, ...ids)
      .all<{ project_id: string; total: number; done: number | null; overdue: number | null }>(),
    c.env.DB.prepare(`SELECT project_id, MAX(created_at) AS last_update_at FROM progress_updates WHERE project_id IN (${placeholders(ids.length)}) GROUP BY project_id`).bind(...ids)
      .all<{ project_id: string; last_update_at: string }>(),
  ]);
  const countOf = new Map(counts.results.map((row) => [row.project_id, row]));
  const updateOf = new Map(updates.results.map((row) => [row.project_id, row.last_update_at]));
  return c.json({
    today,
    projects: rows.map((row) => ({
      id: row.id, name: row.name, parent_id: row.parent_id ?? null, group_id: row.group_id, group_name: row.group_name,
      status: row.status, progress: row.progress, health: row.health ?? null, health_at: row.health_at ?? null,
      risk_level: row.risk_level ?? null, owner_id: row.owner_id, owner_name: row.owner_name, product: row.product,
      start_date: row.start_date, target_date: row.target_date, last_activity_at: row.last_activity_at,
      visibility: row.visibility,
      task_total: countOf.get(row.id)?.total ?? 0, task_done: countOf.get(row.id)?.done ?? 0, task_overdue: countOf.get(row.id)?.overdue ?? 0,
      last_update_at: updateOf.get(row.id) ?? null,
    })),
  });
});
