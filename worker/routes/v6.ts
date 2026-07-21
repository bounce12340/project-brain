import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { optionalString, requiredString } from "../services/http";
import { canEditProgress, canViewProject } from "../services/permissions";
import { canTransitionCcr, ccrStatuses, type CcrStatus } from "../services/ccr";
import { canManageRegwatch } from "../services/regwatch";
import { currentTaipeiQuarter, taipeiDate } from "../services/time";
import { recomputeAutoProgress } from "../services/auto-progress";
import { runAutomationRules } from "../services/automation";
import { isIsoDate } from "../services/importer";

export const v6Routes = new Hono<AppContext>();

const licenseStatuses = new Set(["有效", "換證中", "已過期", "已停用"]);
const ccrTargetTypes = new Set(["產品", "文件", "供應商", "製程", "設備", "其他"]);
const ccrClassifications = new Set(["重大", "次要"]);
const krStatuses = new Set(["未開始", "進行中", "完成", "暫停"]);
const entryTypes = new Set(["announcement", "meeting"]);
const productLines = new Set(["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"]);
const quarterPattern = /^\d{4}Q[1-4]$/;

async function isQaProject(db: D1Database, projectId: string): Promise<boolean> {
  return (await db.prepare("SELECT g.type FROM projects p JOIN groups g ON g.id=p.group_id WHERE p.id=?").bind(projectId).first<string>("type")) === "qa";
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

v6Routes.get("/projects/:id/licenses", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  if (!(await isQaProject(c.env.DB, projectId))) return c.json({ error: "僅 QA 專案提供效期登記簿" }, 422);
  const rows = await c.env.DB.prepare("SELECT l.*,u.name AS created_by_name FROM licenses l JOIN users u ON u.id=l.created_by WHERE l.project_id=? ORDER BY l.expires_at,l.name").bind(projectId).all();
  return c.json({ licenses: rows.results, can_edit: canEditProgress(c.get("user"), access), today: taipeiDate() });
});

v6Routes.post("/projects/:id/licenses", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  if (!(await isQaProject(c.env.DB, projectId))) return c.json({ error: "僅 QA 專案可建立效期紀錄" }, 422);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const subject = requiredString(body, "subject");
  const expiresAt = requiredString(body, "expires_at");
  const status = requiredString(body, "status") ?? "有效";
  const issuedAt = optionalString(body, "issued_at");
  if (!name || !subject || !isIsoDate(expiresAt) || (issuedAt && !isIsoDate(issuedAt)) || !licenseStatuses.has(status)) return c.json({ error: "效期資料不完整" }, 422);
  const id = createId("lic");
  await c.env.DB.prepare("INSERT INTO licenses (id,project_id,name,subject,authority,license_no,issued_at,expires_at,status,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, name, subject, optionalString(body, "authority") ?? "TFDA", optionalString(body, "license_no"), issuedAt, expiresAt, status, optionalString(body, "note") ?? "", c.get("user").id).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ id }, 201);
});

v6Routes.patch("/licenses/:id", async (c) => {
  const current = await c.env.DB.prepare("SELECT * FROM licenses WHERE id=?").bind(c.req.param("id")).first<Record<string, string | null>>();
  if (!current) return c.json({ error: "找不到效期紀錄" }, 404);
  const access = await getProjectAccess(c.env.DB, String(current.project_id));
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const status = optionalString(body, "status") ?? String(current.status);
  if (!licenseStatuses.has(status)) return c.json({ error: "效期狀態不正確" }, 422);
  const expiresAt = optionalString(body, "expires_at") ?? String(current.expires_at);
  const issuedAt = "issued_at" in body ? optionalString(body, "issued_at") : current.issued_at;
  if (!isIsoDate(expiresAt) || (issuedAt && !isIsoDate(issuedAt))) return c.json({ error: "效期日期格式不正確" }, 422);
  await c.env.DB.prepare("UPDATE licenses SET name=?,subject=?,authority=?,license_no=?,issued_at=?,expires_at=?,status=?,note=?,last_notified_stage=CASE WHEN expires_at!=? THEN NULL ELSE last_notified_stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "name") ?? current.name, optionalString(body, "subject") ?? current.subject, optionalString(body, "authority") ?? current.authority, "license_no" in body ? optionalString(body, "license_no") : current.license_no, issuedAt, expiresAt, status, "note" in body ? optionalString(body, "note") ?? "" : current.note, expiresAt, c.req.param("id")).run();
  await touchProject(c.env.DB, access.id);
  return c.json({ ok: true });
});

v6Routes.delete("/licenses/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT project_id FROM licenses WHERE id=?").bind(c.req.param("id")).first<{ project_id: string }>();
  if (!row) return c.json({ error: "找不到效期紀錄" }, 404);
  const access = await getProjectAccess(c.env.DB, row.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM licenses WHERE id=?").bind(c.req.param("id")).run();
  await touchProject(c.env.DB, row.project_id);
  return c.json({ ok: true });
});

