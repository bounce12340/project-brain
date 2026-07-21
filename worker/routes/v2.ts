import { Hono } from "hono";
import type { AppContext, AuthUser } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { wouldCreateDependencyCycle, type DependencyEdge } from "../services/dependencies";
import { r2FileStore } from "../services/filestore";
import { optionalString, requiredString } from "../services/http";
import { parseMentionedUserIds } from "../services/mentions";
import { canEditProgress, canManageAutomation, canViewProject } from "../services/permissions";
import { isValidRuleCombination, type ActionType, type TriggerType } from "../services/automation";
import { accessFrom, projectRows } from "./projects";

export const v2Routes = new Hono<AppContext>();

async function taskProjectId(db: D1Database, taskId: string): Promise<string | null> {
  return await db.prepare("SELECT project_id FROM tasks WHERE id=?").bind(taskId).first<string>("project_id");
}

async function projectUsers(db: D1Database, projectId: string): Promise<AuthUser[]> {
  const access = await getProjectAccess(db, projectId);
  if (!access) return [];
  const users = await db.prepare(`SELECT u.id,u.email,u.name,u.role,u.group_id,g.name AS group_name,g.type AS group_type,
    u.must_change_password,u.email_notifications,u.onboarding_done
    FROM users u JOIN groups g ON g.id=u.group_id WHERE u.is_active=1 ORDER BY u.name`).all<AuthUser>();
  return users.results.filter((user) => canViewProject(user, access));
}

v2Routes.get("/groups", async (c) => c.json({ groups: (await c.env.DB.prepare("SELECT * FROM groups ORDER BY name").all()).results }));

v2Routes.get("/projects/:id/mentionables", async (c) => {
  const access = await getProjectAccess(c.env.DB, c.req.param("id"));
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  return c.json({ users: (await projectUsers(c.env.DB, access.id)).map(({ id, name }) => ({ id, name })) });
});

v2Routes.get("/tasks/:id/dependencies", async (c) => {
  const projectId = await taskProjectId(c.env.DB, c.req.param("id"));
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const result = await c.env.DB.prepare("SELECT td.*,t.title AS depends_on_title FROM task_dependencies td JOIN tasks t ON t.id=td.depends_on_task_id WHERE td.task_id=?").bind(c.req.param("id")).all();
  return c.json({ dependencies: result.results });
});

v2Routes.post("/tasks/:id/dependencies", async (c) => {
  const taskId = c.req.param("id");
  const projectId = await taskProjectId(c.env.DB, taskId);
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const dependsOn = requiredString(body, "depends_on_task_id");
  if (!dependsOn || !(await c.env.DB.prepare("SELECT id FROM tasks WHERE id=? AND project_id=?").bind(dependsOn, projectId).first())) return c.json({ error: "前置任務不屬於此專案" }, 422);
  const edges = await c.env.DB.prepare("SELECT td.task_id,td.depends_on_task_id FROM task_dependencies td JOIN tasks t ON t.id=td.task_id WHERE t.project_id=?").bind(projectId).all<DependencyEdge>();
  if (wouldCreateDependencyCycle(taskId, dependsOn, edges.results)) return c.json({ error: "依賴關係會形成循環" }, 422);
  await c.env.DB.prepare("INSERT OR IGNORE INTO task_dependencies (task_id,depends_on_task_id) VALUES (?,?)").bind(taskId, dependsOn).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true }, 201);
});

