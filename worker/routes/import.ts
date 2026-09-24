import { Hono, type Context } from "hono";
import type { AppContext, AuthUser } from "../types";
import { createId } from "../services/db";
import { ImportValidationError, runImport, type ImportMode, type ImportStats } from "../services/import-data";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** 待審核的匯入整份存在 D1 一列裡；D1 單列上限約 2 MB，留一點餘裕。 */
const MAX_REQUEST_BYTES = 1_500_000;
/** 每人同時可以有幾筆待審核。避免一直重送把管理員的通知洗掉。 */
const MAX_PENDING_PER_USER = 5;

type Ctx = Context<AppContext>;
type Failure = { status: 413 | 422; body: { error: string; issues?: string[] } };

async function readJson(c: Ctx, limit: number): Promise<{ value: unknown } | Failure> {
  const tooLarge = { status: 413 as const, body: { error: `匯入內容不可超過 ${Math.floor(limit / 1024 / 1024 * 10) / 10} MB` } };
  const contentLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > limit) return tooLarge;
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > limit) return tooLarge;
  try { return { value: JSON.parse(raw) }; } catch { return { status: 422, body: { error: "JSON 格式不正確" } }; }
}

const modeOf = (user: AuthUser): ImportMode => user.role === "admin" ? "admin" : "member";

/**
 * 先預演一次，全部通過才真的寫。匯入是一筆一筆寫的，途中遇到錯誤會留下前半段；
 * 預演會跑完同一條路徑但不寫，任何格式、權限問題都在寫第一筆之前擋下。
 */
async function importNow(db: D1Database, actor: AuthUser, payload: unknown, mode: ImportMode): Promise<ImportStats> {
  await runImport(db, actor, payload, { mode, dryRun: true });
  return runImport(db, actor, payload, { mode });
}

async function validate(db: D1Database, actor: AuthUser, payload: unknown, mode: ImportMode): Promise<{ ok: true; summary: ImportStats } | Failure> {
  try {
    return { ok: true, summary: await runImport(db, actor, payload, { mode, dryRun: true }) };
  } catch (error) {
    if (error instanceof ImportValidationError) return { status: 422, body: { error: error.message, issues: error.issues } };
    throw error;
  }
}

const audit = (db: D1Database, userId: string, action: string, id: string, summary: string) =>
  db.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,'import_request',?,?)").bind(createId("audit"), userId, action, id, summary);

/** 一小時內同一人最多記幾筆檢查失敗，避免被重複上傳洗版。 */
const MAX_CHECK_LOGS_PER_HOUR = 30;

/**
 * 檢查沒通過時留下紀錄。檢查主要在使用者的瀏覽器裡做，失敗時伺服器原本什麼都不知道——
 * 有人說「上傳不過」，管理員只能請對方截圖。記下誰、哪個檔案、前幾個錯誤，後台就查得到。
 */
export async function logCheckFailure(db: D1Database, user: AuthUser, sourceName: string, stage: "browser" | "server", messages: string[]): Promise<void> {
  const recent = await db.prepare("SELECT COUNT(*) AS value FROM audit_log WHERE user_id=? AND action='import_check_failed' AND created_at>=datetime('now','-1 hour')").bind(user.id).first<number>("value");
  if ((recent ?? 0) >= MAX_CHECK_LOGS_PER_HOUR) return;
  const lines = messages.slice(0, 8).map((message, index) => `${index + 1}. ${message.slice(0, 200)}`);
  const more = messages.length > 8 ? `\n……另有 ${messages.length - 8} 個問題` : "";
  const summary = `${sourceName || "（未命名檔案）"}｜${stage === "server" ? "系統核對" : "格式檢查"}未通過，${messages.length} 個問題：\n${lines.join("\n")}${more}`;
  await db.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'import_check_failed','import',?,?)")
    .bind(createId("audit"), user.id, createId("chk"), summary.slice(0, 2000)).run();
}

const notify = (db: D1Database, userId: string, title: string, body: string, link: string) =>
  db.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,'import_request',?,?,?)").bind(createId("ntf"), userId, title, body, link);

