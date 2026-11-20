import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, writeAudit } from "../services/db";
import { isValidEmail, normalizeEmail } from "../services/registration";
import { sendMail } from "../services/mailer";
import {
  COMPANY_STATUS_LABEL,
  generateInviteCode,
  hashInviteCode,
  HOME_COMPANY_ID,
  ISOLATION_STAGES,
  isSystemAdmin,
  tenantIsolationComplete,
  type CompanyStatus,
} from "../services/tenant";

/**
 * 系統管理後台（/api/system）：只有系統管理員能用。建立公司、發邀請、看各公司的帳號與狀態。
 * 公司內的日常管理（核准同仁、組別）仍由各公司自己的管理員在 /api/admin 處理。
 */
export const systemRoutes = new Hono<AppContext>();

systemRoutes.use("*", async (c, next) => {
  if (!isSystemAdmin(c.get("user"))) return c.json({ error: "僅限系統管理員" }, 403);
  return next();
});

interface CompanyRow { id: string; name: string; status: CompanyStatus; created_at: string; users: number; active_users: number; admins: number; pending: number; groups: number }
interface InviteListRow { id: string; company_id: string; role: "admin" | "member"; group_id: string | null; group_name: string | null; note: string; max_uses: number; used_count: number; expires_at: string; revoked_at: string | null; created_at: string; created_by_name: string | null }

const NAME_MAX = 80;
const INVITE_DAYS_DEFAULT = 7;
const INVITE_DAYS_MAX = 30;

function inviteState(invite: Pick<InviteListRow, "revoked_at" | "used_count" | "max_uses" | "expires_at">): "revoked" | "used" | "expired" | "open" {
  if (invite.revoked_at) return "revoked";
  if (invite.used_count >= invite.max_uses) return "used";
  if (invite.expires_at <= new Date().toISOString()) return "expired";
  return "open";
}

const isolation = () => ({ stages: ISOLATION_STAGES, complete: tenantIsolationComplete() });

async function companyRows(db: D1Database, companyId?: string): Promise<CompanyRow[]> {
  const rows = await db.prepare(`SELECT c.id,c.name,c.status,c.created_at,
      (SELECT COUNT(*) FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=c.id) AS users,
      (SELECT COUNT(*) FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=c.id AND u.is_active=1 AND u.approval_status='approved') AS active_users,
      (SELECT COUNT(*) FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=c.id AND u.is_active=1 AND u.approval_status='approved' AND u.role='admin') AS admins,
      (SELECT COUNT(*) FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=c.id AND u.approval_status='pending') AS pending,
      (SELECT COUNT(*) FROM groups g WHERE g.company_id=c.id) AS groups
    FROM companies c ${companyId ? "WHERE c.id=?" : ""} ORDER BY c.id=? DESC, c.created_at`).bind(...(companyId ? [companyId, HOME_COMPANY_ID] : [HOME_COMPANY_ID])).all<CompanyRow>();
  return rows.results.map((row) => ({ ...row, status_label: COMPANY_STATUS_LABEL[row.status], home: row.id === HOME_COMPANY_ID }));
}

systemRoutes.get("/companies", async (c) => c.json({ companies: await companyRows(c.env.DB), isolation: isolation() }));

systemRoutes.post("/companies", async (c) => {
  const body: { name?: unknown } = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > NAME_MAX) return c.json({ error: `請輸入公司名稱（最多 ${NAME_MAX} 字）` }, 422);
  const id = createId("co");
  const user = c.get("user");
  try {
    // 新公司先是「建置中」，並給一個預設組別，邀請進來的人才有組可以放。
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO companies (id,name,status,created_by) VALUES (?,?,'setup',?)").bind(id, name, user.id),
      c.env.DB.prepare("INSERT INTO groups (id,name,type,company_id) VALUES (?,?,'general',?)").bind(createId("grp"), "一般", id),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "已經有同名的公司" }, 422);
    throw error;
  }
  await writeAudit(c.env.DB, user, "company_create", "company", id, `建立公司「${name}」`);
  return c.json({ company: (await companyRows(c.env.DB, id))[0] }, 201);
});