v2Routes.delete("/tasks/:id/dependencies/:dependsOnId", async (c) => {
  const taskId = c.req.param("id");
  const projectId = await taskProjectId(c.env.DB, taskId);
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?").bind(taskId, c.req.param("dependsOnId")).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

v2Routes.get("/tasks/:id/comments", async (c) => {
  const projectId = await taskProjectId(c.env.DB, c.req.param("id"));
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const result = await c.env.DB.prepare("SELECT tc.*,u.name AS author_name FROM task_comments tc JOIN users u ON u.id=tc.author_id WHERE tc.task_id=? ORDER BY tc.created_at").bind(c.req.param("id")).all();
  return c.json({ comments: result.results });
});

v2Routes.post("/tasks/:id/comments", async (c) => {
  const taskId = c.req.param("id");
  const projectId = await taskProjectId(c.env.DB, taskId);
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access || !canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const content = requiredString(body, "content");
  if (!content) return c.json({ error: "請輸入留言" }, 422);
  const task = await c.env.DB.prepare("SELECT title FROM tasks WHERE id=?").bind(taskId).first<{ title: string }>();
  const mentionables = await projectUsers(c.env.DB, projectId);
  const mentioned = parseMentionedUserIds(content, mentionables).filter((id) => id !== user.id);
  const statements = [c.env.DB.prepare("INSERT INTO task_comments (id,task_id,author_id,content) VALUES (?,?,?,?)").bind(createId("cmt"), taskId, user.id, content)];
  for (const mentionedId of mentioned) statements.push(c.env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)")
    .bind(createId("noti"), mentionedId, "mention", `${user.name} 在任務提及您`, `${task?.title ?? "任務"}：${content}`, `/projects/${projectId}?task=${taskId}`));
  await c.env.DB.batch(statements);
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true, mentioned_user_ids: mentioned }, 201);
});

v2Routes.get("/projects/:id/files", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const result = await c.env.DB.prepare("SELECT f.*,u.name AS uploaded_by_name,t.title AS task_title FROM files f JOIN users u ON u.id=f.uploaded_by LEFT JOIN tasks t ON t.id=f.task_id WHERE f.project_id=? ORDER BY f.created_at DESC").bind(projectId).all();
  return c.json({ files: result.results });
});

v2Routes.post("/projects/:id/files", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const form = await c.req.raw.formData();
  const value = form.get("file");
  if (!(value instanceof File)) return c.json({ error: "請選擇檔案" }, 422);
  if (value.size > 25 * 1024 * 1024) return c.json({ error: "單一檔案不可超過 25 MB" }, 422);
  const taskId = typeof form.get("task_id") === "string" && String(form.get("task_id")).trim() ? String(form.get("task_id")) : null;
  if (taskId && !(await c.env.DB.prepare("SELECT id FROM tasks WHERE id=? AND project_id=?").bind(taskId, projectId).first())) return c.json({ error: "任務不屬於此專案" }, 422);
  const fileId = createId("file");
  const filename = value.name.replace(/[\\/]/g, "_") || "file";
  const storageKey = `p/${projectId}/${fileId}/${filename}`;
  const store = r2FileStore(c.env.FILES);
  await store.put(storageKey, value, value.type || "application/octet-stream");
  try {
    await c.env.DB.prepare("INSERT INTO files (id,project_id,task_id,filename,size,content_type,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?)")
      .bind(fileId, projectId, taskId, filename, value.size, value.type || "application/octet-stream", storageKey, user.id).run();
  } catch (error) {
    await store.delete(storageKey);
    throw error;
  }
  await touchProject(c.env.DB, projectId);
  await writeAudit(c.env.DB, user, "file_upload", "file", fileId, `上傳檔案「${filename}」`);
  return c.json({ id: fileId, filename, size: value.size }, 201);
});

v2Routes.get("/files/:id/download", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM files WHERE id=?").bind(c.req.param("id")).first<{ project_id: string; storage_key: string; filename: string; content_type: string }>();
  if (!row) return c.json({ error: "找不到檔案" }, 404);
  const access = await getProjectAccess(c.env.DB, row.project_id);
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const object = await r2FileStore(c.env.FILES).get(row.storage_key);
  if (!object) return c.json({ error: "檔案物件不存在" }, 404);
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Length": String(object.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`, ETag: object.httpEtag } });
});

v2Routes.delete("/files/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM files WHERE id=?").bind(c.req.param("id")).first<{ id: string; project_id: string; storage_key: string; filename: string; uploaded_by: string }>();
  if (!row) return c.json({ error: "找不到檔案" }, 404);
  const access = await getProjectAccess(c.env.DB, row.project_id);
  const user = c.get("user");
  if (!access || (user.role !== "admin" && access.owner_id !== user.id && row.uploaded_by !== user.id)) return c.json({ error: "沒有刪除權限" }, 403);
  await r2FileStore(c.env.FILES).delete(row.storage_key);
  await c.env.DB.prepare("DELETE FROM files WHERE id=?").bind(row.id).run();
  await touchProject(c.env.DB, row.project_id);
  await writeAudit(c.env.DB, user, "file_delete", "file", row.id, `刪除檔案「${row.filename}」`);
  return c.json({ ok: true });
});