/** 通知與列表上用的一句話摘要。 */
export function describeImport(stats: Pick<ImportStats, "projects" | "tasks" | "milestones" | "events" | "progress_updates">): string {
  const parts = [
    stats.projects.created && `新增專案 ${stats.projects.created}`,
    stats.projects.updated && `更新專案 ${stats.projects.updated}`,
    stats.tasks.created && `任務 ${stats.tasks.created}`,
    stats.milestones.created && `里程碑 ${stats.milestones.created}`,
    stats.events.created && `歷程事件 ${stats.events.created}`,
    stats.progress_updates.created && `進度紀錄 ${stats.progress_updates.created}`,
  ].filter(Boolean);
  return parts.length ? parts.join("、") : "沒有新內容（全部都已存在）";
}

const parse = (value: string | null) => { try { return value ? JSON.parse(value) as unknown : null; } catch { return null; } };

interface RequestRow {
  id: string; submitted_by: string; status: string; source_name: string; payload_json?: string; summary_json: string;
  review_note: string; reviewed_by: string | null; reviewed_at: string | null; result_json: string | null; created_at: string;
  submitter_name: string; reviewer_name: string | null;
}

const REQUEST_COLUMNS = `r.id,r.submitted_by,r.status,r.source_name,r.summary_json,r.review_note,r.reviewed_by,r.reviewed_at,r.result_json,r.created_at,
  u.name AS submitter_name, rv.name AS reviewer_name`;
const REQUEST_FROM = "FROM import_requests r JOIN users u ON u.id=r.submitted_by LEFT JOIN users rv ON rv.id=r.reviewed_by";

const present = ({ summary_json, result_json, payload_json, ...row }: RequestRow) => ({
  ...row, summary: parse(summary_json), result: parse(result_json),
  ...(payload_json !== undefined ? { payload: parse(payload_json) } : {}),
});

async function submitterOf(db: D1Database, userId: string): Promise<AuthUser | null> {
  return await db.prepare(`SELECT u.id,u.email,u.name,u.role,u.group_id,g.name AS group_name,g.type AS group_type,u.must_change_password
    FROM users u JOIN groups g ON g.id=u.group_id WHERE u.id=? AND u.is_active=1 AND u.approval_status='approved'`).bind(userId).first<AuthUser>();
}

/** 管理頁原本的入口：管理員貼 JSON 直接匯入。`scripts/import-remote.ts` 與文件都指向這裡。 */
export const adminImportRoutes = new Hono<AppContext>();

adminImportRoutes.post("/import", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  const body = await readJson(c, MAX_IMPORT_BYTES);
  if ("status" in body) return c.json(body.body, body.status);
  try {
    const result = await importNow(c.env.DB, user, body.value, "admin");
    await c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'batch_import','system','import',?)")
      .bind(createId("audit"), user.id, JSON.stringify(result)).run();
    return c.json(result);
  } catch (error) {
    if (error instanceof ImportValidationError) return c.json({ error: error.message, issues: error.issues }, 422);
    throw error;
  }
});

/**
 * 所有人都能用的批次匯入。這個 router 掛在 /api 底下，所以不能用 `use("*")` 掛權限
 * 中介層——那會套到整個 /api。每個端點自己檢查。
 */
export const importRoutes = new Hono<AppContext>();

/** 上傳後第一時間檢查：格式、權限、會新增或更新哪些專案。不寫入任何東西。 */
importRoutes.post("/import/validate", async (c) => {
  const user = c.get("user");
  const body = await readJson(c, modeOf(user) === "admin" ? MAX_IMPORT_BYTES : MAX_REQUEST_BYTES);
  if ("status" in body) return c.json(body.body, body.status);
  const wrapper = (body.value ?? {}) as { payload?: unknown; source_name?: unknown };
  const result = await validate(c.env.DB, user, wrapper.payload, modeOf(user));
  if ("status" in result) {
    await logCheckFailure(c.env.DB, user, typeof wrapper.source_name === "string" ? wrapper.source_name.trim().slice(0, 200) : "", "server", result.body.issues ?? [result.body.error]);
    return c.json(result.body, result.status);
  }
  return c.json(result);
});