systemRoutes.get("/companies/:id", async (c) => {
  const companyId = c.req.param("id");
  const [company] = await companyRows(c.env.DB, companyId);
  if (!company) return c.json({ error: "找不到公司" }, 404);
  const [users, groups, invites] = await Promise.all([
    c.env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.is_active,u.approval_status,u.created_at,g.name AS group_name
      FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=? ORDER BY CASE u.approval_status WHEN 'pending' THEN 0 ELSE 1 END,u.role='admin' DESC,u.name`).bind(companyId).all(),
    c.env.DB.prepare("SELECT id,name,type FROM groups WHERE company_id=? ORDER BY name").bind(companyId).all(),
    c.env.DB.prepare(`SELECT i.id,i.company_id,i.role,i.group_id,g.name AS group_name,i.note,i.max_uses,i.used_count,i.expires_at,i.revoked_at,i.created_at,u.name AS created_by_name
      FROM company_invites i LEFT JOIN groups g ON g.id=i.group_id LEFT JOIN users u ON u.id=i.created_by WHERE i.company_id=? ORDER BY i.created_at DESC LIMIT 50`).bind(companyId).all<InviteListRow>(),
  ]);
  return c.json({
    company, users: users.results, groups: groups.results,
    invites: invites.results.map((invite) => ({ ...invite, state: inviteState(invite) })),
    isolation: isolation(),
  });
});

systemRoutes.patch("/companies/:id", async (c) => {
  const companyId = c.req.param("id");
  const body: { name?: unknown; status?: unknown } = await c.req.json().catch(() => ({}));
  const [company] = await companyRows(c.env.DB, companyId);
  if (!company) return c.json({ error: "找不到公司" }, 404);
  const name = typeof body.name === "string" ? body.name.trim() : company.name;
  if (!name || [...name].length > NAME_MAX) return c.json({ error: `公司名稱最多 ${NAME_MAX} 字` }, 422);
  const status = body.status === undefined ? company.status : body.status;
  if (!["setup", "active", "suspended"].includes(status as string)) return c.json({ error: "狀態只能是建置中、使用中或已停用" }, 422);
  if (companyId === HOME_COMPANY_ID && status !== "active") return c.json({ error: "原本的公司不能停用" }, 422);
  // 資料隔離還沒全部完成前，開通別家公司會讓它看到還沒隔離的資料。
  if (status === "active" && company.status !== "active" && !tenantIsolationComplete()) {
    return c.json({ error: "多公司資料隔離還沒全部完成，暫時不能開通其他公司", isolation: isolation() }, 409);
  }
  try {
    await c.env.DB.prepare("UPDATE companies SET name=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, status, companyId).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "已經有同名的公司" }, 422);
    throw error;
  }
  // 停用時立刻登出那家公司的所有人。
  if (status === "suspended") await c.env.DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN groups g ON g.id=u.group_id WHERE g.company_id=?)").bind(companyId).run();
  await writeAudit(c.env.DB, c.get("user"), "company_update", "company", companyId, `公司「${name}」：${COMPANY_STATUS_LABEL[status as CompanyStatus]}`);
  return c.json({ company: (await companyRows(c.env.DB, companyId))[0] });
});

systemRoutes.post("/companies/:id/invites", async (c) => {
  const companyId = c.req.param("id");
  const body: { role?: unknown; note?: unknown; max_uses?: unknown; expires_days?: unknown; group_id?: unknown; email?: unknown } = await c.req.json().catch(() => ({}));
  const [company] = await companyRows(c.env.DB, companyId);
  if (!company) return c.json({ error: "找不到公司" }, 404);
  if (company.status === "suspended") return c.json({ error: "已停用的公司不能發邀請" }, 422);
  const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
  if (!role) return c.json({ error: "請選擇邀請成為管理員或一般成員" }, 422);
  const maxUses = body.max_uses === undefined ? 1 : Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > (role === "admin" ? 5 : 500)) return c.json({ error: role === "admin" ? "管理員邀請最多 5 人次" : "使用次數須為 1 到 500" }, 422);
  const days = body.expires_days === undefined ? INVITE_DAYS_DEFAULT : Number(body.expires_days);
  if (!Number.isInteger(days) || days < 1 || days > INVITE_DAYS_MAX) return c.json({ error: `有效天數須為 1 到 ${INVITE_DAYS_MAX} 天` }, 422);
  const groupId = typeof body.group_id === "string" && body.group_id ? body.group_id : null;
  if (groupId && !(await c.env.DB.prepare("SELECT 1 FROM groups WHERE id=? AND company_id=?").bind(groupId, companyId).first())) return c.json({ error: "所選組別不屬於這家公司" }, 422);
  const email = typeof body.email === "string" && body.email.trim() ? normalizeEmail(body.email) : null;
  if (email && !isValidEmail(email)) return c.json({ error: "Email 格式不正確" }, 422);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : (email ?? "");

  const code = generateInviteCode();
  const id = createId("inv");
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO company_invites (id,company_id,code_hash,role,group_id,note,max_uses,expires_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, companyId, await hashInviteCode(code), role, groupId, note || (email ?? ""), maxUses, expiresAt, c.get("user").id).run();
  const url = `${new URL(c.env.APP_BASE_URL).origin}/register?invite=${code}`;
  await writeAudit(c.env.DB, c.get("user"), "invite_create", "company", companyId, `發出「${company.name}」的${role === "admin" ? "管理員" : "成員"}邀請${email ? `給 ${email}` : ""}`);

  let emailSent = false;
  if (email) {
    const roleText = role === "admin" ? "管理員" : "成員";
    try {
      emailSent = (await sendMail(c.env, email, `[艾爾水晶] 邀請你加入「${company.name}」`,
        `您好：\n\n${c.get("user").name} 邀請你以${roleText}身分加入「${company.name}」的艾爾水晶專案進度系統。\n\n請在 ${days} 天內開啟下面的連結註冊：\n${url}\n\n邀請碼：${code}\n\n如果你不認識邀請人，請忽略這封信。`)).sent;
    } catch (error) {
      console.error(JSON.stringify({ message: "invite email failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  // 邀請碼只在這裡出現一次，資料庫只存雜湊。
  return c.json({ invite: { id, role, max_uses: maxUses, expires_at: expiresAt, code, url }, email_sent: emailSent }, 201);
});

systemRoutes.post("/invites/:id/revoke", async (c) => {
  const invite = await c.env.DB.prepare("SELECT i.id,i.company_id,c.name AS company_name FROM company_invites i JOIN companies c ON c.id=i.company_id WHERE i.id=?").bind(c.req.param("id")).first<{ id: string; company_id: string; company_name: string }>();
  if (!invite) return c.json({ error: "找不到邀請" }, 404);
  await c.env.DB.prepare("UPDATE company_invites SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL").bind(invite.id).run();
  await writeAudit(c.env.DB, c.get("user"), "invite_revoke", "company", invite.company_id, `撤銷「${invite.company_name}」的一個邀請`);
  return c.json({ ok: true });
});
