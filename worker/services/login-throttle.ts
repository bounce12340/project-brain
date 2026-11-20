import { sha256 } from "./crypto";

/**
 * 登入失敗節流。
 *
 * 為什麼不是「帳號」單一維度：知道 Email 的人只要故意輸錯 5 次就能讓本人一直被鎖，
 * 所以主要的鎖改綁 (帳號, IP)：攻擊者只鎖得到自己那個 IP。
 * - pair：同一帳號＋同一 IP 5 次失敗 → 鎖 15 分鐘。
 * - ip：同一 IP 跨所有帳號 1 小時 30 次失敗 → 鎖 1 小時（擋撞庫）。
 * - account：同一帳號跨所有 IP 一天 100 次失敗 → 鎖 1 小時。
 *   這是取捨：分散式攻擊仍可能讓本人暫時登不進去，但門檻高到單一攻擊者幾乎做不到，
 *   換來的是分散式猜密碼也有上限。
 * 不管帳號存不存在都一樣計數、一樣回應，避免被拿來查帳號。
 */
type Kind = "pair" | "ip" | "account";
const RULES: Record<Kind, { limit: number; windowMs: number; lockMs: number }> = {
  pair: { limit: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  ip: { limit: 30, windowMs: 60 * 60_000, lockMs: 60 * 60_000 },
  account: { limit: 100, windowMs: 24 * 60 * 60_000, lockMs: 60 * 60_000 },
};

export const LOGIN_THROTTLED_MESSAGE = "登入嘗試次數過多，請稍後再試";

interface Keys { pair: string; ip: string; account: string; accountHash: string }

async function keysFor(email: string, ip: string): Promise<Keys> {
  const accountHash = await sha256(email);
  return { accountHash, pair: await sha256(`pair|${email}|${ip}`), ip: await sha256(`ip|${ip}`), account: await sha256(`account|${email}`) };
}

/** 任一組目前被鎖就回 true。 */
export async function isLoginThrottled(db: D1Database, email: string, ip: string): Promise<boolean> {
  const keys = await keysFor(email, ip);
  const { results } = await db.prepare("SELECT locked_until FROM login_throttle WHERE key_hash IN (?,?,?) AND locked_until > ?")
    .bind(keys.pair, keys.ip, keys.account, new Date().toISOString()).all();
  return results.length > 0;
}

/** 記一次失敗（三組都記，帳號不存在也記）。 */
export async function recordLoginFailure(db: D1Database, email: string, ip: string): Promise<void> {
  const keys = await keysFor(email, ip);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  for (const kind of ["pair", "ip", "account"] as const) {
    const rule = RULES[kind];
    const row = await db.prepare("SELECT count, window_start FROM login_throttle WHERE key_hash=?").bind(keys[kind]).first<{ count: number; window_start: string }>();
    const fresh = !row || new Date(row.window_start).getTime() + rule.windowMs <= now;
    const count = fresh ? 1 : row.count + 1;
    const locked = count >= rule.limit;
    await db.prepare(`INSERT INTO login_throttle (key_hash,kind,account_hash,count,window_start,locked_until,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(key_hash) DO UPDATE SET count=excluded.count,window_start=excluded.window_start,locked_until=excluded.locked_until,updated_at=excluded.updated_at`)
      .bind(keys[kind], kind, keys.accountHash, locked ? 0 : count, fresh || locked ? nowIso : row.window_start,
        locked ? new Date(now + rule.lockMs).toISOString() : null, nowIso).run();
  }
  // 順手清掉過期很久的紀錄，避免亂填 Email 把表撐大。
  await db.prepare("DELETE FROM login_throttle WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)")
    .bind(new Date(now - 2 * 86_400_000).toISOString(), nowIso).run();
}

/** 登入成功：只清 (帳號, IP) 這組；IP 與帳號的總量不因成功而歸零，否則撞庫者拿自己的帳號登入就能洗掉計數。 */
export async function clearLoginPair(db: D1Database, email: string, ip: string): Promise<void> {
  const keys = await keysFor(email, ip);
  await db.prepare("DELETE FROM login_throttle WHERE key_hash=?").bind(keys.pair).run();
}

/** 密碼被重設：該帳號所有 IP 的鎖定一併解除。 */
export async function clearLoginThrottleForAccount(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_throttle WHERE account_hash=? AND kind IN ('pair','account')").bind(await sha256(email)).run();
}
