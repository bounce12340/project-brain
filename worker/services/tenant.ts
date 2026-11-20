import type { AuthUser } from "../types";
import { sha256 } from "./crypto";

/**
 * 多公司（多租戶）。每個帳號經由所屬組別屬於一家公司（groups.company_id）。
 *
 * 公司範圍的資料一律在伺服器端用這裡的函式檢查，不靠前端隱藏：
 * 管理員只管得到自己公司的帳號、組別與註冊申請；系統管理員（users.is_system_admin）另外可以
 * 建立公司、發邀請。
 *
 * 資料隔離分階段完成（見 ISOLATION_STAGES）。全部完成前，新公司停在「建置中」，帳號不能登入，
 * 所以還沒隔離的資料不會被其他公司看到。
 */

/** 系統原本就屬於的公司。尚未分公司的共用功能（例如 TFDA 法規抓取）暫時歸它。 */
export const HOME_COMPANY_ID = "co_uic";

export type CompanyStatus = "setup" | "active" | "suspended";

/** 多公司資料隔離的進度。每完成一個階段就把它改成 true；全部 true 才能開通其他公司。 */
export const ISOLATION_STAGES = {
  accounts: true, // 第 1 階段：帳號、組別、註冊申請、管理員權限
  projects: true, // 第 2 階段：專案、看板、任務、里程碑、進度、檔案
  workspace: true, // 第 3 階段：聯絡人、會議、待辦、通知、匯入匯出、搜尋
  regulatory: true, // 第 4 階段：法規動態、報表、AI 風險分析、排程
  ai: false, // 第 5 階段：AI 連接器（MCP）、站內 AI 小幫手
} as const;

export const tenantIsolationComplete = () => Object.values(ISOLATION_STAGES).every(Boolean);

export const COMPANY_STATUS_LABEL: Record<CompanyStatus, string> = { setup: "建置中", active: "使用中", suspended: "已停用" };

/** 登入時依公司狀態回的訊息；使用中回 null。 */
export function companyLoginError(status: CompanyStatus, name: string): string | null {
  if (status === "active") return null;
  if (status === "setup") return `「${name}」的帳號還在建置中，開通後就能登入。`;
  return `「${name}」的帳號已停用，請聯絡系統管理員。`;
}

/** 組別是否屬於這家公司。 */
export async function groupInCompany(db: D1Database, groupId: string, companyId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM groups WHERE id=? AND company_id=?").bind(groupId, companyId).first());
}

/** 帳號是否和登入者同一家公司（停用的帳號也算，用來管理）。 */
export async function userInCompany(db: D1Database, userId: string, companyId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM users u JOIN groups g ON g.id=u.group_id WHERE u.id=? AND g.company_id=?").bind(userId, companyId).first());
}

/** 同公司、啟用中的帳號（負責人、通知對象等下拉選單用）。 */
export async function activeUserInCompany(db: D1Database, userId: string, companyId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM users u JOIN groups g ON g.id=u.group_id WHERE u.id=? AND u.is_active=1 AND g.company_id=?").bind(userId, companyId).first());
}

export const isSystemAdmin = (user: Pick<AuthUser, "is_system_admin">) => user.is_system_admin === 1;

/** 邀請碼：給人看的是 12 碼英數（去掉容易混淆的字），資料庫只存雜湊。 */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
}

export const normalizeInviteCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const hashInviteCode = (code: string) => sha256(`invite:${normalizeInviteCode(code)}`);

export interface InviteRow {
  id: string;
  company_id: string;
  company_name: string;
  company_status: CompanyStatus;
  role: "admin" | "member";
  group_id: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string;
  revoked_at: string | null;
}

/** 找出還能用的邀請碼：沒撤銷、沒過期、還有名額。 */
export async function findUsableInvite(db: D1Database, code: string): Promise<InviteRow | null> {
  if (!normalizeInviteCode(code)) return null;
  const invite = await db.prepare(`SELECT i.id,i.company_id,c.name AS company_name,c.status AS company_status,i.role,i.group_id,i.max_uses,i.used_count,i.expires_at,i.revoked_at
    FROM company_invites i JOIN companies c ON c.id=i.company_id WHERE i.code_hash=?`).bind(await hashInviteCode(code)).first<InviteRow>();
  if (!invite || invite.revoked_at || invite.used_count >= invite.max_uses || invite.expires_at <= new Date().toISOString() || invite.company_status === "suspended") return null;
  return invite;
}
