import type { AuthUser } from "../types";
import { HOME_COMPANY_ID } from "./tenant";
import { taipeiDate } from "./time";

/**
 * AI 功能的公司範圍。AI 連接器（MCP）與站內 AI 小幫手取資料的方式有兩種：
 * 走網站自己的 /api（路由本身會依公司過濾），或在這裡直接查詢。直接查詢一律用這裡的函式
 * 加上同公司條件，不靠呼叫端記得——專案屬於哪家公司看 groups.company_id（projects.group_id），
 * 帳號屬於哪家公司看 users.group_id → groups.company_id。
 */

/** 專案是否屬於這家公司。不存在與屬於別家公司回一樣的結果，不洩漏專案是否存在。 */
export async function projectInCompany(db: D1Database, projectId: string, companyId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM projects p JOIN groups g ON g.id=p.group_id WHERE p.id=? AND g.company_id=?").bind(projectId, companyId).first());
}

/** 這家公司的組別 id（專案的 group_id 在裡面才算這家公司的專案）。 */
export async function companyGroupIds(db: D1Database, companyId: string): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT id FROM groups WHERE company_id=?").bind(companyId).all<{ id: string }>()).results;
  return new Set(rows.map((row) => row.id));
}

/** 帳號 id → 公司 id，用來判斷「這筆是不是我們公司的人建立的」。 */
async function userCompanies(db: D1Database): Promise<Map<string, string>> {
  const rows = (await db.prepare("SELECT u.id,g.company_id FROM users u JOIN groups g ON g.id=u.group_id").all<{ id: string; company_id: string }>()).results;
  return new Map(rows.map((row) => [row.id, row.company_id]));
}

/**
 * 只留下同公司的資料列（依建立者判斷）。建立者是別家公司的人就排除；
 * 沒有建立者（系統匯入、帳號已刪除）的資料目前都屬於原本的公司，其他公司看不到。
 * 這是路由自己依公司過濾之外的第二道防線。
 */
export async function onlyOwnCompany<T extends { created_by?: unknown }>(db: D1Database, user: Pick<AuthUser, "company_id">, rows: T[]): Promise<T[]> {
  const companies = await userCompanies(db);
  return rows.filter((row) => {
    const owner = typeof row.created_by === "string" ? companies.get(row.created_by) : undefined;
    return owner ? owner === user.company_id : user.company_id === HOME_COMPANY_ID;
  });
}

/** 同公司、啟用中的帳號 id。 */
export async function activeUserIdsInCompany(db: D1Database, companyId: string): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT u.id FROM users u JOIN groups g ON g.id=u.group_id WHERE u.is_active=1 AND g.company_id=?").bind(companyId).all<{ id: string }>()).results;
  return new Set(rows.map((row) => row.id));
}

/** 公司今天的 AI 呼叫次數用完時丟出；訊息直接給使用者看。 */
export class AiQuotaError extends Error {}

export const DEFAULT_AI_DAILY_CAP = 5_000;

export function aiDailyCap(env: Env): number {
  const raw = Number((env as unknown as Record<string, unknown>).AI_DAILY_CALL_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_AI_DAILY_CAP;
}

/**
 * 記一次語言模型呼叫並檢查公司的每日上限（台北時間的一天）。一句 SQL 同時完成累加與檢查：
 * 已達上限時 upsert 不更新、沒有回傳列，就丟 AiQuotaError。
 */
export async function chargeAiCall(env: Env, companyId: string): Promise<void> {
  const cap = aiDailyCap(env);
  const row = await env.DB.prepare(`INSERT INTO ai_usage (company_id,day,calls) VALUES (?,?,1)
    ON CONFLICT(company_id,day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls`).bind(companyId, taipeiDate(), cap).first<{ calls: number }>();
  if (!row) throw new AiQuotaError(`貴公司今天的 AI 使用次數已達上限（${cap} 次），請明天再試，或聯絡系統管理員調整上限。`);
}
