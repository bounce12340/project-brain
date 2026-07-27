import { Hono } from "hono";
import type { AppContext, GroupType, ProjectAccess, Visibility } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { booleanInt, boundedNumber, optionalString, requiredString } from "../services/http";
import { canEditProgress, canEditProgressUpdate, canManageProject, canViewFees, canViewProject } from "../services/permissions";
import { recomputeAutoProgress } from "../services/auto-progress";
import { runAutomationRules } from "../services/automation";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  group_id: string;
  owner_id: string;
  visibility: Visibility;
  status: "active" | "paused" | "done" | "archived";
  progress: number;
  goal_summary: string;
  start_date: string | null;
  target_date: string | null;
  auto_archive: number;
  archived_at: string | null;
  is_demo: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  progress_mode: "manual" | "auto";
  risk_level: "low" | "medium" | "high" | null;
  risk_summary: string | null;
  risk_suggestions: string | null;
  risk_updated_at: string | null;
  owner_name: string;
  group_name: string;
  group_type: GroupType;
  member_ids_csv: string | null;
}

interface ProgressUpdateRow {
  author_id: string;
  [key: string]: unknown;
}

const visibilityValues = new Set(["all", "group", "private"]);
const statusValues = new Set(["active", "paused", "done", "archived"]);

export function accessFrom(row: ProjectRow): ProjectAccess {
  return { id: row.id, owner_id: row.owner_id, group_id: row.group_id, visibility: row.visibility, member_ids: row.member_ids_csv?.split(",").filter(Boolean) ?? [] };
}

export async function projectRows(db: D1Database): Promise<ProjectRow[]> {
  const result = await db.prepare(`
    SELECT p.*, u.name AS owner_name, g.name AS group_name, g.type AS group_type,
           GROUP_CONCAT(pm.user_id) AS member_ids_csv
    FROM projects p JOIN users u ON u.id = p.owner_id JOIN groups g ON g.id = p.group_id
    LEFT JOIN project_members pm ON pm.project_id = p.id
    GROUP BY p.id ORDER BY p.updated_at DESC
  `).all<ProjectRow>();
  return result.results;
}

export const projectsRoutes = new Hono<AppContext>();

projectsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const group = c.req.query("group");
  const status = c.req.query("status");
  const keyword = c.req.query("keyword")?.trim().toLowerCase();
  const rows = (await projectRows(c.env.DB)).filter((row) => {
    if (!canViewProject(user, accessFrom(row))) return false;
    if (group && row.group_id !== group) return false;
    if (status && row.status !== status) return false;
    return !keyword || row.name.toLowerCase().includes(keyword) || row.description.toLowerCase().includes(keyword);
  });
  return c.json({ projects: rows.map(({ member_ids_csv, ...row }) => ({ ...row, member_ids: member_ids_csv?.split(",").filter(Boolean) ?? [] })) });
});