v2Routes.get("/projects/:id/rules", async (c) => {
  const access = await getProjectAccess(c.env.DB, c.req.param("id"));
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  return c.json({ rules: (await c.env.DB.prepare("SELECT * FROM automation_rules WHERE project_id=? ORDER BY created_at DESC").bind(access.id).all()).results, can_manage: canManageAutomation(c.get("user"), access) });
});

v2Routes.post("/projects/:id/rules", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canManageAutomation(user, access)) return c.json({ error: "沒有規則管理權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const trigger = requiredString(body, "trigger_type") as TriggerType | null;
  const action = requiredString(body, "action_type") as ActionType | null;
  if (!name || !trigger || !action || !["task_done", "task_moved_to_stage", "milestone_done", "progress_reached"].includes(trigger) || !["notify_user", "assign_task_to", "create_todo_for", "log_update"].includes(action) || !isValidRuleCombination(trigger, action)) return c.json({ error: "規則組合不正確" }, 422);
  const triggerParam = optionalString(body, "trigger_param");
  if (trigger === "task_moved_to_stage" && !(await c.env.DB.prepare("SELECT id FROM stages WHERE id=? AND project_id=?").bind(triggerParam, projectId).first())) return c.json({ error: "請選擇有效階段" }, 422);
  if (trigger === "progress_reached" && (!triggerParam || Number(triggerParam) < 1 || Number(triggerParam) > 100)) return c.json({ error: "進度門檻須為 1 至 100" }, 422);
  const actionUser = optionalString(body, "action_param_user");
  if (["notify_user", "assign_task_to", "create_todo_for"].includes(action) && (!actionUser || !(await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(actionUser).first()))) return c.json({ error: "請選擇有效成員" }, 422);
  const ruleId = createId("rule");
  await c.env.DB.prepare("INSERT INTO automation_rules (id,project_id,name,trigger_type,trigger_param,action_type,action_param_user,action_param_text,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(ruleId, projectId, name, trigger, triggerParam, action, actionUser, optionalString(body, "action_param_text"), user.id).run();
  await writeAudit(c.env.DB, user, "rule_create", "automation_rule", ruleId, `建立規則「${name}」`);
  return c.json({ id: ruleId }, 201);
});

v2Routes.patch("/rules/:id", async (c) => {
  const rule = await c.env.DB.prepare("SELECT * FROM automation_rules WHERE id=?").bind(c.req.param("id")).first<{ id: string; project_id: string; enabled: number; name: string }>();
  if (!rule) return c.json({ error: "找不到規則" }, 404);
  const access = await getProjectAccess(c.env.DB, rule.project_id);
  if (!access || !canManageAutomation(c.get("user"), access)) return c.json({ error: "沒有規則管理權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const enabled = "enabled" in body ? (body.enabled ? 1 : 0) : rule.enabled;
  await c.env.DB.prepare("UPDATE automation_rules SET enabled=? WHERE id=?").bind(enabled, rule.id).run();
  return c.json({ ok: true });
});

v2Routes.delete("/rules/:id", async (c) => {
  const rule = await c.env.DB.prepare("SELECT * FROM automation_rules WHERE id=?").bind(c.req.param("id")).first<{ id: string; project_id: string; name: string }>();
  if (!rule) return c.json({ error: "找不到規則" }, 404);
  const access = await getProjectAccess(c.env.DB, rule.project_id);
  if (!access || !canManageAutomation(c.get("user"), access)) return c.json({ error: "沒有規則管理權限" }, 403);
  await c.env.DB.prepare("DELETE FROM automation_rules WHERE id=?").bind(rule.id).run();
  await writeAudit(c.env.DB, c.get("user"), "rule_delete", "automation_rule", rule.id, `刪除規則「${rule.name}」`);
  return c.json({ ok: true });
});

v2Routes.get("/timeline", async (c) => {
  const user = c.get("user");
  const projects = (await projectRows(c.env.DB)).filter((row) => row.status === "active" && canViewProject(user, accessFrom(row))).map((row) => ({ id: row.id, name: row.name, start_date: row.start_date, target_date: row.target_date, progress: row.progress, risk_level: row.risk_level, group: row.group_name }));
  return c.json({ projects });
});