v6Routes.get("/projects/:id/ccrs/export", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const rows = await c.env.DB.prepare("SELECT ccr_no,title,target_type,classification,status,reason,impact_assessment,requested_at,approved_at,closed_at,note FROM ccr_records WHERE project_id=? ORDER BY ccr_no").bind(projectId).all<Record<string, unknown>>();
  const headers = ["CCR編號", "標題", "標的類型", "分級", "狀態", "原因", "影響評估", "申請時間", "核准時間", "結案時間", "備註"];
  const keys = ["ccr_no", "title", "target_type", "classification", "status", "reason", "impact_assessment", "requested_at", "approved_at", "closed_at", "note"];
  const csv = "\uFEFF" + [headers.map(csvCell).join(","), ...rows.results.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ccr-${projectId}.csv"` } });
});

v6Routes.get("/projects/:id/ccrs", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  if (!(await isQaProject(c.env.DB, projectId))) return c.json({ error: "僅 QA 專案提供 CCR" }, 422);
  const filters: string[] = ["c.project_id=?"];
  const values: unknown[] = [projectId];
  for (const [queryKey, column] of [["status", "c.status"], ["classification", "c.classification"], ["target_type", "c.target_type"]] as const) {
    const value = c.req.query(queryKey);
    if (value) { filters.push(`${column}=?`); values.push(value); }
  }
  const keyword = c.req.query("keyword")?.trim();
  if (keyword) { filters.push("(c.ccr_no LIKE ? OR c.title LIKE ? OR c.description LIKE ?)"); values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  const rows = await c.env.DB.prepare(`SELECT c.*,u.name AS requested_by_name,a.name AS approved_by_name FROM ccr_records c JOIN users u ON u.id=c.requested_by LEFT JOIN users a ON a.id=c.approved_by WHERE ${filters.join(" AND ")} ORDER BY c.created_at DESC`).bind(...values).all();
  const events = await c.env.DB.prepare("SELECT e.*,u.name AS created_by_name FROM ccr_events e JOIN ccr_records c ON c.id=e.ccr_id JOIN users u ON u.id=e.created_by WHERE c.project_id=? ORDER BY e.created_at").bind(projectId).all();
  return c.json({ ccrs: rows.results, events: events.results, can_edit: canEditProgress(c.get("user"), access), can_reopen: c.get("user").role === "admin" });
});

