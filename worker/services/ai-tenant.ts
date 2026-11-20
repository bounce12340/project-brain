import { taipeiDate } from "./time";

/**
 * AI 功能的公司範圍。AI 連接器（MCP）與站內 AI 小幫手取資料的方式有兩種：
 * 走網站自己的 /api（路由本身會依公司過濾），或在這裡直接查詢。直接查詢一律用這裡的函式
 * 加上同公司條件，不靠呼叫端記得——專案屬於哪家公司看 groups.company_id（projects.group_id），
 * 帳號屬於哪家公司看 users.group_id → groups.company_id。
 */

/** 專案是否屬於這家公司（與工作區共用同一個檢查）。不存在與屬於別家公司回一樣的結果。 */
export { projectInCompany } from "./workspace-scope";

/** 這家公司的組別 id（專案的 group_id 在裡面才算這家公司的專案）。 */
export async function companyGroupIds(db: D1Database, companyId: string): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT id FROM groups WHERE company_id=?").bind(companyId).all<{ id: string }>()).results;
  return new Set(rows.map((row) => row.id));
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
