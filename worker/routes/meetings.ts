import { Hono } from "hono";
import type { AppContext, AuthUser, ProjectAccess } from "../types";
import { createId, getProjectAccess, writeAudit } from "../services/db";
import { canViewProject } from "../services/permissions";
import { taipeiDateTime } from "../services/time";

/**
 * 會議記錄與外出上課紀錄。
 * 所有登入的人都看得到；掛在專案底下的會議只有看得到那個專案的人看得到。
 * 修改與刪除限建立的人與管理員。每一筆新增、修改、刪除都記稽核紀錄。
 */
export const meetingsRoutes = new Hono<AppContext>();

export type MeetingKind = "meeting" | "course";
const KINDS = new Set<MeetingKind>(["meeting", "course"]);
const KIND_LABEL: Record<MeetingKind, string> = { meeting: "會議記錄", course: "上課紀錄" };

export const MEETING_TEXT_FIELDS = { title: 120, location: 200, attendees: 500, organizer: 120, summary: 5000 } as const;
type TextField = keyof typeof MEETING_TEXT_FIELDS;
const LABELS: Record<TextField | "starts_at" | "ends_at" | "project_id", string> = { title: "名稱", location: "地點", attendees: "與會人員", organizer: "主辦單位", summary: "摘要", starts_at: "開始時間", ends_at: "結束時間", project_id: "相關專案" };
const MULTILINE: TextField[] = ["summary"];
/** 首頁「近期會議與上課」各列幾筆。 */
export const OVERVIEW_LIMIT = 5;

interface MeetingRow {
  id: string; kind: MeetingKind; title: string; starts_at: string; ends_at: string | null; location: string; attendees: string; organizer: string; summary: string;
  project_id: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
interface ListedRow extends MeetingRow {
  created_by_name: string | null; updated_by_name: string | null; project_name: string | null;
  p_owner_id: string | null; p_group_id: string | null; p_visibility: ProjectAccess["visibility"] | null; p_member_ids_csv: string | null;
}

/** 「YYYY-MM-DDTHH:MM」而且是真的日期時間（2 月 30 日、25 點都不行）。 */
export function isMeetingDateTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
}

/** 台北時間的現在，格式同 starts_at。 */
export const taipeiNow = (date = new Date()) => taipeiDateTime(date).replace(" ", "T");

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

type Cleaned = { error: string } | { values: Partial<Record<TextField | "starts_at" | "ends_at" | "project_id", string | null>> };

/** 只收認得的欄位；單行欄位的連續空白併成一個。partial 是修改：沒送的欄位不動。 */
function cleanFields(body: Record<string, unknown>, partial: boolean): Cleaned {
  const values: Partial<Record<TextField | "starts_at" | "ends_at" | "project_id", string | null>> = {};
  for (const [field, max] of Object.entries(MEETING_TEXT_FIELDS) as Array<[TextField, number]>) {
    if (!(field in body)) {
      if (!partial && field === "title") return { error: "請填寫名稱" };
      continue;
    }
    const raw = body[field];
    if (raw !== null && raw !== undefined && typeof raw !== "string") return { error: `${LABELS[field]}格式不正確` };
    const text = (raw ?? "").normalize("NFC");
    const value = MULTILINE.includes(field) ? text.trim() : text.replace(/\s+/g, " ").trim();
    if (field === "title" && !value) return { error: "請填寫名稱" };
    if ([...value].length > max) return { error: `${LABELS[field]}不能超過 ${max} 字` };
    values[field] = value;
  }
  if ("starts_at" in body || !partial) {
    if (!isMeetingDateTime(body.starts_at)) return { error: "請填寫開始時間" };
    values.starts_at = body.starts_at;
  }
  if ("ends_at" in body) {
    const raw = body.ends_at;
    if (raw === null || raw === "") values.ends_at = null;
    else if (!isMeetingDateTime(raw)) return { error: "結束時間格式不正確" };
    else values.ends_at = raw;
  }
  if ("project_id" in body) {
    const raw = body.project_id;
    if (raw === null || raw === "") values.project_id = null;
    else if (typeof raw !== "string") return { error: "相關專案格式不正確" };
    else values.project_id = raw;
  }
  return { values };
}

