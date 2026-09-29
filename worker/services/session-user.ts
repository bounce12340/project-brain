import type { AuthUser } from "../types";
import { sha256 } from "./crypto";

const USER_COLUMNS = `u.id, u.email, u.name, u.role, u.group_id, g.name AS group_name, g.type AS group_type,
  u.must_change_password, u.email_notifications, u.onboarding_done, u.approval_status`;

/** 用登入 cookie 的 token 找出使用者；過期、停用或尚未核准的都當作沒登入。 */
export async function findSessionUser(db: D1Database, token: string): Promise<AuthUser | null> {
  return db.prepare(`SELECT ${USER_COLUMNS}
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN groups g ON g.id = u.group_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1 AND u.approval_status = 'approved'`)
    .bind(await sha256(token)).first<AuthUser>();
}

/**
 * 依使用者 id 載入目前的帳號狀態。AI 連接器的 token 裡只記 userId，每次呼叫都重新查，
 * 帳號被停用或改了組別，下一次呼叫就生效，不必等 token 過期。
 */
export async function loadActiveUser(db: D1Database, userId: string): Promise<AuthUser | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u JOIN groups g ON g.id = u.group_id
    WHERE u.id = ? AND u.is_active = 1 AND u.approval_status = 'approved'`).bind(userId).first<AuthUser>();
}
