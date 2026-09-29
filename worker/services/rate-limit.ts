import { sha256 } from "./crypto";
import { taipeiDate } from "./time";

/** 呼叫端的 IP（Cloudflare 會帶 CF-Connecting-IP）。 */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * 不用登入就能呼叫的端點（忘記密碼、重設密碼）的每日次數限制，依 IP 雜湊與台北日期計數。
 * 回傳這次是否還在限制內；超過時這次不算數以外的動作都不要做。
 */
export async function consumeDailyLimit(db: D1Database, action: string, key: string, limit: number): Promise<boolean> {
  const row = await db.prepare(`
    INSERT INTO rate_limits (action,key_hash,window_date,count) VALUES (?,?,?,1)
    ON CONFLICT(action,key_hash,window_date) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP
    RETURNING count
  `).bind(action, await sha256(key), taipeiDate()).first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}
