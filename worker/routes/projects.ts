import { Hono } from "hono";
import type { AppContext, GroupType, ProjectAccess, Visibility } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { r2FileStore } from "../services/filestore";
import { booleanInt, boundedNumber, optionalString, requiredString } from "../services/http";
import { canEditProgress, canEditProgressUpdate, canManageProject, canViewFees, canViewProject } from "../services/permissions";
import { recomputeAutoProgress } from "../services/auto-progress";
import { runAutomationRules } from "../services/automation";
import { stageColorFor } from "../services/stage-colors";
import { PROJECT_TEXT_LIMITS, textLength } from "../../src/project-text";
import { taipeiDate } from "../services/time";

/** 專案背景與目標是給人讀的長文字：可以清空，但不能無限長。上限與前端編輯器共用。 */
type LongTextField = keyof typeof PROJECT_TEXT_LIMITS;

/**
 * 讀背景或目標。欄位不在 body 裡回傳 undefined（不動）；空字串代表清空。
 * optionalString 會把空字串當成「沒填」，用它的話寫錯的背景永遠刪不掉。
 */
function longText(body: Record<string, unknown>, field: LongTextField): string | undefined | { error: string } {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value !== null && typeof value !== "string") return { error: "文字欄位格式不正確" };
  const text = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (textLength(text) > PROJECT_TEXT_LIMITS[field]) return { error: `${field === "description" ? "專案背景" : "專案目標"}最多 ${PROJECT_TEXT_LIMITS[field].toLocaleString("en-US")} 字` };
  return text;
}

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
  product: string;
  site: string;
  start_date: string | null;
  target_date: string | null;
  auto_archive: number;
  archived_at: string | null;
  is_demo: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  progress_mode: "manual" | "auto";
  /** 母專案；null 是一般（或母）專案。只有一層。 */
  parent_id: string | null;
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

/**
 * `?status=` 接受逗號分隔的多個狀態，讓「進行中專區」與「歸檔專區」各自一次取回自己那一籃，
 * 不必為 done 與 archived 發兩次請求。單一值的行為與先前完全相同。
 */
export function requestedStatuses(raw: string | undefined | null): Set<string> {
  const asked = (raw ?? "").split(",").map((part) => part.trim()).filter((part) => statusValues.has(part));
  return new Set(asked);
}

export function accessFrom(row: ProjectRow): ProjectAccess {
  return { id: row.id, owner_id: row.owner_id, group_id: row.group_id, visibility: row.visibility, member_ids: row.member_ids_csv?.split(",").filter(Boolean) ?? [] };
}

const PROJECT_ROW_SELECT = `
  SELECT p.*, u.name AS owner_name, g.name AS group_name, g.type AS group_type,
         GROUP_CONCAT(pm.user_id) AS member_ids_csv
  FROM projects p JOIN users u ON u.id = p.owner_id JOIN groups g ON g.id = p.group_id
  LEFT JOIN project_members pm ON pm.project_id = p.id
`;

export async function projectRows(db: D1Database): Promise<ProjectRow[]> {
  const result = await db.prepare(`${PROJECT_ROW_SELECT} GROUP BY p.id ORDER BY p.updated_at DESC`).all<ProjectRow>();
  return result.results;
}

/** 單筆查詢；避免為了取一個專案而撈出全部專案再於 JS 端 find()。 */
export async function projectRow(db: D1Database, id: string): Promise<ProjectRow | null> {
  return await db.prepare(`${PROJECT_ROW_SELECT} WHERE p.id = ? GROUP BY p.id`).bind(id).first<ProjectRow>();
}

/**
 * 子專案只有一層：母專案不能再掛在別人底下，已經有子專案的專案也不能變成別人的子專案。
 * 加入或移出母專案是結構上的變動，要母專案與這個專案兩邊的負責人（或管理員）才能做。
 */
async function checkParent(db: D1Database, user: AppContext["Variables"]["user"], parentId: string, childId?: string): Promise<{ error: string; status: 403 | 404 | 422 } | { parent: ProjectRow }> {
  if (childId && parentId === childId) return { error: "專案不能掛在自己底下", status: 422 };
  const parent = await projectRow(db, parentId);
  if (!parent || !canViewProject(user, accessFrom(parent))) return { error: "找不到母專案", status: 404 };
  if (parent.parent_id) return { error: `「${parent.name}」本身是子專案，底下不能再掛子專案`, status: 422 };
  if (!canManageProject(user, accessFrom(parent))) return { error: `只有「${parent.name}」的負責人或管理員可以加入子專案`, status: 403 };
  if (childId && await db.prepare("SELECT 1 FROM projects WHERE parent_id=? LIMIT 1").bind(childId).first()) return { error: "這個專案底下已經有子專案，不能再掛到別的專案底下", status: 422 };
  return { parent };
}