/** 瀏覽器端的格式檢查沒過時回報這裡；只記紀錄，不做其他事。 */
importRoutes.post("/import/check-failed", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ source_name?: unknown; messages?: unknown }>().catch(() => ({} as { source_name?: unknown; messages?: unknown }));
  const messages = Array.isArray(body.messages) ? body.messages.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
  if (!messages.length) return c.json({ error: "沒有問題可以記錄" }, 422);
  await logCheckFailure(c.env.DB, user, typeof body.source_name === "string" ? body.source_name.trim().slice(0, 200) : "", "browser", messages);
  return c.json({ ok: true });
});

/** 管理員看最近誰的上傳卡在檢查。 */
importRoutes.get("/import/check-failures", async (c) => {
  if (c.get("user").role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  const rows = await c.env.DB.prepare(`SELECT a.id,a.created_at,a.summary,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.action='import_check_failed' AND a.created_at>=datetime('now','-30 days') ORDER BY a.created_at DESC LIMIT 30`).all();
  return c.json({ failures: rows.results });
});

/** 管理員直接匯入；其他人建立待審核申請，管理員核准後才寫入。 */
importRoutes.post("/import", async (c) => {
  const user = c.get("user");
  const mode = modeOf(user);
  const body = await readJson(c, mode === "admin" ? MAX_IMPORT_BYTES : MAX_REQUEST_BYTES);
  if ("status" in body) return c.json(body.body, body.status);
  const wrapper = (body.value ?? {}) as { payload?: unknown; source_name?: unknown };
  const sourceName = typeof wrapper.source_name === "string" ? wrapper.source_name.trim().slice(0, 200) : "";
  const checked = await validate(c.env.DB, user, wrapper.payload, mode);
  if ("status" in checked) {
    await logCheckFailure(c.env.DB, user, sourceName, "server", checked.body.issues ?? [checked.body.error]);
    return c.json(checked.body, checked.status);
  }

  if (mode === "admin") {
    const result = await importNow(c.env.DB, user, wrapper.payload, "admin");
    await c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'batch_import','system','import',?)")
      .bind(createId("audit"), user.id, JSON.stringify({ source: sourceName, ...result })).run();
    return c.json({ status: "applied", result });
  }

  const pending = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM import_requests WHERE submitted_by=? AND status='pending'").bind(user.id).first<number>("value");
  if ((pending ?? 0) >= MAX_PENDING_PER_USER) return c.json({ error: `你已有 ${MAX_PENDING_PER_USER} 筆待審核的匯入，請等管理員處理或先撤回` }, 429);
  const id = createId("imp");
  const describe = describeImport(checked.summary);
  const admins = await c.env.DB.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved'").all<{ id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO import_requests (id,submitted_by,status,source_name,payload_json,summary_json) VALUES (?,?,'pending',?,?,?)")
      .bind(id, user.id, sourceName, JSON.stringify(wrapper.payload), JSON.stringify(checked.summary)),
    audit(c.env.DB, user.id, "import_submitted", id, `${sourceName || "批次匯入"}：${describe}`),
    ...admins.results.map((admin) => notify(c.env.DB, admin.id, `批次匯入待審核：${user.name}`, `${sourceName ? `${sourceName}：` : ""}${describe}`, `/import?request=${id}`)),
  ]);
  return c.json({ status: "pending", id, summary: checked.summary }, 201);
});

importRoutes.get("/import/requests", async (c) => {
  const user = c.get("user");
  const status = c.req.query("status");
  const filters: string[] = [];
  const params: unknown[] = [];
  // 一般使用者只看得到自己的申請；管理員看全部。
  if (user.role !== "admin") { filters.push("r.submitted_by=?"); params.push(user.id); }
  if (status && ["pending", "approved", "rejected", "withdrawn", "failed"].includes(status)) { filters.push("r.status=?"); params.push(status); }
  const rows = await c.env.DB.prepare(`SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY r.created_at DESC LIMIT 100`)
    .bind(...params).all<RequestRow>();
  return c.json({ requests: rows.results.map(present) });
});

