import type { AuthUser, ProjectAccess } from "../types";
import { createId, getProjectAccess } from "./db";
import { isIsoDate, resolveImportUser, type ImportUserResolution } from "./importer";
import { currentTaipeiQuarter, taipeiDate } from "./time";
import { milestoneDateRangeError } from "./milestone-dates";
import { stageColorFor } from "./stage-colors";
import { canEditProgress, canViewProject } from "./permissions";
import { recomputeAutoProgress } from "./auto-progress";

type JsonObject = Record<string, unknown>;

/**
 * admin：原本的完整匯入，任何專案、任何欄位、任何人名下。
 * member：一般使用者。規則比照他在畫面上自己動手能做的事——
 *   只能動自己有編輯權的專案、新專案一律掛自己、進度紀錄一律記在自己名下、
 *   實習生不能建立專案，法規動態／KR／證照／CCR／臨床收案不開放。
 *
 * 直接把 admin 匯入開放出去的話，一般成員可以用 external_key 改寫別人的專案（連擁有者
 * 都能換掉）、以別人的名義寫進度紀錄、直接發布法規動態、把 CCR 直接落點成「已核准」。
 */
export type ImportMode = "admin" | "member";

export interface ImportOptions {
  mode: ImportMode;
  /** 只驗證不寫入。回傳的統計就是「如果現在匯入會發生什麼」。 */
  dryRun?: boolean;
}

export interface ImportStats {
  projects: { created: number; updated: number };
  tasks: { created: number; skipped: number };
  milestones: { created: number; skipped: number };
  events: { created: number; skipped: number };
  progress_updates: { created: number; skipped: number };
  reg_entries: { created: number; skipped: number };
  warnings: string[];
}

export class ImportValidationError extends Error {
  constructor(message: string, readonly issues: string[] = [message]) { super(message); }
}