/** 母專案頁的子專案清單：只列看得到的，附任務完成數與逾期數。 */
async function childSummaries(db: D1Database, user: AppContext["Variables"]["user"], parentId: string) {
  const rows = (await db.prepare(`${PROJECT_ROW_SELECT} WHERE p.parent_id = ? GROUP BY p.id ORDER BY p.name`).bind(parentId).all<ProjectRow>()).results
    .filter((row) => canViewProject(user, accessFrom(row)));
  if (!rows.length) return [];
  const counts = await db.prepare(`SELECT project_id, COUNT(*) AS total, SUM(done) AS done, SUM(CASE WHEN done=0 AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM tasks WHERE project_id IN (${rows.map(() => "?").join(",")}) GROUP BY project_id`).bind(taipeiDate(), ...rows.map((row) => row.id)).all<{ project_id: string; total: number; done: number; overdue: number }>();
  const byProject = new Map(counts.results.map((row) => [row.project_id, row]));
  return rows.map((row) => ({
    id: row.id, name: row.name, status: row.status, progress: row.progress, owner_id: row.owner_id, owner_name: row.owner_name,
    start_date: row.start_date, target_date: row.target_date,
    task_total: byProject.get(row.id)?.total ?? 0, task_done: byProject.get(row.id)?.done ?? 0, task_overdue: byProject.get(row.id)?.overdue ?? 0,
  }));
}

/** 專案內頁一次回傳全部資料，但只有總覽與任務分頁需要 core；其餘分頁開啟時才取。 */
export const PROJECT_SECTIONS = ["core", "updates", "clinical", "bd"] as const;
export type ProjectSection = typeof PROJECT_SECTIONS[number];

export function requestedSections(raw: string | undefined | null): Set<ProjectSection> {
  // 未指定＝維持既有行為全部回傳，舊前端與外部呼叫端不受影響。
  if (!raw?.trim()) return new Set(PROJECT_SECTIONS);
  const asked = raw.split(",").map((part) => part.trim()).filter((part): part is ProjectSection => (PROJECT_SECTIONS as readonly string[]).includes(part));
  // core 永遠包含：project、permissions 等欄位是所有分頁的前提。
  return new Set<ProjectSection>(["core", ...asked]);
}

export const projectsRoutes = new Hono<AppContext>();

projectsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const group = c.req.query("group");
  const statuses = requestedStatuses(c.req.query("status"));
  const keyword = c.req.query("keyword")?.trim().toLowerCase();
  const rows = (await projectRows(c.env.DB)).filter((row) => {
    if (!canViewProject(user, accessFrom(row))) return false;
    if (group && row.group_id !== group) return false;
    if (statuses.size && !statuses.has(row.status)) return false;
    return !keyword || row.name.toLowerCase().includes(keyword) || row.description.toLowerCase().includes(keyword);
  });
  // summary=1 只回切換器需要的欄位；完整列含 description／goal_summary／risk_summary／
  // risk_suggestions（JSON blob），對只做下拉選單的呼叫端是純浪費。
  if (c.req.query("summary")) {
    return c.json({ projects: rows.map(({ id, name, group_id, group_name, status, product, parent_id, owner_id }) => ({ id, name, group_id, group_name, status, product, parent_id, owner_id })) });
  }
  return c.json({ projects: rows.map(({ member_ids_csv, ...row }) => ({ ...row, member_ids: member_ids_csv?.split(",").filter(Boolean) ?? [] })) });
});

