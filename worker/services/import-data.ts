import type { AuthUser } from "../types";
import { createId } from "./db";
import { isIsoDate, resolveImportUser } from "./importer";
import { currentTaipeiQuarter, taipeiDate } from "./time";
import { milestoneDateRangeError } from "./milestone-dates";

type JsonObject = Record<string, unknown>;

export interface ImportStats {
  projects: { created: number; updated: number };
  tasks: { created: number; skipped: number };
  milestones: { created: number; skipped: number };
  events: { created: number; skipped: number };
  progress_updates: { created: number; skipped: number };
  reg_entries: { created: number; skipped: number };
  warnings: string[];
}

export class ImportValidationError extends Error {}

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

async function stageNamesForProject(db: D1Database, projectId: string): Promise<Map<string, string>> {
  const rows = await db.prepare("SELECT id,name FROM stages WHERE project_id=? ORDER BY position").bind(projectId).all<{ id: string; name: string }>();
  return new Map(rows.results.map((row) => [row.name, row.id]));
}

async function createCcrFromImport(db: D1Database, projectId: string, item: JsonObject, actorId: string, notePrefix: string): Promise<void> {
  const title = text(item.title);
  if (!title) throw new ImportValidationError("ccrs[].title 必填");
  if (await db.prepare("SELECT id FROM ccr_records WHERE project_id=? AND title=? AND reason=?").bind(projectId, title, text(item.reason) ?? "匯入").first()) return;
  const targetType = text(item.target_type) ?? "其他";
  const classification = text(item.classification) ?? "次要";
  const status = text(item.status) ?? "申請";
  if (!["產品", "文件", "供應商", "製程", "設備", "其他"].includes(targetType) || !["重大", "次要"].includes(classification) || !["申請", "評估中", "已核准", "執行中", "效期確認", "已結案", "駁回"].includes(status)) throw new ImportValidationError(`CCR「${title}」的類型、分級或狀態不正確`);
  const year = (date(item.requested_at, "ccrs[].requested_at") ?? taipeiDate()).slice(0, 4);
  const id = createId("ccr");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO ccr_records (id,project_id,ccr_no,title,target_type,description,reason,classification,impact_assessment,status,requested_by,approved_by,approved_at,closed_at,note)
      SELECT ?,?,'CCR-' || ? || '-' || printf('%03d',COALESCE(MAX(CASE WHEN ccr_no LIKE ? THEN CAST(substr(ccr_no,10) AS INTEGER) END),0)+1),?,?,?,?,?,?,?,?,?,?,?,? FROM ccr_records`)
      .bind(id, projectId, year, `CCR-${year}-%`, title, targetType, text(item.description) ?? "匯入資料", text(item.reason) ?? "匯入", classification, text(item.impact_assessment), status, actorId, ["已核准", "執行中", "效期確認", "已結案"].includes(status) ? actorId : null, ["已核准", "執行中", "效期確認", "已結案"].includes(status) ? now : null, status === "已結案" ? now : null, prefixed(notePrefix, text(item.note))),
    db.prepare("INSERT INTO ccr_events (id,ccr_id,event_type,from_status,to_status,description,created_by) VALUES (?,?,'狀態變更',NULL,?,'批次匯入直接落點',?)").bind(createId("ccre"), id, status, actorId),
  ]);
}

export async function runAdminImport(db: D1Database, actor: AuthUser, payload: unknown): Promise<ImportStats> {
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

  for (const [projectIndex, item] of projects.entries()) {
    const externalKey = text(item.external_key);
    const name = text(item.name);
    const groupValue = text(item.group);
    if (!externalKey || !name || !groupValue) throw new ImportValidationError(`projects[${projectIndex}] 缺少 external_key、name 或 group`);
    const group = groups.get(groupValue);
    if (!group) throw new ImportValidationError(`projects[${projectIndex}] 找不到組別 ${groupValue}`);
    const owner = resolveImportUser(item.owner_email, usersByEmail, actor.id);
    if (owner.warning) stats.warnings.push(`${externalKey}: ${owner.warning}`);
    const visibility = text(item.visibility) ?? "group";
    const status = text(item.status) ?? "active";
    if (!["all", "group", "private"].includes(visibility) || !["active", "paused", "done", "archived"].includes(status)) throw new ImportValidationError(`${externalKey}: visibility 或 status 不正確`);
    const startDate = date(item.start_date, `${externalKey}.start_date`);
    const targetDate = date(item.target_date, `${externalKey}.target_date`);
    const existing = await db.prepare("SELECT id,description,goal_summary,start_date,target_date,progress FROM projects WHERE external_key=?").bind(externalKey).first<{ id: string; description: string; goal_summary: string; start_date: string | null; target_date: string | null; progress: number }>();
    const projectId = existing?.id ?? createId("prj");
    const goalSummary = prefixed(owner.notePrefix, text(item.goal_summary) ?? existing?.goal_summary ?? "");
    if (existing) {
      await db.prepare("UPDATE projects SET name=?,group_id=?,owner_id=?,visibility=?,status=?,progress=?,goal_summary=?,start_date=?,target_date=?,updated_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(name, group.id, owner.userId, visibility, status, Math.round(numberIn(item.progress, 0, 100, existing.progress)), goalSummary, startDate ?? existing.start_date, targetDate ?? existing.target_date, projectId).run();
      stats.projects.updated += 1;
    } else {
      await db.prepare("INSERT INTO projects (id,external_key,name,description,group_id,owner_id,visibility,status,progress,goal_summary,start_date,target_date,progress_mode,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'auto', CURRENT_TIMESTAMP)")
        .bind(projectId, externalKey, name, owner.notePrefix, group.id, owner.userId, visibility, status, Math.round(numberIn(item.progress, 0, 100, 0)), goalSummary, startDate, targetDate).run();
      stats.projects.created += 1;
    }

    for (const goal of objects(item.quarter_goals, `${externalKey}.quarter_goals`)) {
      const quarter = text(goal.quarter) ?? currentTaipeiQuarter();
      const objective = text(goal.objective);
      if (!/^\d{4}Q[1-4]$/.test(quarter) || !objective) throw new ImportValidationError(`${externalKey}: 季度目標格式不正確`);
      await db.prepare("INSERT OR IGNORE INTO project_quarter_goals (id,project_id,quarter,objective) VALUES (?,?,?,?)").bind(createId("obj"), projectId, quarter, objective).run();
    }

    for (const kr of objects(item.key_results, `${externalKey}.key_results`)) {
      const title = text(kr.title);
      const quarter = text(kr.quarter) ?? currentTaipeiQuarter();
      const krStatus = text(kr.status) ?? "未開始";
      if (!title || !/^\d{4}Q[1-4]$/.test(quarter) || !["未開始", "進行中", "完成", "暫停"].includes(krStatus)) throw new ImportValidationError(`${externalKey}: KR 格式不正確`);
      if (await db.prepare("SELECT id FROM key_results WHERE project_id=? AND quarter=? AND title=?").bind(projectId, quarter, title).first()) continue;
      const krOwner = resolveImportUser(kr.owner_email, usersByEmail, actor.id);
      if (krOwner.warning) stats.warnings.push(`${externalKey}/KR ${title}: ${krOwner.warning}`);
      const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM key_results WHERE project_id=? AND quarter=?").bind(projectId, quarter).first<number>("value");
      await db.prepare("INSERT INTO key_results (id,project_id,title,owner_id,quarter,status,note,position) VALUES (?,?,?,?,?,?,?,?)")
        .bind(createId("kr"), projectId, title, krOwner.userId, quarter, krStatus, krOwner.notePrefix, position ?? 0).run();
    }

    let stages = await stageNamesForProject(db, projectId);
    let requestedStages: string[] = [];
    if (item.stages !== undefined) {
      if (!Array.isArray(item.stages) || !item.stages.every((stage) => typeof stage === "string" && stage.trim())) throw new ImportValidationError(`${externalKey}.stages 必須是字串陣列`);
      requestedStages = item.stages.map((stage) => String(stage).trim());
    } else if (stages.size === 0) {
      const preferredNames = group.type === "clinical" ? ["臨床試驗流程"] : group.type === "bd" ? ["BD 查驗登記流程"] : ["一般專案"];
      const template = templateRows.results.find((row) => row.group_id === group.id) ?? templateRows.results.find((row) => preferredNames.includes(row.name)) ?? templateRows.results.find((row) => row.name === "一般專案");
      try { requestedStages = template ? JSON.parse(template.stages_json) as string[] : ["待辦", "進行中", "完成"]; } catch { requestedStages = ["待辦", "進行中", "完成"]; }
    }
    for (const stageName of requestedStages) {
      if (stages.has(stageName)) continue;
      const stageId = createId("stage");
      await db.prepare("INSERT INTO stages (id,project_id,name,position) VALUES (?,?,?,?)").bind(stageId, projectId, stageName, stages.size).run();
      stages.set(stageName, stageId);
    }

    for (const task of objects(item.tasks, `${externalKey}.tasks`)) {
      const title = text(task.title);
      const stageName = text(task.stage) ?? stages.keys().next().value;
      if (!title || !stageName) throw new ImportValidationError(`${externalKey}: task title/stage 必填`);
      let stageId = stages.get(stageName);
      if (!stageId) {
        stageId = createId("stage");
        await db.prepare("INSERT INTO stages (id,project_id,name,position) VALUES (?,?,?,?)").bind(stageId, projectId, stageName, stages.size).run();
        stages.set(stageName, stageId);
      }
      if (await db.prepare("SELECT id FROM tasks WHERE project_id=? AND stage_id=? AND title=?").bind(projectId, stageId, title).first()) { stats.tasks.skipped += 1; continue; }
      const assignee = resolveImportUser(task.assignee_email, usersByEmail, actor.id);
      if (assignee.warning) stats.warnings.push(`${externalKey}/task ${title}: ${assignee.warning}`);
      const dueDate = date(task.due_date, `${externalKey}/task ${title}.due_date`);
      const done = task.done === true || task.done === 1 ? 1 : 0;
      const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM tasks WHERE stage_id=?").bind(stageId).first<number>("value");
      await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,description,assignee_id,due_date,position,done,done_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(createId("task"), projectId, stageId, title, assignee.notePrefix, assignee.userId, dueDate, position ?? 0, done, done ? new Date().toISOString() : null).run();
      stats.tasks.created += 1;
    }

    for (const [field, kind] of [["milestones", "milestone"], ["events", "event"]] as const) {
      for (const milestone of objects(item[field], `${externalKey}.${field}`)) {
        const title = text(milestone.title);
        const dueDate = date(milestone.due_date, `${externalKey}.${field}[].due_date`, kind === "milestone");
        const endDate = date(milestone.end_date, `${externalKey}.${field}[].end_date`);
        if (!title) throw new ImportValidationError(`${externalKey}.${field}[].title 必填`);
        if (kind === "event" && !dueDate) throw new ImportValidationError(`${externalKey}.${field}[].due_date 必填`);
        const rangeError = milestoneDateRangeError(dueDate, endDate);
        if (rangeError) throw new ImportValidationError(`${externalKey}.${field}「${title}」：${rangeError}`);
        if (await db.prepare("SELECT id FROM milestones WHERE project_id=? AND kind=? AND title=? AND due_date IS ?").bind(projectId, kind, title, dueDate).first()) {
          stats[field].skipped += 1;
          continue;
        }
        const position = await db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM milestones WHERE project_id=?").bind(projectId).first<number>("value");
        const done = kind === "event" ? 1 : (milestone.done === true || milestone.done === 1 ? 1 : 0);
        await db.prepare("INSERT INTO milestones (id,project_id,title,due_date,end_date,done,done_at,position,kind) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(createId(kind === "event" ? "evt" : "ms"), projectId, title, dueDate, endDate, done, done ? new Date().toISOString() : null, position ?? 0, kind).run();
        stats[field].created += 1;
      }
    }

    for (const update of objects(item.progress_updates, `${externalKey}.progress_updates`)) {
      const updateDate = date(update.date, `${externalKey}.progress_updates[].date`, false) as string;
      const rawContent = text(update.content);
      if (!rawContent) throw new ImportValidationError(`${externalKey}: progress_updates[].content 必填`);
      const author = resolveImportUser(update.author_email, usersByEmail, actor.id);
      if (author.warning) stats.warnings.push(`${externalKey}/update ${updateDate}: ${author.warning}`);
      const content = prefixed(author.notePrefix, rawContent);
      if (await db.prepare("SELECT id FROM progress_updates WHERE project_id=? AND substr(created_at,1,10)=? AND substr(content,1,40)=?").bind(projectId, updateDate, content.slice(0, 40)).first()) { stats.progress_updates.skipped += 1; continue; }
      await db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot,created_at) VALUES (?,?,?,?,?,?)")
        .bind(createId("upd"), projectId, author.userId, content, item.progress === undefined ? null : Math.round(numberIn(item.progress, 0, 100, 0)), `${updateDate}T04:00:00.000Z`).run();
      stats.progress_updates.created += 1;
    }

    const clinical = object(item.clinical);
    if (clinical) {
      if (clinical.target_n !== undefined) await db.prepare("INSERT OR IGNORE INTO clinical_settings (project_id,target_n) VALUES (?,?)").bind(projectId, Math.max(0, Math.round(Number(clinical.target_n) || 0))).run();
      for (const enrollment of objects(clinical.enrollments, `${externalKey}.clinical.enrollments`)) {
        const recordDate = date(enrollment.record_date ?? enrollment.date, `${externalKey}.clinical.enrollments[].record_date`, false) as string;
        const count = Math.max(0, Math.round(Number(enrollment.count) || 0));
        const site = text(enrollment.site);
        if (await db.prepare("SELECT id FROM clinical_enrollments WHERE project_id=? AND record_date=? AND COALESCE(site,'')=COALESCE(?,'') AND count=?").bind(projectId, recordDate, site, count).first()) continue;
        const author = resolveImportUser(enrollment.author_email, usersByEmail, actor.id);
        if (author.warning) stats.warnings.push(`${externalKey}/enrollment ${recordDate}: ${author.warning}`);
        await db.prepare("INSERT INTO clinical_enrollments (id,project_id,record_date,site,count,note,created_by) VALUES (?,?,?,?,?,?,?)")
          .bind(createId("enr"), projectId, recordDate, site, count, prefixed(author.notePrefix, text(enrollment.note)), author.userId).run();
      }
    }

    for (const license of objects(item.licenses, `${externalKey}.licenses`)) {
      const licenseName = text(license.name);
      const expiresAt = date(license.expires_at, `${externalKey}.licenses[].expires_at`, false) as string;
      if (!licenseName) throw new ImportValidationError(`${externalKey}: licenses[].name 必填`);
      if (await db.prepare("SELECT id FROM licenses WHERE project_id=? AND name=? AND expires_at=?").bind(projectId, licenseName, expiresAt).first()) continue;
      await db.prepare("INSERT INTO licenses (id,project_id,name,subject,authority,license_no,issued_at,expires_at,status,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(createId("lic"), projectId, licenseName, text(license.subject) ?? "產品", text(license.authority) ?? "TFDA", text(license.license_no), date(license.issued_at, `${externalKey}.licenses[].issued_at`), expiresAt, text(license.status) ?? "有效", text(license.note) ?? "", actor.id).run();
    }
    for (const ccr of objects(item.ccrs, `${externalKey}.ccrs`)) await createCcrFromImport(db, projectId, ccr, actor.id, "");
  }

  for (const [entryIndex, entry] of regEntries.entries()) {
    const entryDate = date(entry.entry_date, `reg_entries[${entryIndex}].entry_date`, false) as string;
    const title = text(entry.title);
    const entryType = text(entry.entry_type) ?? "announcement";
    const productLine = text(entry.product_line);
    if (!title || !productLine || !["announcement", "meeting"].includes(entryType) || !["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"].includes(productLine)) throw new ImportValidationError(`reg_entries[${entryIndex}] 資料不正確`);
    if (await db.prepare("SELECT id FROM reg_entries WHERE entry_date=? AND title=?").bind(entryDate, title).first()) { stats.reg_entries.skipped += 1; continue; }
    await db.prepare("INSERT INTO reg_entries (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(createId("reg"), entryDate, entryType, productLine, text(entry.category), title, text(entry.key_points), text(entry.link), actor.id).run();
    stats.reg_entries.created += 1;
  }
  return stats;
}
