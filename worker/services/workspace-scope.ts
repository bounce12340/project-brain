import { HOME_COMPANY_ID } from "./tenant";
import type { AuthUser, ProjectAccess } from "../types";
import { canViewProject } from "./permissions";

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

/**
 * 另一個帳號（啟用中）看不看得到這個專案：自動化規則要通知、指派、建待辦給某人時用，
 * 免得把私人專案的名稱與內容推給打不開它的人。
 */
export async function activeUserCanViewProject(db: D1Database, userId: string, access: ProjectAccess): Promise<boolean> {
  const target = await db.prepare("SELECT u.id,u.role,u.group_id,g.company_id FROM users u JOIN groups g ON g.id=u.group_id WHERE u.id=? AND u.is_active=1").bind(userId).first<Pick<AuthUser, "id" | "role" | "group_id" | "company_id">>();
  return Boolean(target) && canViewProject(target as AuthUser, access);
}