/** 一般使用者不能匯入的專案子項，以及在畫面上的名稱。 */
const ADMIN_ONLY_PROJECT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["quarter_goals", "季度目標"], ["key_results", "KR"], ["clinical", "臨床收案"], ["licenses", "證照效期"], ["ccrs", "CCR"],
];

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function objects(value: unknown, field: string): JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => object(item))) throw new ImportValidationError(`${field} 必須是物件陣列`);
  return value as JsonObject[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown, field: string, optional = true): string | null {
  if (value === undefined || value === null || value === "") return optional ? null : (() => { throw new ImportValidationError(`${field} 必填`); })();
  if (!isIsoDate(value)) throw new ImportValidationError(`${field} 必須是 YYYY-MM-DD`);
  return value;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function prefixed(prefix: string, value: string | null): string {
  return prefix ? `${prefix}${value ? ` ${value}` : ""}` : value ?? "";
}

const has = (item: JsonObject, field: string) => item[field] !== undefined && item[field] !== null && item[field] !== "";
const nonEmpty = (value: unknown) => Array.isArray(value) ? value.length > 0 : object(value) !== null;

async function stageNamesForProject(db: D1Database, projectId: string): Promise<Map<string, string>> {
  const rows = await db.prepare("SELECT id,name FROM stages WHERE project_id=? ORDER BY position").bind(projectId).all<{ id: string; name: string }>();
  return new Map(rows.results.map((row) => [row.name, row.id]));
}

async function createCcrFromImport(db: D1Database, projectId: string, item: JsonObject, actorId: string, notePrefix: string, dryRun: boolean): Promise<void> {
  const title = text(item.title);
  if (!title) throw new ImportValidationError("ccrs[].title 必填");
  if (await db.prepare("SELECT id FROM ccr_records WHERE project_id=? AND title=? AND reason=?").bind(projectId, title, text(item.reason) ?? "匯入").first()) return;
  const targetType = text(item.target_type) ?? "其他";
  const classification = text(item.classification) ?? "次要";
  const status = text(item.status) ?? "申請";
  if (!["產品", "文件", "供應商", "製程", "設備", "其他"].includes(targetType) || !["重大", "次要"].includes(classification) || !["申請", "評估中", "已核准", "執行中", "效期確認", "已結案", "駁回"].includes(status)) throw new ImportValidationError(`CCR「${title}」的類型、分級或狀態不正確`);
  const year = (date(item.requested_at, "ccrs[].requested_at") ?? taipeiDate()).slice(0, 4);
  if (dryRun) return;
  const id = createId("ccr");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO ccr_records (id,project_id,ccr_no,title,target_type,description,reason,classification,impact_assessment,status,requested_by,approved_by,approved_at,closed_at,note)
      SELECT ?,?,'CCR-' || ? || '-' || printf('%03d',COALESCE(MAX(CASE WHEN ccr_no LIKE ? THEN CAST(substr(ccr_no,10) AS INTEGER) END),0)+1),?,?,?,?,?,?,?,?,?,?,?,? FROM ccr_records`)
      .bind(id, projectId, year, `CCR-${year}-%`, title, targetType, text(item.description) ?? "匯入資料", text(item.reason) ?? "匯入", classification, text(item.impact_assessment), status, actorId, ["已核准", "執行中", "效期確認", "已結案"].includes(status) ? actorId : null, ["已核准", "執行中", "效期確認", "已結案"].includes(status) ? now : null, status === "已結案" ? now : null, prefixed(notePrefix, text(item.note))),
    db.prepare("INSERT INTO ccr_events (id,ccr_id,event_type,from_status,to_status,description,created_by) VALUES (?,?,'狀態變更',NULL,?,'批次匯入直接落點',?)").bind(createId("ccre"), id, status, actorId),
  ]);
}

interface ExistingProject {
  id: string; name: string; group_id: string; owner_id: string; goal_summary: string;
  start_date: string | null; target_date: string | null; progress: number; progress_mode: "manual" | "auto";
}

interface PlannedProject {
  item: JsonObject;
  /** 訊息裡用來指認這個專案的名字：有專案代碼就用代碼，否則用名稱。 */
  label: string;
  externalKey: string | null;
  name: string | null;
  existing: ExistingProject | null;
  group: { id: string; name: string; type: string } | null;
}

const EXISTING_COLUMNS = "id,name,group_id,owner_id,goal_summary,start_date,target_date,progress,progress_mode";

/**
 * 寫入前先把每個專案對到資料庫：新增還是既有、有沒有權限、組別存不存在。
 * 問題一次收齊再丟出，使用者才能一次改完，而不是改一個、送一次、再看到下一個。
 */
async function planProjects(
  db: D1Database, actor: AuthUser, mode: ImportMode, items: JsonObject[],
  groups: Map<string, { id: string; name: string; type: string }>, issues: string[],
): Promise<PlannedProject[]> {
  const planned: PlannedProject[] = [];
  const seen = new Map<string, string>();
  for (const [index, item] of items.entries()) {
    const externalKey = text(item.external_key);
    const name = text(item.name);
    const label = externalKey ?? name ?? `projects[${index}]`;
    if (!externalKey && !name) { issues.push(`projects[${index}] 缺少專案名稱`); continue; }

    if (mode === "member") {
      const blocked = ADMIN_ONLY_PROJECT_FIELDS.filter(([field]) => nonEmpty(item[field])).map(([, title]) => title);
      if (blocked.length) issues.push(`「${label}」含有僅限管理員匯入的內容：${blocked.join("、")}`);
    }
    const visibility = text(item.visibility);
    const status = text(item.status);
    if (visibility && !["all", "group", "private"].includes(visibility)) issues.push(`「${label}」的可見性不正確：${visibility}`);
    if (status && !["active", "paused", "done", "archived"].includes(status)) issues.push(`「${label}」的狀態不正確：${status}`);
    for (const field of ["start_date", "target_date"]) {
      if (has(item, field) && !isIsoDate(item[field])) issues.push(`「${label}」的 ${field} 必須是 YYYY-MM-DD`);
    }

    let existing: ExistingProject | null = null;
    if (externalKey) {
      existing = await db.prepare(`SELECT ${EXISTING_COLUMNS} FROM projects WHERE external_key=?`).bind(externalKey).first<ExistingProject>();
    } else if (name) {
      // 沒有專案代碼時用名稱對既有專案。只在看得到的專案裡找——看不到的不能被「猜中」。
      const rows = await db.prepare(`SELECT ${EXISTING_COLUMNS} FROM projects WHERE name=?`).bind(name).all<ExistingProject>();
      const visible: ExistingProject[] = [];
      for (const row of rows.results) {
        const access = await getProjectAccess(db, row.id);
        if (access && canViewProject(actor, access)) visible.push(row);
      }
      if (visible.length > 1) { issues.push(`有 ${visible.length} 個專案都叫「${name}」，請填專案代碼區分`); continue; }
      existing = visible[0] ?? null;
    }

    const target = existing ? `id:${existing.id}` : `new:${externalKey ?? name}`;
    if (seen.has(target)) { issues.push(`「${label}」在匯入資料裡出現了不只一次（與「${seen.get(target)}」相同），請合併成一筆`); continue; }
    seen.set(target, label);

    const groupValue = text(item.group);
    const group = groupValue ? groups.get(groupValue) ?? null : null;
    if (groupValue && !group) issues.push(`「${label}」找不到組別「${groupValue}」`);

    if (existing) {
      if (mode === "member") {
        const access = await getProjectAccess(db, existing.id) as ProjectAccess;
        // 看不到的專案連名稱都不能說出來：猜中別人私人專案的代碼，不該因此得知它叫什麼。
        if (!canViewProject(actor, access)) issues.push(`專案代碼「${externalKey}」已被你沒有權限的專案使用，請換一個代碼`);
        else if (!canEditProgress(actor, access)) issues.push(`你沒有權限修改專案「${existing.name}」`);
      }
    } else {
      if (!name) issues.push(`「${label}」是新專案，需要專案名稱`);
      else if (!groupValue) issues.push(externalKey ? `「${label}」是新專案，需要組別` : `找不到專案「${name}」。要新增專案，請提供組別`);
      if (mode === "member" && actor.role === "intern") issues.push(`實習生不能建立新專案（「${label}」）`);
    }
    planned.push({ item, label, externalKey, name, existing, group });
  }
  return planned;
}

/**
 * 匯入。先 `dryRun: true` 跑一次再真的跑，是呼叫端（API）的責任：這裡的寫入是一筆一筆
 * 送出的，途中遇到格式錯誤會留下前半段——預演一次沒問題，實際執行才不會卡在半路。
 */
export async function runImport(db: D1Database, actor: AuthUser, payload: unknown, options: ImportOptions): Promise<ImportStats> {
  const { mode } = options;
  const dryRun = options.dryRun === true;
  const run = async (statement: D1PreparedStatement) => { if (!dryRun) await statement.run(); };
  const root = object(payload);
  if (!root) throw new ImportValidationError("JSON 根節點必須是物件");
  const projects = objects(root.projects, "projects");
  const regEntries = objects(root.reg_entries, "reg_entries");
  const stats: ImportStats = { projects: { created: 0, updated: 0 }, tasks: { created: 0, skipped: 0 }, milestones: { created: 0, skipped: 0 }, events: { created: 0, skipped: 0 }, progress_updates: { created: 0, skipped: 0 }, reg_entries: { created: 0, skipped: 0 }, warnings: [] };
  const [userRows, groupRows, templateRows] = await Promise.all([
    db.prepare("SELECT id,email FROM users WHERE is_active=1 AND approval_status='approved'").all<{ id: string; email: string }>(),
    db.prepare("SELECT id,name,type FROM groups").all<{ id: string; name: string; type: string }>(),
    db.prepare("SELECT name,group_id,stages_json FROM stage_templates ORDER BY group_id IS NULL,name").all<{ name: string; group_id: string | null; stages_json: string }>(),
  ]);
  const usersByEmail = new Map(userRows.results.map((row) => [row.email.toLowerCase(), row.id]));
  const groups = new Map<string, { id: string; name: string; type: string }>();
  for (const group of groupRows.results) { groups.set(group.id, group); groups.set(group.name, group); }
  const fallbackLabel = mode === "admin" ? "執行管理員" : "匯入者";
  const person = (email: unknown): ImportUserResolution => resolveImportUser(email, usersByEmail, actor.id, fallbackLabel);
  /** 一般使用者寫的東西一律記在自己名下；表上寫的是別人時，把原作者留在內文開頭。 */
  const author = (email: unknown): ImportUserResolution => {
    if (mode === "admin") return person(email);
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized || normalized === actor.email.toLowerCase()) return { userId: actor.id, notePrefix: "" };
    return { userId: actor.id, notePrefix: `【原作者：${normalized}】`, warning: `進度紀錄一律記在匯入者名下，原作者 ${normalized} 已寫在內文開頭` };
  };

  const issues: string[] = [];
  if (mode === "member" && regEntries.length) issues.push("法規動態僅限管理員匯入");
  const planned = await planProjects(db, actor, mode, projects, groups, issues);
  if (issues.length) throw new ImportValidationError(issues[0], issues);

  for (const { item, label, externalKey, name, existing, group } of planned) {
    let projectId: string;
    if (existing) {
      projectId = existing.id;
      const sets = ["updated_at=CURRENT_TIMESTAMP", "last_activity_at=CURRENT_TIMESTAMP"];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => { sets.push(`${column}=?`); values.push(value); };
      // 既有專案只改表上有寫的欄位。先前省略 status 會把專案改回「進行中」、省略
      // owner_email 會把擁有者換成執行匯入的管理員——重匯一次就默默改掉別人的設定。
      if (name && name !== existing.name) set("name", name);
      for (const field of ["visibility", "status", "product", "site"]) if (has(item, field)) set(field, text(item[field]) ?? "");
      if (has(item, "goal_summary")) set("goal_summary", text(item.goal_summary) ?? "");
      if (has(item, "start_date")) set("start_date", item.start_date);
      if (has(item, "target_date")) set("target_date", item.target_date);
      if (has(item, "progress")) {
        if (mode === "admin" || existing.progress_mode === "manual") set("progress", Math.round(numberIn(item.progress, 0, 100, existing.progress)));
        else stats.warnings.push(`${label}: 專案採自動進度，已忽略填寫的進度`);
      }
      const ownerEmail = has(item, "owner_email") ? String(item.owner_email).trim().toLowerCase() : "";
      const ownerId = ownerEmail ? usersByEmail.get(ownerEmail) : undefined;
      if (mode === "admin") {
        if (group && group.id !== existing.group_id) set("group_id", group.id);
        // 打錯的 Email 不該把擁有者換成執行匯入的管理員；維持原擁有者。
        if (ownerEmail && !ownerId) stats.warnings.push(`${label}: 找不到使用者 ${ownerEmail}，維持原擁有者`);
        else if (ownerId && ownerId !== existing.owner_id) set("owner_id", ownerId);
      } else {
        if (group && group.id !== existing.group_id) stats.warnings.push(`${label}: 組別只有管理員能改，已維持原組別`);
        if (ownerEmail && ownerId !== existing.owner_id) stats.warnings.push(`${label}: 擁有者只有管理員能改，已維持原擁有者`);
      }
      await run(db.prepare(`UPDATE projects SET ${sets.join(",")} WHERE id=?`).bind(...values, projectId));
      stats.projects.updated += 1;
    } else {
      projectId = createId("prj");
      const createdGroup = group as { id: string; name: string; type: string };
      let owner: ImportUserResolution;
      if (mode === "admin") owner = person(item.owner_email);
      else {
        owner = { userId: actor.id, notePrefix: "" };
        if (has(item, "owner_email") && String(item.owner_email).trim().toLowerCase() !== actor.email.toLowerCase()) stats.warnings.push(`${label}: 新專案一律由匯入者擔任擁有者`);
      }
      if (owner.warning) stats.warnings.push(`${label}: ${owner.warning}`);
      const status = text(item.status) ?? "active";
      const visibility = text(item.visibility) ?? "group";
      await run(db.prepare("INSERT INTO projects (id,external_key,name,description,group_id,owner_id,visibility,status,progress,goal_summary,product,site,start_date,target_date,progress_mode,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'auto', CURRENT_TIMESTAMP)")
        .bind(projectId, externalKey, name, owner.notePrefix, createdGroup.id, owner.userId, visibility, status, mode === "admin" ? Math.round(numberIn(item.progress, 0, 100, 0)) : 0, prefixed(owner.notePrefix, text(item.goal_summary)), text(item.product) ?? "", text(item.site) ?? "", date(item.start_date, `${label}.start_date`), date(item.target_date, `${label}.target_date`)));
      if (mode === "member" && has(item, "progress")) stats.warnings.push(`${label}: 新專案採自動進度，已忽略填寫的進度`);
      stats.projects.created += 1;
    }
    const projectGroup = group ?? groups.get(existing?.group_id ?? "") ?? { id: "", name: "", type: "general" };

    for (const goal of objects(item.quarter_goals, `${label}.quarter_goals`)) {
      const quarter = text(goal.quarter) ?? currentTaipeiQuarter();
      const objective = text(goal.objective);
      if (!/^\d{4}Q[1-4]$/.test(quarter) || !objective) throw new ImportValidationError(`${label}: 季度目標格式不正確`);
      await run(db.prepare("INSERT OR IGNORE INTO project_quarter_goals (id,project_id,quarter,objective) VALUES (?,?,?,?)").bind(createId("obj"), projectId, quarter, objective));
    }

    for (const kr of objects(item.key_results, `${label}.key_results`)) {
      const title = text(kr.title);
      const quarter = text(kr.quarter) ?? currentTaipeiQuarter();
      const krStatus = text(kr.status) ?? "未開始";
      if (!title || !/^\d{4}Q[1-4]$/.test(quarter) || !["未開始", "進行中", "完成", "暫停"].includes(krStatus)) throw new ImportValidationError(`${label}: KR 格式不正確`);
      if (await db.prepare("SELECT id FROM key_results WHERE project_id=? AND quarter=? AND title=?").bind(projectId, quarter, title).first()) continue;
      const krOwner = person(kr.owner_email);
      if (krOwner.warning) stats.warnings.push(`${label}/KR ${title}: ${krOwner.warning}`);
      const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM key_results WHERE project_id=? AND quarter=?").bind(projectId, quarter).first<number>("value");
      await run(db.prepare("INSERT INTO key_results (id,project_id,title,owner_id,quarter,status,note,position) VALUES (?,?,?,?,?,?,?,?)")
        .bind(createId("kr"), projectId, title, krOwner.userId, quarter, krStatus, krOwner.notePrefix, position ?? 0));
    }

    const stages = await stageNamesForProject(db, projectId);
    let requestedStages: string[] = [];
    if (item.stages !== undefined) {
      if (!Array.isArray(item.stages) || !item.stages.every((stage) => typeof stage === "string" && stage.trim())) throw new ImportValidationError(`${label}.stages 必須是字串陣列`);
      requestedStages = item.stages.map((stage) => String(stage).trim());
    } else if (stages.size === 0) {
      const preferredNames = projectGroup.type === "clinical" ? ["臨床試驗流程"] : projectGroup.type === "bd" ? ["BD 查驗登記流程"] : ["一般專案"];
      const template = templateRows.results.find((row) => row.group_id === projectGroup.id) ?? templateRows.results.find((row) => preferredNames.includes(row.name)) ?? templateRows.results.find((row) => row.name === "一般專案");
      try { requestedStages = template ? JSON.parse(template.stages_json) as string[] : ["待辦", "進行中", "完成"]; } catch { requestedStages = ["待辦", "進行中", "完成"]; }
    }
    for (const stageName of requestedStages) {
      if (stages.has(stageName)) continue;
      const stageId = createId("stage");
      await run(db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES (?,?,?,?,?)").bind(stageId, projectId, stageName, stageColorFor(stageName), stages.size));
      stages.set(stageName, stageId);
    }

    for (const task of objects(item.tasks, `${label}.tasks`)) {
      const title = text(task.title);
      const stageName = text(task.stage) ?? stages.keys().next().value;
      if (!title || !stageName) throw new ImportValidationError(`${label}: task title/stage 必填`);
      const startDate = date(task.start_date, `${label}/task ${title}.start_date`);
      const dueDate = date(task.due_date, `${label}/task ${title}.due_date`);
      if (startDate && dueDate && startDate > dueDate) throw new ImportValidationError(`${label}/task ${title}：開始日不能晚於到期日`);
      let stageId = stages.get(stageName);
      if (!stageId) {
        stageId = createId("stage");
        await run(db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES (?,?,?,?,?)").bind(stageId, projectId, stageName, stageColorFor(stageName), stages.size));
        stages.set(stageName, stageId);
      }
      if (await db.prepare("SELECT id FROM tasks WHERE project_id=? AND stage_id=? AND title=?").bind(projectId, stageId, title).first()) { stats.tasks.skipped += 1; continue; }
      const assignee = person(task.assignee_email);
      if (assignee.warning) stats.warnings.push(`${label}/task ${title}: ${assignee.warning}`);
      const done = task.done === true || task.done === 1 ? 1 : 0;
      const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM tasks WHERE stage_id=?").bind(stageId).first<number>("value");
      await run(db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,description,assignee_id,start_date,due_date,position,done,done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(createId("task"), projectId, stageId, title, assignee.notePrefix, assignee.userId, startDate, dueDate, position ?? 0, done, done ? new Date().toISOString() : null));
      stats.tasks.created += 1;
    }

    for (const [field, kind] of [["milestones", "milestone"], ["events", "event"]] as const) {
      for (const milestone of objects(item[field], `${label}.${field}`)) {
        const title = text(milestone.title);
        const dueDate = date(milestone.due_date, `${label}.${field}[].due_date`, kind === "milestone");
        const endDate = date(milestone.end_date, `${label}.${field}[].end_date`);
        if (!title) throw new ImportValidationError(`${label}.${field}[].title 必填`);
        if (kind === "event" && !dueDate) throw new ImportValidationError(`${label}.${field}[].due_date 必填`);
        const rangeError = milestoneDateRangeError(dueDate, endDate);
        if (rangeError) throw new ImportValidationError(`${label}.${field}「${title}」：${rangeError}`);
        if (await db.prepare("SELECT id FROM milestones WHERE project_id=? AND kind=? AND title=? AND due_date IS ?").bind(projectId, kind, title, dueDate).first()) {
          stats[field].skipped += 1;
          continue;
        }
        const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM milestones WHERE project_id=?").bind(projectId).first<number>("value");
        const done = kind === "event" ? 1 : (milestone.done === true || milestone.done === 1 ? 1 : 0);
        await run(db.prepare("INSERT INTO milestones (id,project_id,title,due_date,end_date,done,done_at,position,kind) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(createId(kind === "event" ? "evt" : "ms"), projectId, title, dueDate, endDate, done, done ? new Date().toISOString() : null, position ?? 0, kind));
        stats[field].created += 1;
      }
    }

    for (const update of objects(item.progress_updates, `${label}.progress_updates`)) {
      const updateDate = date(update.date, `${label}.progress_updates[].date`, false) as string;
      const rawContent = text(update.content);
      if (!rawContent) throw new ImportValidationError(`${label}: progress_updates[].content 必填`);
      const writer = author(update.author_email);
      if (writer.warning) stats.warnings.push(`${label}/update ${updateDate}: ${writer.warning}`);
      const content = prefixed(writer.notePrefix, rawContent);
      if (await db.prepare("SELECT id FROM progress_updates WHERE project_id=? AND substr(created_at,1,10)=? AND substr(content,1,40)=?").bind(projectId, updateDate, content.slice(0, 40)).first()) { stats.progress_updates.skipped += 1; continue; }
      await run(db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot,created_at) VALUES (?,?,?,?,?,?)")
        .bind(createId("upd"), projectId, writer.userId, content, item.progress === undefined ? null : Math.round(numberIn(item.progress, 0, 100, 0)), `${updateDate}T04:00:00.000Z`));
      stats.progress_updates.created += 1;
    }

    const clinical = object(item.clinical);
    if (clinical) {
      if (clinical.target_n !== undefined) await run(db.prepare("INSERT OR IGNORE INTO clinical_settings (project_id,target_n) VALUES (?,?)").bind(projectId, Math.max(0, Math.round(Number(clinical.target_n) || 0))));
      for (const enrollment of objects(clinical.enrollments, `${label}.clinical.enrollments`)) {
        const recordDate = date(enrollment.record_date ?? enrollment.date, `${label}.clinical.enrollments[].record_date`, false) as string;
        const count = Math.max(0, Math.round(Number(enrollment.count) || 0));
        const site = text(enrollment.site);
        if (await db.prepare("SELECT id FROM clinical_enrollments WHERE project_id=? AND record_date=? AND COALESCE(site,'')=COALESCE(?,'') AND count=?").bind(projectId, recordDate, site, count).first()) continue;
        const writer = person(enrollment.author_email);
        if (writer.warning) stats.warnings.push(`${label}/enrollment ${recordDate}: ${writer.warning}`);
        await run(db.prepare("INSERT INTO clinical_enrollments (id,project_id,record_date,site,count,note,created_by) VALUES (?,?,?,?,?,?,?)")
          .bind(createId("enr"), projectId, recordDate, site, count, prefixed(writer.notePrefix, text(enrollment.note)), writer.userId));
      }
    }

    for (const license of objects(item.licenses, `${label}.licenses`)) {
      const licenseName = text(license.name);
      const expiresAt = date(license.expires_at, `${label}.licenses[].expires_at`, false) as string;
      if (!licenseName) throw new ImportValidationError(`${label}: licenses[].name 必填`);
      if (await db.prepare("SELECT id FROM licenses WHERE project_id=? AND name=? AND expires_at=?").bind(projectId, licenseName, expiresAt).first()) continue;
      await run(db.prepare("INSERT INTO licenses (id,project_id,name,subject,authority,license_no,issued_at,expires_at,status,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(createId("lic"), projectId, licenseName, text(license.subject) ?? "產品", text(license.authority) ?? "TFDA", text(license.license_no), date(license.issued_at, `${label}.licenses[].issued_at`), expiresAt, text(license.status) ?? "有效", text(license.note) ?? "", actor.id));
    }
    for (const ccr of objects(item.ccrs, `${label}.ccrs`)) await createCcrFromImport(db, projectId, ccr, actor.id, "", dryRun);

    // 匯進來的任務可能已經標完成；自動進度不重算的話，專案會一直顯示 0%。
    // 有明確填 progress 的保留那個值。
    if (!dryRun && item.progress === undefined) await recomputeAutoProgress(db, projectId, actor.id);
  }

  for (const [entryIndex, entry] of regEntries.entries()) {
    const entryDate = date(entry.entry_date, `reg_entries[${entryIndex}].entry_date`, false) as string;
    const title = text(entry.title);
    const entryType = text(entry.entry_type) ?? "announcement";
    const productLine = text(entry.product_line);
    if (!title || !productLine || !["announcement", "meeting"].includes(entryType) || !["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"].includes(productLine)) throw new ImportValidationError(`reg_entries[${entryIndex}] 資料不正確`);
    if (await db.prepare("SELECT id FROM reg_entries WHERE entry_date=? AND title=?").bind(entryDate, title).first()) { stats.reg_entries.skipped += 1; continue; }
    await run(db.prepare("INSERT INTO reg_entries (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(createId("reg"), entryDate, entryType, productLine, text(entry.category), title, text(entry.key_points), text(entry.link), actor.id));
    stats.reg_entries.created += 1;
  }
  return stats;
}

/** 既有呼叫端（管理頁、`scripts/import-remote.ts`）的入口，行為等同 admin 模式直接寫入。 */
export async function runAdminImport(db: D1Database, actor: AuthUser, payload: unknown): Promise<ImportStats> {
  return runImport(db, actor, payload, { mode: "admin" });
}
