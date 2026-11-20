import { Hono, type Context } from "hono";
import type { AppContext } from "../types";
import { hashPassword, sha256 } from "../services/crypto";
import { createId } from "../services/db";
import { sendMail } from "../services/mailer";
import { sendNotificationMail } from "../services/notification-mail";
import {
  generateOtp,
  hashOtp,
  isValidEmail,
  normalizeEmail,
  rateLimitResult,
  validateOtp,
  validateRegistrationInput,
  type RegistrationInput,
  type VerificationRecord,
} from "../services/registration";
import { findUsableInvite, HOME_COMPANY_ID, type InviteRow } from "../services/tenant";

export const registerRoutes = new Hono<AppContext>();

const SEND_CODE_DAILY_LIMIT = 10;
const SUBMIT_DAILY_LIMIT = 20;

function taipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function registrationEnabled(db: D1Database): Promise<boolean> {
  const value = await db.prepare("SELECT value FROM app_settings WHERE key='registration_enabled'").first<string>("value");
  return value === "1";
}

async function consumeIpLimit(c: Context<AppContext>, action: "send_code" | "submit", limit: number): Promise<boolean> {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const row = await c.env.DB.prepare(`
    INSERT INTO registration_rate_limits (action,ip_hash,window_date,count)
    VALUES (?,?,?,1)
    ON CONFLICT(action,ip_hash,window_date) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP
    RETURNING count
  `).bind(action, await sha256(ip), taipeiDate()).first<{ count: number }>();
  const count = row?.count ?? limit + 1;
  return rateLimitResult(count - 1, limit).allowed;
}

/**
 * 註冊分兩種：
 * - 沒有邀請碼：公開註冊，進到原本的公司，要管理員開放註冊並核准。
 * - 有邀請碼：進到發邀請的那家公司，不受公開註冊開關限制。管理員邀請直接成為那家公司的管理員；
 *   一般邀請仍要該公司的管理員核准。
 */
const inviteOf = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 64) : "";

/** 註冊時可選的組別：邀請指定了組別就只有那一組，否則是那家公司的所有組別。 */
async function registrationGroups(db: D1Database, invite: InviteRow | null) {
  if (invite?.group_id) return (await db.prepare("SELECT id,name FROM groups WHERE id=? AND company_id=?").bind(invite.group_id, invite.company_id).all<{ id: string; name: string }>()).results;
  return (await db.prepare("SELECT id,name FROM groups WHERE company_id=? ORDER BY name").bind(invite?.company_id ?? HOME_COMPANY_ID).all<{ id: string; name: string }>()).results;
}

const SEND_CODE_MESSAGE = "驗證碼已寄出，15 分鐘內有效";
const INVALID_CODE = "驗證碼無效，請重新取得";
const INVALID_INVITE = "邀請碼無效、已過期或已用完，請向邀請你的人索取新的邀請碼";

registerRoutes.get("/meta", async (c) => {
  const code = inviteOf(c.req.query("invite"));
  if (code) {
    const invite = await findUsableInvite(c.env.DB, code);
    if (!invite) return c.json({ enabled: false, groups: [], invite_error: INVALID_INVITE });
    return c.json({ enabled: true, groups: await registrationGroups(c.env.DB, invite), invite: { company: invite.company_name, role: invite.role } });
  }
  const [enabled, groups] = await Promise.all([registrationEnabled(c.env.DB), registrationGroups(c.env.DB, null)]);
  return c.json({ enabled, groups });
});

registerRoutes.post("/send-code", async (c) => {
  if (!(await consumeIpLimit(c, "send_code", SEND_CODE_DAILY_LIMIT))) return c.json({ error: "今日取得驗證碼次數已達上限" }, 429);
  const body: { email?: string; invite?: unknown } = await c.req.json().catch(() => ({}));
  const inviteCode = inviteOf(body.invite);
  if (inviteCode ? !(await findUsableInvite(c.env.DB, inviteCode)) : !(await registrationEnabled(c.env.DB))) return c.json({ error: inviteCode ? INVALID_INVITE : "目前未開放自助註冊" }, 422);
  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) return c.json({ error: "請輸入有效的 Email" }, 422);
  const existing = await c.env.DB.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(email).first();
  // 已註冊的 Email 走一樣的流程：同樣的 60 秒冷卻、同樣寄一封信（改成「此 Email 已有帳號」的通知）、同樣的回應，
  // 否則連打兩次（新 Email 第二次會 429）就能分辨誰有帳號。冷卻紀錄用另一個 purpose，
  // 不會被 /submit 當成驗證碼（它只讀 purpose='register'）。
  const purpose = existing ? "register_existing" : "register";
  const recent = await c.env.DB.prepare("SELECT 1 AS found FROM email_verifications WHERE email=? AND purpose=? AND created_at > datetime('now','-60 seconds') ORDER BY created_at DESC LIMIT 1").bind(email, purpose).first();
  if (recent) return c.json({ error: "請於 60 秒後再取得驗證碼" }, 429);

  const code = generateOtp();
  const id = createId("verify");
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  await c.env.DB.prepare("INSERT INTO email_verifications (id,email,code_hash,purpose,expires_at) VALUES (?,?,?,?,?)")
    .bind(id, email, await hashOtp(code), purpose, expiresAt).run();
  try {
    const text = existing
      ? `有人用這個 Email 在艾爾水晶申請註冊，但這個 Email 已經有帳號了。\n\n如果是你本人，請直接登入：${new URL(c.env.APP_BASE_URL).origin}/login\n忘記密碼可以在登入頁使用「忘記密碼」重設。\n\n如果不是你本人，請忽略這封信，你的帳號不會有任何變動。`
      : `您的註冊驗證碼是：${code}\n\n驗證碼 15 分鐘內有效，請勿轉交他人。`;
    const mail = await sendMail(c.env, email, existing ? "[艾爾水晶] 此 Email 已有帳號" : "[艾爾水晶] 註冊驗證碼", text);
    if (!mail.sent) throw new Error("寄信服務未設定");
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM email_verifications WHERE id=?").bind(id).run();
    console.error(JSON.stringify({ message: "registration OTP email failed", error: error instanceof Error ? error.message : "unknown" }));
    return c.json({ error: "驗證碼寄送失敗，請稍後再試" }, 503);
  }
  return c.json({ ok: true, message: SEND_CODE_MESSAGE });
});