v6Routes.post("/projects/:id/ccrs", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  const user = c.get("user");
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  if (!(await isQaProject(c.env.DB, projectId))) return c.json({ error: "僅 QA 專案可建立 CCR" }, 422);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = requiredString(body, "title");
  const targetType = requiredString(body, "target_type");
  const description = requiredString(body, "description");
  const reason = requiredString(body, "reason");
  const classification = requiredString(body, "classification");
  if (!title || !targetType || !description || !reason || !classification || !ccrTargetTypes.has(targetType) || !ccrClassifications.has(classification)) return c.json({ error: "CCR 資料不完整" }, 422);
  const year = taipeiDate().slice(0, 4);
  const id = createId("ccr");
  const eventId = createId("ccre");
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO ccr_records (id,project_id,ccr_no,title,target_type,description,reason,classification,impact_assessment,requested_by,note)
      SELECT ?,?,'CCR-' || ? || '-' || printf('%03d',COALESCE(MAX(CASE WHEN ccr_no LIKE ? THEN CAST(substr(ccr_no,10) AS INTEGER) END),0)+1),?,?,?,?,?,?,?,? FROM ccr_records`)
      .bind(id, projectId, year, `CCR-${year}-%`, title, targetType, description, reason, classification, optionalString(body, "impact_assessment"), user.id, optionalString(body, "note") ?? ""),
    c.env.DB.prepare("INSERT INTO ccr_events (id,ccr_id,event_type,from_status,to_status,description,created_by) VALUES (?,?,'狀態變更',NULL,'申請','建立 CCR',?)").bind(eventId, id, user.id),
  ]);
  await touchProject(c.env.DB, projectId);
  const ccrNo = await c.env.DB.prepare("SELECT ccr_no FROM ccr_records WHERE id=?").bind(id).first<string>("ccr_no");
  return c.json({ id, ccr_no: ccrNo }, 201);
});

v6Routes.patch("/ccrs/:id", async (c) => {
  const current = await c.env.DB.prepare("SELECT * FROM ccr_records WHERE id=?").bind(c.req.param("id")).first<Record<string, string | null>>();
  if (!current) return c.json({ error: "找不到 CCR" }, 404);
  const access = await getProjectAccess(c.env.DB, String(current.project_id));
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const targetType = optionalString(body, "target_type") ?? String(current.target_type);
  const classification = optionalString(body, "classification") ?? String(current.classification);
  if (!ccrTargetTypes.has(targetType) || !ccrClassifications.has(classification)) return c.json({ error: "CCR 類型或分級不正確" }, 422);
  await c.env.DB.prepare("UPDATE ccr_records SET title=?,target_type=?,description=?,reason=?,classification=?,impact_assessment=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "title") ?? current.title, targetType, optionalString(body, "description") ?? current.description, optionalString(body, "reason") ?? current.reason, classification, "impact_assessment" in body ? optionalString(body, "impact_assessment") : current.impact_assessment, "note" in body ? optionalString(body, "note") ?? "" : current.note, c.req.param("id")).run();
  await touchProject(c.env.DB, access.id);
  return c.json({ ok: true });
});

v6Routes.post("/ccrs/:id/transition", async (c) => {
  const row = await c.env.DB.prepare("SELECT id,project_id,title,status,requested_by FROM ccr_records WHERE id=?").bind(c.req.param("id")).first<{ id: string; project_id: string; title: string; status: CcrStatus; requested_by: string }>();
  if (!row) return c.json({ error: "找不到 CCR" }, 404);
  const access = await getProjectAccess(c.env.DB, row.project_id);
  const user = c.get("user");
  if (!access || !canEditProgress(user, access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const nextStatus = requiredString(body, "status") as CcrStatus | null;
  if (!nextStatus || !ccrStatuses.includes(nextStatus) || !canTransitionCcr(row.status, nextStatus, user.role === "admin")) return c.json({ error: "不允許的 CCR 狀態流轉" }, 422);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE ccr_records SET status=?,approved_by=CASE WHEN ?='已核准' THEN ? ELSE approved_by END,approved_at=CASE WHEN ?='已核准' THEN ? ELSE approved_at END,closed_at=CASE WHEN ?='已結案' THEN ? WHEN ?='評估中' THEN NULL ELSE closed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(nextStatus, nextStatus, user.id, nextStatus, now, nextStatus, now, nextStatus, row.id),
    c.env.DB.prepare("INSERT INTO ccr_events (id,ccr_id,event_type,from_status,to_status,description,created_by) VALUES (?,?,?,?,?,?,?)")
      .bind(createId("ccre"), row.id, (row.status === "駁回" || row.status === "已結案") ? "重開" : "狀態變更", row.status, nextStatus, optionalString(body, "description") ?? `狀態由${row.status}變更為${nextStatus}`, user.id),
  ];
  if (nextStatus === "效期確認") statements.push(c.env.DB.prepare("INSERT INTO todos (id,user_id,title,due_date,project_id) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM todos WHERE user_id=? AND project_id=? AND title=? AND done=0)")
    .bind(createId("todo"), row.requested_by, `CCR 效期確認：${row.title}`, addDays(taipeiDate(), 30), row.project_id, row.requested_by, row.project_id, `CCR 效期確認：${row.title}`));
  await c.env.DB.batch(statements);
  await touchProject(c.env.DB, row.project_id);
  return c.json({ ok: true, status: nextStatus });
});

v6Routes.post("/ccrs/:id/events", async (c) => {
  const row = await c.env.DB.prepare("SELECT project_id FROM ccr_records WHERE id=?").bind(c.req.param("id")).first<{ project_id: string }>();
  if (!row) return c.json({ error: "找不到 CCR" }, 404);
  const access = await getProjectAccess(c.env.DB, row.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const description = requiredString(body, "description");
  if (!description) return c.json({ error: "請輸入備註" }, 422);
  await c.env.DB.prepare("INSERT INTO ccr_events (id,ccr_id,event_type,description,created_by) VALUES (?,?,'備註',?,?)").bind(createId("ccre"), c.req.param("id"), description, c.get("user").id).run();
  await touchProject(c.env.DB, row.project_id);
  return c.json({ ok: true }, 201);
});

v6Routes.get("/projects/:id/okr", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canViewProject(c.get("user"), access)) return c.json({ error: "沒有檢視權限" }, 403);
  const quarter = c.req.query("quarter") ?? currentTaipeiQuarter();
  if (!quarterPattern.test(quarter)) return c.json({ error: "季度格式不正確" }, 422);
  const [goal, keyResults] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM project_quarter_goals WHERE project_id=? AND quarter=?").bind(projectId, quarter).first(),
    c.env.DB.prepare("SELECT kr.*,u.name AS owner_name FROM key_results kr LEFT JOIN users u ON u.id=kr.owner_id WHERE kr.project_id=? AND kr.quarter=? ORDER BY kr.position,kr.created_at").bind(projectId, quarter).all(),
  ]);
  return c.json({ quarter, objective: goal, key_results: keyResults.results, can_edit: canEditProgress(c.get("user"), access) });
});

v6Routes.put("/projects/:id/quarter-goals/:quarter", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const quarter = c.req.param("quarter");
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const objective = requiredString(body, "objective");
  if (!quarterPattern.test(quarter) || !objective) return c.json({ error: "季度或目標不正確" }, 422);
  await c.env.DB.prepare("INSERT INTO project_quarter_goals (id,project_id,quarter,objective) VALUES (?,?,?,?) ON CONFLICT(project_id,quarter) DO UPDATE SET objective=excluded.objective")
    .bind(createId("obj"), projectId, quarter, objective).run();
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});

v6Routes.post("/projects/:id/key-results", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = requiredString(body, "title");
  const quarter = requiredString(body, "quarter") ?? currentTaipeiQuarter();
  const status = requiredString(body, "status") ?? "未開始";
  if (!title || !quarterPattern.test(quarter) || !krStatuses.has(status)) return c.json({ error: "KR 資料不正確" }, 422);
  const position = await c.env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS value FROM key_results WHERE project_id=? AND quarter=?").bind(projectId, quarter).first<number>("value");
  const id = createId("kr");
  await c.env.DB.prepare("INSERT INTO key_results (id,project_id,title,owner_id,quarter,status,note,position) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, projectId, title, optionalString(body, "owner_id"), quarter, status, optionalString(body, "note") ?? "", position ?? 0).run();
  await touchProject(c.env.DB, projectId);
  await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id);
  return c.json({ id }, 201);
});

v6Routes.patch("/key-results/:id", async (c) => {
  const current = await c.env.DB.prepare("SELECT * FROM key_results WHERE id=?").bind(c.req.param("id")).first<Record<string, string | number | null>>();
  if (!current) return c.json({ error: "找不到 KR" }, 404);
  const projectId = String(current.project_id);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const status = optionalString(body, "status") ?? String(current.status);
  const quarter = optionalString(body, "quarter") ?? String(current.quarter);
  if (!krStatuses.has(status) || !quarterPattern.test(quarter)) return c.json({ error: "KR 狀態或季度不正確" }, 422);
  await c.env.DB.prepare("UPDATE key_results SET title=?,owner_id=?,quarter=?,status=?,note=?,position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "title") ?? current.title, "owner_id" in body ? optionalString(body, "owner_id") : current.owner_id, quarter, status, "note" in body ? optionalString(body, "note") ?? "" : current.note, "position" in body ? Number(body.position) : current.position, c.req.param("id")).run();
  await touchProject(c.env.DB, projectId);
  const progress = await recomputeAutoProgress(c.env.DB, projectId, c.get("user").id, status === "完成" && current.status !== "完成" ? `完成 KR「${String(current.title)}」` : undefined);
  if (progress?.changed) await runAutomationRules(c.env.DB, c.get("user").id, projectId, [{ type: "progress_reached", previousProgress: progress.previous, progress: progress.progress }]);
  return c.json({ ok: true, project_progress: progress?.progress });
});

v6Routes.delete("/key-results/:id", async (c) => {
  const current = await c.env.DB.prepare("SELECT project_id FROM key_results WHERE id=?").bind(c.req.param("id")).first<{ project_id: string }>();
  if (!current) return c.json({ error: "找不到 KR" }, 404);
  const access = await getProjectAccess(c.env.DB, current.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  await c.env.DB.prepare("DELETE FROM key_results WHERE id=?").bind(c.req.param("id")).run();
  await touchProject(c.env.DB, current.project_id);
  await recomputeAutoProgress(c.env.DB, current.project_id, c.get("user").id);
  return c.json({ ok: true });
});

v6Routes.post("/projects/:id/key-results/reorder", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: { ids?: unknown } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) return c.json({ error: "排序資料不正確" }, 422);
  const existing = await c.env.DB.prepare(`SELECT id FROM key_results WHERE project_id=? AND id IN (${body.ids.map(() => "?").join(",") || "NULL"})`).bind(projectId, ...body.ids).all<{ id: string }>();
  if (existing.results.length !== body.ids.length) return c.json({ error: "KR 不屬於此專案" }, 422);
  if (body.ids.length) await c.env.DB.batch(body.ids.map((id, position) => c.env.DB.prepare("UPDATE key_results SET position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(position, id)));
  return c.json({ ok: true });
});

v6Routes.get("/regwatch", async (c) => {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const productLine = c.req.query("product_line");
  const entryType = c.req.query("entry_type");
  const year = c.req.query("year");
  const keyword = c.req.query("keyword")?.trim();
  if (productLine) { conditions.push("product_line=?"); values.push(productLine); }
  if (entryType) { conditions.push("entry_type=?"); values.push(entryType); }
  if (year) { conditions.push("substr(entry_date,1,4)=?"); values.push(year); }
  if (keyword) { conditions.push("(title LIKE ? OR COALESCE(key_points,'') LIKE ?)"); values.push(`%${keyword}%`, `%${keyword}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(`SELECT r.*,u.name AS created_by_name FROM reg_entries r JOIN users u ON u.id=r.created_by ${where} ORDER BY entry_date DESC,created_at DESC LIMIT 50 OFFSET ?`).bind(...values, (page - 1) * 50).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS value FROM reg_entries ${where}`).bind(...values).first<number>("value"),
  ]);
  return c.json({ entries: rows.results, page, total: total ?? 0, total_pages: Math.ceil((total ?? 0) / 50), can_manage: canManageRegwatch(c.get("user")) });
});

v6Routes.post("/regwatch", async (c) => {
  const user = c.get("user");
  if (!canManageRegwatch(user)) return c.json({ error: "僅 RA/PV 組成員與管理員可維護法規動態" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const date = requiredString(body, "entry_date");
  const type = requiredString(body, "entry_type") ?? "announcement";
  const line = requiredString(body, "product_line");
  const title = requiredString(body, "title");
  if (!date || !isIsoDate(date) || !entryTypes.has(type) || !line || !productLines.has(line) || !title) return c.json({ error: "法規動態資料不完整" }, 422);
  const id = createId("reg");
  try {
    await c.env.DB.prepare("INSERT INTO reg_entries (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, date, type, line, optionalString(body, "category"), title, optionalString(body, "key_points"), optionalString(body, "link"), user.id).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "相同日期與標題已存在" }, 422);
    throw error;
  }
  await writeAudit(c.env.DB, user, "create", "reg_entry", id, `新增法規動態「${title}」`);
  return c.json({ id }, 201);
});

v6Routes.patch("/regwatch/:id", async (c) => {
  const user = c.get("user");
  if (!canManageRegwatch(user)) return c.json({ error: "僅 RA/PV 組成員與管理員可維護法規動態" }, 403);
  const current = await c.env.DB.prepare("SELECT * FROM reg_entries WHERE id=?").bind(c.req.param("id")).first<Record<string, string | null>>();
  if (!current) return c.json({ error: "找不到法規動態" }, 404);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const type = optionalString(body, "entry_type") ?? String(current.entry_type);
  const line = optionalString(body, "product_line") ?? String(current.product_line);
  const entryDate = optionalString(body, "entry_date") ?? String(current.entry_date);
  if (!isIsoDate(entryDate) || !entryTypes.has(type) || !productLines.has(line)) return c.json({ error: "日期、類型或產品線不正確" }, 422);
  try {
    await c.env.DB.prepare("UPDATE reg_entries SET entry_date=?,entry_type=?,product_line=?,category=?,title=?,key_points=?,link=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(entryDate, type, line, "category" in body ? optionalString(body, "category") : current.category, optionalString(body, "title") ?? current.title, "key_points" in body ? optionalString(body, "key_points") : current.key_points, "link" in body ? optionalString(body, "link") : current.link, c.req.param("id")).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "相同日期與標題已存在" }, 422);
    throw error;
  }
  await writeAudit(c.env.DB, user, "update", "reg_entry", c.req.param("id"), "更新法規動態");
  return c.json({ ok: true });
});

v6Routes.delete("/regwatch/:id", async (c) => {
  const user = c.get("user");
  if (!canManageRegwatch(user)) return c.json({ error: "僅 RA/PV 組成員與管理員可維護法規動態" }, 403);
  const current = await c.env.DB.prepare("SELECT title FROM reg_entries WHERE id=?").bind(c.req.param("id")).first<{ title: string }>();
  if (!current) return c.json({ error: "找不到法規動態" }, 404);
  await c.env.DB.prepare("DELETE FROM reg_entries WHERE id=?").bind(c.req.param("id")).run();
  await writeAudit(c.env.DB, user, "delete", "reg_entry", c.req.param("id"), `刪除法規動態「${current.title}」`);
  return c.json({ ok: true });
});