projectsRoutes.post("/", async (c) => {
  const user = c.get("user");
  if (user.role === "intern") return c.json({ error: "實習生不可新增專案" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const groupId = requiredString(body, "group_id");
  const visibility = requiredString(body, "visibility") ?? "group";
  if (!name || !groupId || !visibilityValues.has(visibility)) return c.json({ error: "專案名稱、組別或可見性不正確" }, 422);
  const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ?").bind(groupId).first();
  if (!group) return c.json({ error: "找不到組別" }, 422);
  const id = createId("prj");
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO projects (id, name, description, group_id, owner_id, visibility, goal_summary, start_date, target_date, auto_archive, progress_mode, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?)
  `).bind(id, name, optionalString(body, "description") ?? "", groupId, user.id, visibility, optionalString(body, "goal_summary") ?? "", optionalString(body, "start_date"), optionalString(body, "target_date"), booleanInt(body, "auto_archive", 1), now).run();
  const templateId = optionalString(body, "template_id");
  if (templateId) {
    const template = await c.env.DB.prepare("SELECT stages_json FROM stage_templates WHERE id = ?").bind(templateId).first<{ stages_json: string }>();
    if (template) {
      const names: unknown = JSON.parse(template.stages_json);
      if (Array.isArray(names)) {
        const statements = names.filter((value): value is string => typeof value === "string").map((stageName, position) =>
          c.env.DB.prepare("INSERT INTO stages (id, project_id, name, position) VALUES (?, ?, ?, ?)").bind(createId("stage"), id, stageName, position));
        if (statements.length) await c.env.DB.batch(statements);
      }
    }
  }
  await writeAudit(c.env.DB, user, "create", "project", id, `建立專案「${name}」`);
  return c.json({ id }, 201);
});

projectsRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const row = (await projectRows(c.env.DB)).find((item) => item.id === c.req.param("id"));
  if (!row) return c.json({ error: "找不到專案" }, 404);
  const access = accessFrom(row);
  if (!canViewProject(user, access)) return c.json({ error: "沒有檢視權限" }, 403);
  const projectId = row.id;
  const [members, stages, tasks, milestones, updates, clinicalSettings, enrollments, cases, events] = await Promise.all([
    c.env.DB.prepare("SELECT u.id, u.name, u.email, u.role, g.name AS group_name FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN groups g ON g.id = u.group_id WHERE pm.project_id = ?").bind(projectId).all(),
    c.env.DB.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY position").bind(projectId).all(),
    c.env.DB.prepare(`SELECT t.*,u.name AS assignee_name,
      (SELECT GROUP_CONCAT(td.depends_on_task_id) FROM task_dependencies td WHERE td.task_id=t.id) AS dependency_ids_csv,
      (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id=t.id) AS comment_count,
      (SELECT COUNT(*) FROM files f WHERE f.task_id=t.id) AS attachment_count
      FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY t.stage_id,t.position`).bind(projectId).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY position").bind(projectId).all(),
    c.env.DB.prepare("SELECT pu.*, u.name AS author_name, CASE WHEN pu.author_id != ? THEN 1 ELSE 0 END AS is_support FROM progress_updates pu JOIN users u ON u.id = pu.author_id WHERE pu.project_id = ? ORDER BY pu.created_at DESC").bind(row.owner_id, projectId).all<ProgressUpdateRow>(),
    c.env.DB.prepare("SELECT * FROM clinical_settings WHERE project_id = ?").bind(projectId).first(),
    c.env.DB.prepare("SELECT ce.*, u.name AS created_by_name FROM clinical_enrollments ce JOIN users u ON u.id = ce.created_by WHERE ce.project_id = ? ORDER BY ce.record_date").bind(projectId).all(),
    c.env.DB.prepare("SELECT * FROM bd_cases WHERE project_id = ? ORDER BY created_at DESC").bind(projectId).all(),
    c.env.DB.prepare("SELECT e.*, u.name AS created_by_name FROM bd_case_events e JOIN bd_cases bc ON bc.id = e.case_id JOIN users u ON u.id = e.created_by WHERE bc.project_id = ? ORDER BY e.event_date DESC").bind(projectId).all(),
  ]);
  let fees: D1Result<Record<string, unknown>> | undefined;
  if (canViewFees(user, access)) fees = await c.env.DB.prepare("SELECT * FROM bd_fees WHERE project_id = ? ORDER BY fee_date DESC").bind(projectId).all<Record<string, unknown>>();
  const { member_ids_csv: _memberIds, ...project } = row;
  const taskRows = tasks.results.map((task) => ({ ...task, dependency_ids: typeof task.dependency_ids_csv === "string" ? task.dependency_ids_csv.split(",").filter(Boolean) : [] }));
  const progressUpdates = updates.results.map((update) => ({ ...update, can_edit: canEditProgressUpdate(user, access, update.author_id) }));
  return c.json({ project, permissions: { can_edit: canEditProgress(user, access), can_manage: canManageProject(user, access), can_view_fees: canViewFees(user, access) }, members: members.results, stages: stages.results, tasks: taskRows, milestones: milestones.results, progress_updates: progressUpdates, clinical_settings: clinicalSettings, enrollments: enrollments.results, bd_cases: cases.results, bd_events: events.results, ...(fees ? { bd_fees: fees.results } : {}) });
});

projectsRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const progress = boundedNumber(body, "progress", 0, 100);
  const manager = canManageProject(user, access);
  const hasSettings = ["name", "description", "goal_summary", "visibility", "status", "start_date", "target_date", "auto_archive", "progress_mode"].some((key) => key in body);
  if (hasSettings && !manager) return c.json({ error: "只有 owner 或管理員可修改專案設定" }, 403);
  const current = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
  if (!current) return c.json({ error: "找不到專案" }, 404);
  const progressMode = optionalString(body, "progress_mode") ?? current.progress_mode;
  if (!["manual", "auto"].includes(progressMode)) return c.json({ error: "進度模式不正確" }, 422);
  if (progress !== null && progressMode === "auto") return c.json({ error: "自動進度模式不可手動修改進度" }, 422);
  const visibility = optionalString(body, "visibility") ?? current.visibility;
  const status = optionalString(body, "status") ?? current.status;
  if (!visibilityValues.has(visibility) || !statusValues.has(status)) return c.json({ error: "狀態或可見性不正確" }, 422);
  await c.env.DB.prepare(`UPDATE projects SET name=?, description=?, goal_summary=?, visibility=?, status=?, progress=?, start_date=?, target_date=?, auto_archive=?,progress_mode=?, updated_at=CURRENT_TIMESTAMP, last_activity_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(optionalString(body, "name") ?? current.name, optionalString(body, "description") ?? current.description, optionalString(body, "goal_summary") ?? current.goal_summary, visibility, status, progress ?? current.progress, "start_date" in body ? optionalString(body, "start_date") : current.start_date, "target_date" in body ? optionalString(body, "target_date") : current.target_date, "auto_archive" in body ? booleanInt(body, "auto_archive", current.auto_archive) : current.auto_archive, progressMode, id).run();
  if (progress !== null && progress !== current.progress) {
    await c.env.DB.prepare("INSERT INTO progress_updates (id, project_id, author_id, content, progress_snapshot) VALUES (?, ?, ?, ?, ?)")
      .bind(createId("upd"), id, user.id, `專案進度更新為 ${progress}%`, progress).run();
    await runAutomationRules(c.env.DB, user.id, id, [{ type: "progress_reached", previousProgress: current.progress, progress }]);
  }
  if (progressMode === "auto" && current.progress_mode !== "auto") {
    const result = await recomputeAutoProgress(c.env.DB, id, user.id);
    if (result?.changed) await runAutomationRules(c.env.DB, user.id, id, [{ type: "progress_reached", previousProgress: result.previous, progress: result.progress }]);
  }
  if (hasSettings) await writeAudit(c.env.DB, user, "update", "project", id, "更新專案設定");
  return c.json({ ok: true });
});

projectsRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canManageProject(user, access)) return c.json({ error: "沒有管理權限" }, 403);
  await writeAudit(c.env.DB, user, "delete", "project", id, "刪除專案");
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

for (const [path, targetStatus] of [["/:id/archive", "archived"], ["/:id/unarchive", "active"]] as const) {
  projectsRoutes.post(path, async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const access = await getProjectAccess(c.env.DB, id);
    if (!access) return c.json({ error: "找不到專案" }, 404);
    if (!canManageProject(user, access)) return c.json({ error: "沒有管理權限" }, 403);
    await c.env.DB.prepare("UPDATE projects SET status=?, archived_at=?, updated_at=CURRENT_TIMESTAMP, last_activity_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(targetStatus, targetStatus === "archived" ? new Date().toISOString() : null, id).run();
    await writeAudit(c.env.DB, user, targetStatus, "project", id, targetStatus === "archived" ? "歸檔專案" : "還原專案");
    return c.json({ ok: true });
  });
}

projectsRoutes.get("/:id/members", async (c) => {
  const access = await getProjectAccess(c.env.DB, c.req.param("id"));
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const result = await c.env.DB.prepare("SELECT u.id, u.name, u.email, u.role, u.group_id FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=?").bind(access.id).all();
  return c.json({ members: result.results });
});

projectsRoutes.post("/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canManageProject(user, access)) return c.json({ error: "沒有管理權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const userId = requiredString(body, "user_id");
  if (!userId) return c.json({ error: "請選擇成員" }, 422);
  await c.env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, added_by) VALUES (?, ?, ?)").bind(id, userId, user.id).run();
  await touchProject(c.env.DB, id);
  await writeAudit(c.env.DB, user, "member_add", "project", id, `加入成員 ${userId}`);
  return c.json({ ok: true }, 201);
});

projectsRoutes.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canManageProject(user, access)) return c.json({ error: "沒有管理權限" }, 403);
  await c.env.DB.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(id, c.req.param("userId")).run();
  await touchProject(c.env.DB, id);
  await writeAudit(c.env.DB, user, "member_remove", "project", id, `移除成員 ${c.req.param("userId")}`);
  return c.json({ ok: true });
});