registerRoutes.post("/submit", async (c) => {
  if (!(await consumeIpLimit(c, "submit", SUBMIT_DAILY_LIMIT))) return c.json({ error: "今日註冊嘗試次數已達上限" }, 429);
  const body: RegistrationInput & { invite?: unknown } = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email ?? "");
  const code = inviteOf(body.invite);
  const invite = code ? await findUsableInvite(c.env.DB, code) : null;
  if (code && !invite) return c.json({ error: INVALID_INVITE }, 422);
  const companyId = invite?.company_id ?? HOME_COMPANY_ID;
  const [enabled, existing, groups] = await Promise.all([
    invite ? Promise.resolve(true) : registrationEnabled(c.env.DB),
    c.env.DB.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(email).first(),
    registrationGroups(c.env.DB, invite),
  ]);
  // 組別只能選邀請（或原本的公司）允許的那些，不能用改過的 group_id 跳到別家公司。
  const group = groups.find((item) => item.id === body.group_id?.trim()) ?? null;
  const validation = validateRegistrationInput(body, { enabled, emailExists: false, groupExists: Boolean(group) });
  if (!validation.ok) return c.json({ error: validation.error }, validation.status);
  // 已註冊的 Email 不會有驗證碼（send-code 不寄），用跟「驗證碼無效」一樣的訊息擋下，不洩漏帳號存在。
  if (existing) return c.json({ error: INVALID_CODE }, 422);

  const verification = await c.env.DB.prepare(`
    SELECT id,code_hash,expires_at,attempts,verified FROM email_verifications
    WHERE email=? AND purpose='register' ORDER BY created_at DESC LIMIT 1
  `).bind(validation.value.email).first<VerificationRecord & { id: string }>();
  const otp = validateOtp(verification, await hashOtp(validation.value.code));
  if (!otp.ok) {
    if (otp.incrementAttempts && verification) {
      await c.env.DB.prepare("UPDATE email_verifications SET attempts=attempts+1 WHERE id=?").bind(verification.id).run();
    }
    return c.json({ error: otp.error ?? "驗證碼無效" }, 422);
  }

  // 先佔用邀請名額（條件式更新，兩個人同時用最後一個名額時只有一個會成功）。
  if (invite) {
    const claimed = await c.env.DB.prepare("UPDATE company_invites SET used_count=used_count+1 WHERE id=? AND used_count<max_uses AND revoked_at IS NULL AND expires_at>?")
      .bind(invite.id, new Date().toISOString()).run();
    if (!claimed.meta.changes) return c.json({ error: INVALID_INVITE }, 422);
  }
  const releaseInvite = () => invite ? c.env.DB.prepare("UPDATE company_invites SET used_count=used_count-1 WHERE id=? AND used_count>0").bind(invite.id).run() : Promise.resolve(null);

  // 管理員邀請：直接成為那家公司的管理員，不用等核准（公司開通前仍不能登入）。
  const directAdmin = invite?.role === "admin";
  const userId = createId("usr");
  const admins = directAdmin ? { results: [] } : await c.env.DB.prepare(`SELECT u.id,u.email,u.name,u.email_notifications FROM users u JOIN groups g ON g.id=u.group_id
    WHERE u.role='admin' AND u.is_active=1 AND u.approval_status='approved' AND g.company_id=?`).bind(companyId).all<{ id: string; email: string; name: string; email_notifications: number }>();
  const noticeTitle = `新註冊申請：${validation.value.name}`;
  const noticeBody = `${validation.value.email}／${group!.name}`;
  const statements = [
    c.env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,onboarding_done,approval_status) VALUES (?,?,?,?,?,?,0,0,?)")
      .bind(userId, validation.value.email, validation.value.name, await hashPassword(validation.value.password), directAdmin ? "admin" : "member", group!.id, directAdmin ? "approved" : "pending"),
    c.env.DB.prepare("UPDATE email_verifications SET verified=1 WHERE id=? AND verified=0").bind(verification!.id),
    ...admins.results.map((admin) => c.env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)")
      .bind(createId("ntf"), admin.id, "registration", noticeTitle, noticeBody, "/admin")),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    await releaseInvite();
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: INVALID_CODE }, 422);
    throw error;
  }
  if (directAdmin) {
    const ready = invite!.company_status === "active";
    return c.json({ id: userId, status: "approved", message: ready ? `帳號已建立，你是「${invite!.company_name}」的管理員，現在就能登入` : `帳號已建立，你是「${invite!.company_name}」的管理員。公司開通後就能登入，系統管理員會通知你` }, 201);
  }
  // 系統內的通知一定有；信只寄給沒關掉通知信的管理員。
  await Promise.allSettled(admins.results.filter((admin) => admin.email_notifications === 1).map((admin) => sendNotificationMail(
    c.env,
    admin,
    "[艾爾水晶] 新註冊申請",
    `${noticeTitle}\n${noticeBody}\n\n請至管理中心核准：${c.env.APP_BASE_URL}/admin`,
  )));
  return c.json({ id: userId, status: "pending", message: "申請已送出，管理員核准後會寄信通知你" }, 201);
});
