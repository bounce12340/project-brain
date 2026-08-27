/**
 * 把 `imports/` 底下已審閱的 payload 匯入正式 D1。
 *
 * 為什麼不是打 `/api/admin/import`：那條路徑只吃 `sid` session cookie，CI 沒有、
 * 也不該有任何人的密碼。這支腳本改用 CLOUDFLARE_API_TOKEN 直接對 D1 REST API 下
 * 語句，並把同一份 `runAdminImport` 搬過來跑——匯入規則、冪等鍵、fallback 行為
 * 全部與正式站端點共用同一份程式碼，不另外維護一套 SQL。
 *
 * 安全設計：
 * - 只在 workflow_dispatch 手動觸發時執行，且要求輸入確認字串。
 * - 匯入前先驗執行者必須是 active／approved 的 admin。
 * - 匯入前先驗 payload 內所有 Email 都存在，缺了就中止（除非明確允許 fallback），
 *   避免整批資料被改掛管理員並加上「【原負責人：…】」。
 * - 寫入後補一筆 audit_log，與 `/api/admin/import` 端點的行為一致。
 * - 失敗可直接重跑：匯入合約本身是冪等的，重送只會累計 skipped。
 */
import { readFileSync } from "node:fs";
import { runAdminImport, type ImportStats } from "../worker/services/import-data";
import type { AuthUser } from "../worker/types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export interface CliOptions {
  payload: string;
  actorEmail: string;
  allowOwnerFallback: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let allowOwnerFallback = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-owner-fallback") { allowOwnerFallback = true; continue; }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`無法辨識的參數：${arg}`);
    values.set(match[1], match[2] ?? argv[++index] ?? "");
  }
  const payload = values.get("payload")?.trim();
  const actorEmail = values.get("actor")?.trim().toLowerCase();
  if (!payload) throw new Error("缺少 --payload <檔案路徑>");
  if (!actorEmail) throw new Error("缺少 --actor <管理員 Email>");
  return { payload, actorEmail, allowOwnerFallback };
}

/** payload 裡所有會被解析成使用者的 Email 欄位，全部小寫去重。 */
export function collectPayloadEmails(payload: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith("owner_email") || key.endsWith("assignee_email") || key.endsWith("author_email")) {
        if (typeof value === "string" && value.trim()) found.add(value.trim().toLowerCase());
      }
      walk(value);
    }
  };
  walk(payload);
  return [...found].sort();
}

/** D1 REST API 只收 string／number／null；boolean 與 undefined 要先正規化。 */
export function d1Params(values: readonly unknown[]): (string | number | null)[] {
  return values.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" || typeof value === "string") return value;
    return String(value);
  });
}

/** `.first()` 取整列、`.first("col")` 取單欄；沒有資料一律 null。 */
export function firstRowValue(rows: readonly Record<string, unknown>[], column?: string): unknown {
  if (!rows.length) return null;
  return column === undefined ? rows[0] : rows[0][column] ?? null;
}

export function databaseIdFromWranglerConfig(source: string): string {
  const match = /"database_id"\s*:\s*"([0-9a-f-]{36})"/.exec(source);
  if (!match) throw new Error("wrangler.jsonc 找不到 database_id");
  return match[1];
}

interface RemoteDb {
  db: D1Database;
  statementCount: () => number;
}