function accessOf(row: ListedRow): ProjectAccess | null {
  if (!row.project_id || !row.p_owner_id || !row.p_group_id || !row.p_visibility) return null;
  return { id: row.project_id, owner_id: row.p_owner_id, group_id: row.p_group_id, visibility: row.p_visibility, member_ids: row.p_member_ids_csv?.split(",").filter(Boolean) ?? [] };
}

/** 掛在專案底下的只給看得到該專案的人；專案被刪掉（project_id 變 null）的就是一般紀錄。 */
function visibleTo(user: AuthUser, row: ListedRow): boolean {
  const access = accessOf(row);
  return !access || canViewProject(user, access);
}

function present(user: AuthUser, row: ListedRow) {
  const { p_owner_id: _owner, p_group_id: _group, p_visibility: _visibility, p_member_ids_csv: _members, ...rest } = row;
  return { ...rest, can_edit: user.role === "admin" || row.created_by === user.id };
}

const SELECT = `SELECT m.*, cu.name AS created_by_name, uu.name AS updated_by_name, p.name AS project_name,
    p.owner_id AS p_owner_id, p.group_id AS p_group_id, p.visibility AS p_visibility,
    (SELECT GROUP_CONCAT(pm.user_id) FROM project_members pm WHERE pm.project_id = p.id) AS p_member_ids_csv
  FROM meetings m LEFT JOIN users cu ON cu.id=m.created_by LEFT JOIN users uu ON uu.id=m.updated_by LEFT JOIN projects p ON p.id=m.project_id`;

async function checkProject(db: D1Database, user: AuthUser, projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const access = await getProjectAccess(db, projectId);
  if (!access || !canViewProject(user, access)) return "找不到這個專案，或你沒有檢視權限";
  return null;
}

const describe = (row: Pick<MeetingRow, "kind" | "title" | "starts_at">) => `${KIND_LABEL[row.kind]}「${row.title}」（${row.starts_at.replace("T", " ")}）`;

meetingsRoutes.get("/meetings", async (c) => {
  const user = c.get("user");
  const kind = c.req.query("kind");
  if (kind && !KINDS.has(kind as MeetingKind)) return c.json({ error: "種類不正確" }, 422);
  const projectId = c.req.query("project_id");
  const where = [kind ? "m.kind=?" : "", projectId ? "m.project_id=?" : ""].filter(Boolean);
  const result = await c.env.DB.prepare(`${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY m.starts_at DESC, m.created_at DESC LIMIT 2000`)
    .bind(...[kind, projectId].filter(Boolean)).all<ListedRow>();
  return c.json({ meetings: result.results.filter((row) => visibleTo(user, row)).map((row) => present(user, row)) });
});

/** 首頁用：接下來的（最近的先）與剛結束的（最新的先），會議與上課一起列。 */
meetingsRoutes.get("/meetings/overview", async (c) => {
  const user = c.get("user");
  const now = taipeiNow();
  // 多抓一些再依權限篩，篩完仍有 OVERVIEW_LIMIT 筆的機會比較大。
  const fetch = OVERVIEW_LIMIT * 8;
  const [upcoming, recent] = await Promise.all([
    c.env.DB.prepare(`${SELECT} WHERE COALESCE(m.ends_at, m.starts_at) >= ? ORDER BY m.starts_at ASC LIMIT ?`).bind(now, fetch).all<ListedRow>(),
    c.env.DB.prepare(`${SELECT} WHERE COALESCE(m.ends_at, m.starts_at) < ? ORDER BY m.starts_at DESC LIMIT ?`).bind(now, fetch).all<ListedRow>(),
  ]);
  const pick = (rows: ListedRow[]) => rows.filter((row) => visibleTo(user, row)).slice(0, OVERVIEW_LIMIT).map((row) => present(user, row));
  return c.json({ upcoming: pick(upcoming.results), recent: pick(recent.results) });
});

