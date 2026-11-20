import { HOME_COMPANY_ID } from "./tenant";

/**
 * 共用工作區（聯絡人、會議、待辦、匯入）的公司範圍檢查。
 * 專案的公司 = 專案所屬組別的公司（groups.company_id）。
 */

/** 專案是否屬於這家公司。 */
export async function projectInCompany(db: D1Database, projectId: string, companyId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM projects p JOIN groups g ON g.id=p.group_id WHERE p.id=? AND g.company_id=?").bind(projectId, companyId).first());
}

/** 帳號所屬公司；沒帶 company_id 的舊式呼叫端（例如匯入腳本）從組別查，查不到當作原公司。 */
export async function companyOfActor(db: D1Database, actor: { company_id?: string | null; group_id: string }): Promise<string> {
  if (actor.company_id) return actor.company_id;
  return await db.prepare("SELECT company_id FROM groups WHERE id=?").bind(actor.group_id).first<string>("company_id") ?? HOME_COMPANY_ID;
}

/** 帳號是否和專案同一家公司（自動化規則、通知、指派的對象檢查）。 */
export async function userInProjectCompany(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 AS found FROM users u JOIN groups gu ON gu.id=u.group_id
    JOIN projects p ON p.id=? JOIN groups gp ON gp.id=p.group_id WHERE u.id=? AND gu.company_id=gp.company_id`).bind(projectId, userId).first());
}