function createRemoteD1(accountId: string, databaseId: string, token: string): RemoteDb {
  const endpoint = `${CLOUDFLARE_API}/accounts/${accountId}/d1/database/${databaseId}/query`;
  let statements = 0;

  const query = async (sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> => {
    statements += 1;
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sql, params: d1Params(params) }),
      });
      if (response.ok) {
        const body = await response.json() as { success: boolean; result?: { results?: Record<string, unknown>[] }[]; errors?: unknown };
        if (!body.success) throw new Error(`D1 回報失敗：${JSON.stringify(body.errors)}｜SQL：${sql}`);
        return body.result?.[0]?.results ?? [];
      }
      const detail = await response.text();
      if (attempt >= MAX_ATTEMPTS || !RETRY_STATUSES.has(response.status)) {
        throw new Error(`D1 HTTP ${response.status}：${detail}｜SQL：${sql}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  };

  const statement = (sql: string, params: readonly unknown[] = []): D1PreparedStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({ results: await query(sql, params) }),
    first: async (column?: string) => firstRowValue(await query(sql, params), column),
    run: async () => { await query(sql, params); return { success: true }; },
    raw: async () => { throw new Error("未實作 raw()"); },
  } as unknown as D1PreparedStatement);

  const db = {
    prepare: (sql: string) => statement(sql),
    // D1 的 batch 是單一交易；REST API 沒有等價語意，這裡照順序執行。匯入合約本身
    // 冪等，中途失敗重跑即可，不需要 all-or-nothing。
    batch: async (list: D1PreparedStatement[]) => {
      const out = [];
      for (const item of list) out.push(await item.run());
      return out;
    },
  } as unknown as D1Database;

  return { db, statementCount: () => statements };
}

async function resolveActor(db: D1Database, email: string): Promise<AuthUser> {
  const row = await db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.group_id, u.is_active, u.approval_status, g.name AS group_name, g.type AS group_type
    FROM users u JOIN groups g ON g.id = u.group_id WHERE lower(u.email) = ?
  `).bind(email).first<Record<string, unknown>>();
  if (!row) throw new Error(`正式站沒有這個帳號：${email}`);
  if (row.role !== "admin") throw new Error(`${email} 不是管理員（role=${String(row.role)}），無法執行批次匯入`);
  if (Number(row.is_active) !== 1) throw new Error(`${email} 已停用`);
  if (row.approval_status !== "approved") throw new Error(`${email} 尚未核准（approval_status=${String(row.approval_status)}）`);
  return row as unknown as AuthUser;
}

async function missingEmails(db: D1Database, emails: readonly string[]): Promise<string[]> {
  if (!emails.length) return [];
  const rows = await db.prepare(
    `SELECT lower(email) AS email FROM users WHERE is_active=1 AND approval_status='approved' AND lower(email) IN (${emails.map(() => "?").join(",")})`,
  ).bind(...emails).all<{ email: string }>();
  const present = new Set(rows.results.map((row) => row.email));
  return emails.filter((email) => !present.has(email));
}

function summarise(stats: ImportStats): string {
  return [
    `專案 建立 ${stats.projects.created}／更新 ${stats.projects.updated}`,
    `任務 ${stats.tasks.created}／略過 ${stats.tasks.skipped}`,
    `里程碑 ${stats.milestones.created}／略過 ${stats.milestones.skipped}`,
    `歷程 ${stats.events.created}／略過 ${stats.events.skipped}`,
    `進度 ${stats.progress_updates.created}／略過 ${stats.progress_updates.skipped}`,
    `法規 ${stats.reg_entries.created}／略過 ${stats.reg_entries.skipped}`,
  ].join("｜");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error("缺少 CLOUDFLARE_API_TOKEN");
  if (!accountId) throw new Error("缺少 CLOUDFLARE_ACCOUNT_ID");
  const databaseId = databaseIdFromWranglerConfig(readFileSync("wrangler.jsonc", "utf8"));
  const payload = JSON.parse(readFileSync(options.payload, "utf8")) as unknown;

  const remote = createRemoteD1(accountId, databaseId, token);
  const actor = await resolveActor(remote.db, options.actorEmail);
  console.log(`執行者：${actor.name}（${actor.email}）｜資料庫：${databaseId}`);

  const emails = collectPayloadEmails(payload);
  const missing = await missingEmails(remote.db, emails);
  console.log(`payload 參照 ${emails.length} 個 Email，正式站缺 ${missing.length} 個`);
  if (missing.length) {
    console.log(`缺少：${missing.join("、")}`);
    if (!options.allowOwnerFallback) {
      throw new Error("這些 Email 在正式站不存在或未核准，匯入後會全部改掛執行管理員並加上「【原負責人：…】」。請先建立／核准帳號，或加上 --allow-owner-fallback 明確接受 fallback。");
    }
    console.log("已指定 --allow-owner-fallback，繼續匯入。");
  }

  const stats = await runAdminImport(remote.db, actor, payload);
  await remote.db.prepare(
    "INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'batch_import','system','import',?)",
  ).bind(`audit_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`, actor.id, JSON.stringify(stats)).run();

  console.log(summarise(stats));
  if (stats.warnings.length) {
    console.log(`warnings（${stats.warnings.length}）：`);
    for (const warning of stats.warnings) console.log(`  - ${warning}`);
  }
  console.log(`共送出 ${remote.statementCount()} 個語句`);
  console.log(JSON.stringify(stats));
}

// 被 vitest import 時不要執行 main；其餘情況（bundle 後直接 node 執行）都要跑。
if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