meetingsRoutes.post("/meetings", async (c) => {
  const user = c.get("user");
  const body = await readObject(c.req.raw);
  const kind = body.kind as MeetingKind;
  if (!KINDS.has(kind)) return c.json({ error: "種類不正確" }, 422);
  const cleaned = cleanFields(body, false);
  if ("error" in cleaned) return c.json({ error: cleaned.error }, 422);
  const values = cleaned.values;
  if (values.ends_at && values.ends_at < values.starts_at!) return c.json({ error: "結束時間不能早於開始時間" }, 422);
  const projectError = await checkProject(c.env.DB, user, values.project_id);
  if (projectError) return c.json({ error: projectError }, 422);
  const id = createId(kind === "meeting" ? "meeting" : "course");
  await c.env.DB.prepare(`INSERT INTO meetings (id,kind,title,starts_at,ends_at,location,attendees,organizer,summary,project_id,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, kind, values.title, values.starts_at, values.ends_at ?? null, values.location ?? "", values.attendees ?? "", values.organizer ?? "", values.summary ?? "", values.project_id ?? null, user.id, user.id).run();
  await writeAudit(c.env.DB, user, "create", kind, id, `新增${describe({ kind, title: values.title!, starts_at: values.starts_at! })}`);
  return c.json({ id }, 201);
});

async function loadForChange(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<MeetingRow>();
}

meetingsRoutes.patch("/meetings/:id", async (c) => {
  const user = c.get("user");
  const current = await loadForChange(c.env.DB, c.req.param("id"));
  if (!current) return c.json({ error: "找不到這筆紀錄" }, 404);
  if (user.role !== "admin" && current.created_by !== user.id) return c.json({ error: "只有建立這筆紀錄的人或管理員可以修改" }, 403);
  const cleaned = cleanFields(await readObject(c.req.raw), true);
  if ("error" in cleaned) return c.json({ error: cleaned.error }, 422);
  const changes = Object.entries(cleaned.values) as Array<[keyof typeof LABELS, string | null]>;
  if (!changes.length) return c.json({ ok: true });
  const startsAt = cleaned.values.starts_at ?? current.starts_at;
  const endsAt = "ends_at" in cleaned.values ? cleaned.values.ends_at : current.ends_at;
  if (endsAt && endsAt < startsAt) return c.json({ error: "結束時間不能早於開始時間" }, 422);
  if ("project_id" in cleaned.values && cleaned.values.project_id !== current.project_id) {
    const projectError = await checkProject(c.env.DB, user, cleaned.values.project_id);
    if (projectError) return c.json({ error: projectError }, 422);
  }
  await c.env.DB.prepare(`UPDATE meetings SET ${changes.map(([field]) => `${field}=?`).join(",")},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(...changes.map(([, value]) => value), user.id, current.id).run();
  const after = { kind: current.kind, title: cleaned.values.title ?? current.title, starts_at: startsAt };
  await writeAudit(c.env.DB, user, "update", current.kind, current.id, `更新${describe(after)}：${changes.map(([field]) => LABELS[field]).join("、")}`);
  return c.json({ ok: true });
});

meetingsRoutes.delete("/meetings/:id", async (c) => {
  const user = c.get("user");
  const current = await loadForChange(c.env.DB, c.req.param("id"));
  if (!current) return c.json({ error: "找不到這筆紀錄" }, 404);
  if (user.role !== "admin" && current.created_by !== user.id) return c.json({ error: "只有建立這筆紀錄的人或管理員可以刪除" }, 403);
  await c.env.DB.prepare("DELETE FROM meetings WHERE id=?").bind(current.id).run();
  await writeAudit(c.env.DB, user, "delete", current.kind, current.id, `刪除${describe(current)}`);
  return c.json({ ok: true });
});