projectsRoutes.post("/", async (c) => {
  const user = c.get("user");
  if (user.role === "intern") return c.json({ error: "實習生不可新增專案" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const inheritsGroup = Boolean(optionalString(body, "parent_id"));
  const groupId = requiredString(body, "group_id") ?? (inheritsGroup ? "" : null);
  const visibility = requiredString(body, "visibility") ?? "group";
  if (!name || groupId === null || !visibilityValues.has(visibility)) return c.json({ error: "專案名稱、組別或可見性不正確" }, 422);
  if (!inheritsGroup && !(await c.env.DB.prepare("SELECT id FROM groups WHERE id = ?").bind(groupId).first())) return c.json({ error: "找不到組別" }, 422);
  const description = longText(body, "description");
  const goal = longText(body, "goal_summary");
  if (typeof description === "object") return c.json(description, 422);
  if (typeof goal === "object") return c.json(goal, 422);
  // 子專案：沿用母專案的組別、可見性與成員，看得到母專案的人就看得到子專案。
  const parentId = optionalString(body, "parent_id");
  const parentCheck = parentId ? await checkParent(c.env.DB, user, parentId) : null;
  if (parentCheck && "error" in parentCheck) return c.json({ error: parentCheck.error }, parentCheck.status);
  const parent = parentCheck?.parent ?? null;
  const id = createId("prj");
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO projects (id, name, description, group_id, owner_id, visibility, goal_summary, product, site, start_date, target_date, auto_archive, progress_mode, last_activity_at, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?)
  `).bind(id, name, description ?? "", parent?.group_id ?? groupId, user.id, parent?.visibility ?? visibility, goal ?? "", optionalString(body, "product") ?? parent?.product ?? "", optionalString(body, "site") ?? parent?.site ?? "", optionalString(body, "start_date"), optionalString(body, "target_date"), booleanInt(body, "auto_archive", 1), now, parent?.id ?? null).run();
  if (parent) {
    const members = [...new Set([parent.owner_id, ...(parent.member_ids_csv?.split(",").filter(Boolean) ?? [])])].filter((memberId) => memberId !== user.id);
    if (members.length) await c.env.DB.batch(members.map((memberId) => c.env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id,user_id,added_by) VALUES (?,?,?)").bind(id, memberId, user.id)));
  }
  const templateId = optionalString(body, "template_id");
  if (parent && !templateId) {
    // 子專案沒指定範本時，看板欄位沿用母專案的（名稱與顏色）。
    const stages = await c.env.DB.prepare("SELECT name,color FROM stages WHERE project_id=? ORDER BY position").bind(parent.id).all<{ name: string; color: string }>();
    if (stages.results.length) await c.env.DB.batch(stages.results.map((stage, position) => c.env.DB.prepare("INSERT INTO stages (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)").bind(createId("stage"), id, stage.name, stage.color, position)));
  }
  if (templateId) {
    const template = await c.env.DB.prepare("SELECT stages_json FROM stage_templates WHERE id = ?").bind(templateId).first<{ stages_json: string }>();
    if (template) {
      const names: unknown = JSON.parse(template.stages_json);
      if (Array.isArray(names)) {
        const statements = names.filter((value): value is string => typeof value === "string").map((stageName, position) =>
          c.env.DB.prepare("INSERT INTO stages (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)").bind(createId("stage"), id, stageName, stageColorFor(stageName), position));
        if (statements.length) await c.env.DB.batch(statements);
      }
    }
  }
  if (parent) await recomputeAutoProgress(c.env.DB, parent.id, user.id);
  await writeAudit(c.env.DB, user, "create", "project", id, parent ? `在「${parent.name}」底下建立子專案「${name}」` : `建立專案「${name}」`);
  return c.json({ id }, 201);
});

projectsRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const row = await projectRow(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "找不到專案" }, 404);
  const access = accessFrom(row);
  if (!canViewProject(user, access)) return c.json({ error: "沒有檢視權限" }, 403);
  const projectId = row.id;
  const sections = requestedSections(c.req.query("sections"));
  const [members, stages, tasks, milestones] = await Promise.all([
    c.env.DB.prepare("SELECT u.id, u.name, u.email, u.role, g.name AS group_name FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN groups g ON g.id = u.group_id WHERE pm.project_id = ?").bind(projectId).all(),
    c.env.DB.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY position").bind(projectId).all(),
    c.env.DB.prepare(`SELECT t.*,u.name AS assignee_name,
      (SELECT GROUP_CONCAT(td.depends_on_task_id) FROM task_dependencies td WHERE td.task_id=t.id) AS dependency_ids_csv,
      (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id=t.id) AS comment_count,
      (SELECT COUNT(*) FROM files f WHERE f.task_id=t.id) AS attachment_count
      FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY t.stage_id,t.position`).bind(projectId).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY kind,due_date,position").bind(projectId).all(),
  ]);
  const updates = sections.has("updates")
    ? await c.env.DB.prepare("SELECT pu.*, u.name AS author_name, CASE WHEN pu.author_id != ? THEN 1 ELSE 0 END AS is_support FROM progress_updates pu JOIN users u ON u.id = pu.author_id WHERE pu.project_id = ? ORDER BY pu.created_at DESC").bind(row.owner_id, projectId).all<ProgressUpdateRow>()
    : null;
  const [clinicalSettings, enrollments] = sections.has("clinical")
    ? await Promise.all([
      c.env.DB.prepare("SELECT * FROM clinical_settings WHERE project_id = ?").bind(projectId).first(),
      c.env.DB.prepare("SELECT ce.*, u.name AS created_by_name FROM clinical_enrollments ce JOIN users u ON u.id = ce.created_by WHERE ce.project_id = ? ORDER BY ce.record_date").bind(projectId).all(),
    ])
    : [undefined, null];
  const [cases, events] = sections.has("bd")
    ? await Promise.all([
      c.env.DB.prepare("SELECT * FROM bd_cases WHERE project_id = ? ORDER BY created_at DESC").bind(projectId).all(),
      c.env.DB.prepare("SELECT e.*, u.name AS created_by_name FROM bd_case_events e JOIN bd_cases bc ON bc.id = e.case_id JOIN users u ON u.id = e.created_by WHERE bc.project_id = ? ORDER BY e.event_date DESC").bind(projectId).all(),
    ])
    : [null, null];
  let fees: D1Result<Record<string, unknown>> | undefined;
  if (sections.has("bd") && canViewFees(user, access)) fees = await c.env.DB.prepare("SELECT * FROM bd_fees WHERE project_id = ? ORDER BY fee_date DESC").bind(projectId).all<Record<string, unknown>>();
  const [parent, children] = await Promise.all([
    row.parent_id ? projectRow(c.env.DB, row.parent_id) : Promise.resolve(null),
    row.parent_id ? Promise.resolve([]) : childSummaries(c.env.DB, user, projectId),
  ]);
  const { member_ids_csv: _memberIds, ...project } = row;
  const taskRows = tasks.results.map((task) => ({ ...task, dependency_ids: typeof task.dependency_ids_csv === "string" ? task.dependency_ids_csv.split(",").filter(Boolean) : [] }));
  return c.json({
    project,
    permissions: { can_edit: canEditProgress(user, access), can_manage: canManageProject(user, access), can_view_fees: canViewFees(user, access) },
    members: members.results, stages: stages.results, tasks: taskRows, milestones: milestones.results,
    parent: parent && canViewProject(user, accessFrom(parent)) ? { id: parent.id, name: parent.name } : null,
    children,
    ...(updates ? { progress_updates: updates.results.map((update) => ({ ...update, can_edit: canEditProgressUpdate(user, access, update.author_id) })) } : {}),
    ...(sections.has("clinical") ? { clinical_settings: clinicalSettings ?? null, enrollments: enrollments?.results ?? [] } : {}),
    ...(cases ? { bd_cases: cases.results, bd_events: events?.results ?? [] } : {}),
    ...(fees ? { bd_fees: fees.results } : {}),
  });
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
  const hasSettings = ["name", "description", "goal_summary", "product", "site", "visibility", "status", "start_date", "target_date", "auto_archive", "progress_mode"].some((key) => key in body);
  if (hasSettings && !manager) return c.json({ error: "只有 owner 或管理員可修改專案設定" }, 403);
  const current = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
  if (!current) return c.json({ error: "找不到專案" }, 404);
  const description = longText(body, "description");
  const goal = longText(body, "goal_summary");
  if (typeof description === "object") return c.json(description, 422);
  if (typeof goal === "object") return c.json(goal, 422);
  const progressMode = optionalString(body, "progress_mode") ?? current.progress_mode;
  if (!["manual", "auto"].includes(progressMode)) return c.json({ error: "進度模式不正確" }, 422);
  if (progress !== null && progressMode === "auto") return c.json({ error: "自動進度模式不可手動修改進度" }, 422);
  const visibility = optionalString(body, "visibility") ?? current.visibility;
  const status = optionalString(body, "status") ?? current.status;
  if (!visibilityValues.has(visibility) || !statusValues.has(status)) return c.json({ error: "狀態或可見性不正確" }, 422);
  await c.env.DB.prepare(`UPDATE projects SET name=?, description=?, goal_summary=?, product=?, site=?, visibility=?, status=?, progress=?, start_date=?, target_date=?, auto_archive=?,progress_mode=?, updated_at=CURRENT_TIMESTAMP, last_activity_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(optionalString(body, "name") ?? current.name, description ?? current.description, goal ?? current.goal_summary, optionalString(body, "product") ?? current.product, optionalString(body, "site") ?? current.site, visibility, status, progress ?? current.progress, "start_date" in body ? optionalString(body, "start_date") : current.start_date, "target_date" in body ? optionalString(body, "target_date") : current.target_date, "auto_archive" in body ? booleanInt(body, "auto_archive", current.auto_archive) : current.auto_archive, progressMode, id).run();
  if (progress !== null && progress !== current.progress) {
    await c.env.DB.prepare("INSERT INTO progress_updates (id, project_id, author_id, content, progress_snapshot) VALUES (?, ?, ?, ?, ?)")
      .bind(createId("upd"), id, user.id, `專案進度更新為 ${progress}%`, progress).run();
    await runAutomationRules(c.env.DB, user.id, id, [{ type: "progress_reached", previousProgress: current.progress, progress }]);
  }
  if ("parent_id" in body) {
    const nextParent = optionalString(body, "parent_id");
    if (nextParent !== current.parent_id) {
      if (!manager) return c.json({ error: "只有 owner 或管理員可以移動專案" }, 403);
      let parentName = "";
      if (nextParent) {
        const check = await checkParent(c.env.DB, user, nextParent, id);
        if ("error" in check) return c.json({ error: check.error }, check.status);
        parentName = check.parent.name;
      }
      await c.env.DB.prepare("UPDATE projects SET parent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(nextParent, id).run();
      for (const affected of [current.parent_id, nextParent]) if (affected) await recomputeAutoProgress(c.env.DB, affected, user.id);
      await writeAudit(c.env.DB, user, "update", "project", id, nextParent ? `移到「${parentName}」底下當子專案` : "移出母專案，變回一般專案");
    }
  }
  if (progressMode === "auto" && current.progress_mode !== "auto") {
    const result = await recomputeAutoProgress(c.env.DB, id, user.id);
    if (result?.changed) await runAutomationRules(c.env.DB, user.id, id, [{ type: "progress_reached", previousProgress: result.previous, progress: result.progress }]);
  }
  if (hasSettings) {
    const edited = [description !== undefined && description !== current.description && "專案背景", goal !== undefined && goal !== current.goal_summary && "專案目標"].filter(Boolean);
    await writeAudit(c.env.DB, user, "update", "project", id, edited.length ? `更新${edited.join("與")}` : "更新專案設定");
  }
  return c.json({ ok: true });
});

projectsRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, id);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canManageProject(user, access)) return c.json({ error: "沒有管理權限" }, 403);
  await writeAudit(c.env.DB, user, "delete", "project", id, "刪除專案");
  // 資料庫的 ON DELETE CASCADE 會清掉 files 那幾列，但 R2 裡的實體檔案不會跟著消失。
  // 列一旦刪掉就沒有任何紀錄指向那些物件，等於永久留在 bucket 裡繼續計費且無法清理，
  // 所以一定要在刪列之前先清。單一檔案的刪除端點本來就是這樣做的。
  const files = await c.env.DB.prepare("SELECT storage_key FROM files WHERE project_id = ?").bind(id).all<{ storage_key: string }>();
  if (files.results.length) {
    const store = r2FileStore(c.env.FILES);
    // 用 allSettled：某個物件清不掉不該讓整個刪除卡住，資料庫才是使用者眼中的真相。
    const outcome = await Promise.allSettled(files.results.map((file) => store.delete(file.storage_key)));
    const failed = outcome.filter((item) => item.status === "rejected").length;
    if (failed) console.error(JSON.stringify({ message: "刪除專案時有檔案未能從 R2 清除", project_id: id, failed, total: files.results.length }));
  }
  const parentId = await c.env.DB.prepare("SELECT parent_id FROM projects WHERE id = ?").bind(id).first<string | null>("parent_id");
  // 母專案刪掉時，子專案由外鍵的 ON DELETE SET NULL 變回一般專案。
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  if (parentId) await recomputeAutoProgress(c.env.DB, parentId, user.id);
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