importRoutes.get("/import/requests/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT ${REQUEST_COLUMNS},r.payload_json ${REQUEST_FROM} WHERE r.id=?`).bind(c.req.param("id")).first<RequestRow>();
  if (!row || (user.role !== "admin" && row.submitted_by !== user.id)) return c.json({ error: "找不到匯入申請" }, 404);
  const request = present(row);
  if (row.status !== "pending" && row.status !== "failed") return c.json({ request });
  // 從送出到審核之間資料可能變了（專案被刪、權限被改），所以每次打開都以提交者身分重新預演。
  const submitter = await submitterOf(c.env.DB, row.submitted_by);
  if (!submitter) return c.json({ request, check: { ok: false, issues: ["提交者的帳號已停用或未核准"] } });
  const checked = await validate(c.env.DB, submitter, request.payload, "member");
  return c.json({ request, check: "status" in checked ? { ok: false, issues: checked.body.issues ?? [checked.body.error] } : checked });
});

importRoutes.post("/import/requests/:id/approve", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id,submitted_by,status,source_name,payload_json FROM import_requests WHERE id=?").bind(id).first<{ id: string; submitted_by: string; status: string; source_name: string; payload_json: string }>();
  if (!row) return c.json({ error: "找不到匯入申請" }, 404);
  const submitter = await submitterOf(c.env.DB, row.submitted_by);
  if (!submitter) return c.json({ error: "提交者的帳號已停用或未核准，無法以他的身分匯入" }, 409);
  // 先搶下這筆，兩位管理員同時按核准時只有一位會真的執行。沒專案代碼的新專案重跑會建出兩份。
  const claimed = await c.env.DB.prepare("UPDATE import_requests SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')").bind(user.id, id).run();
  if (!claimed.meta?.changes) return c.json({ error: "這筆申請已經處理過了" }, 409);
  const payload = parse(row.payload_json);
  // 以提交者的身分與權限匯入：專案掛他名下、進度紀錄記在他名下，他沒權限動的專案照樣擋下。
  const checked = await validate(c.env.DB, submitter, payload, "member");
  if ("status" in checked) {
    await c.env.DB.prepare("UPDATE import_requests SET status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE id=?").bind(id).run();
    return c.json(checked.body, checked.status);
  }
  let result: ImportStats;
  try {
    result = await runImport(c.env.DB, submitter, payload, { mode: "member" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await c.env.DB.prepare("UPDATE import_requests SET status='failed',review_note=? WHERE id=?").bind(`匯入失敗：${message}`, id).run();
    throw error;
  }
  const describe = describeImport(result);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE import_requests SET result_json=? WHERE id=?").bind(JSON.stringify(result), id),
    audit(c.env.DB, user.id, "import_approved", id, `核准 ${submitter.name} 的匯入：${describe}`),
    notify(c.env.DB, submitter.id, "批次匯入已核准", `${row.source_name ? `${row.source_name}：` : ""}${describe}`, `/import?request=${id}`),
  ]);
  return c.json({ status: "approved", result });
});

importRoutes.post("/import/requests/:id/reject", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({} as { note?: unknown }));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const row = await c.env.DB.prepare("SELECT submitted_by,source_name FROM import_requests WHERE id=?").bind(id).first<{ submitted_by: string; source_name: string }>();
  if (!row) return c.json({ error: "找不到匯入申請" }, 404);
  const updated = await c.env.DB.prepare("UPDATE import_requests SET status='rejected',review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')").bind(note, user.id, id).run();
  if (!updated.meta?.changes) return c.json({ error: "這筆申請已經處理過了" }, 409);
  await c.env.DB.batch([
    audit(c.env.DB, user.id, "import_rejected", id, note || "退回"),
    notify(c.env.DB, row.submitted_by, "批次匯入被退回", `${row.source_name ? `${row.source_name}：` : ""}${note || "管理員未附說明"}`, `/import?request=${id}`),
  ]);
  return c.json({ status: "rejected" });
});

importRoutes.post("/import/requests/:id/withdraw", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const updated = await c.env.DB.prepare("UPDATE import_requests SET status='withdrawn' WHERE id=? AND submitted_by=? AND status='pending'").bind(id, user.id).run();
  if (!updated.meta?.changes) return c.json({ error: "只能撤回自己還在待審核的申請" }, 409);
  await audit(c.env.DB, user.id, "import_withdrawn", id, "撤回").run();
  return c.json({ status: "withdrawn" });
});
