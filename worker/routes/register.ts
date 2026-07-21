import { Hono, type Context } from "hono";
import type { AppContext } from "../types";
import { hashPassword, sha256 } from "../services/crypto";
import { createId } from "../services/db";
import { sendMail } from "../services/mailer";
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

registerRoutes.get("/meta", async (c) => {
  const [enabled, groups] = await Promise.all([
    registrationEnabled(c.env.DB),
    c.env.DB.prepare("SELECT id,name FROM groups ORDER BY name").all<{ id: string; name: string }>(),
  ]);
  return c.json({ enabled, groups: groups.results });
});

registerRoutes.post("/send-code", async (c) => {
  if (!(await consumeIpLimit(c, "send_code", SEND_CODE_DAILY_LIMIT))) return c.json({ error: "今日取得驗證碼次數已達上限" }, 429);
  if (!(await registrationEnabled(c.env.DB))) return c.json({ error: "目前未開放自助註冊" }, 422);
  const body: { email?: string } = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) return c.json({ error: "請輸入有效的 Email" }, 422);
  const existing = await c.env.DB.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(email).first();
  if (existing) return c.json({ error: "此 Email 已註冊" }, 409);
  const recent = await c.env.DB.prepare("SELECT 1 AS found FROM email_verifications WHERE email=? AND purpose='register' AND created_at > datetime('now','-60 seconds') ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (recent) return c.json({ error: "請於 60 秒後再取得驗證碼" }, 429);

  const code = generateOtp();
  const id = createId("verify");
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  await c.env.DB.prepare("INSERT INTO email_verifications (id,email,code_hash,expires_at) VALUES (?,?,?,?)")
    .bind(id, email, await hashOtp(code), expiresAt).run();
  try {
    const mail = await sendMail(c.env, email, "[艾爾水晶] 註冊驗證碼", `您的註冊驗證碼是：${code}\n\n驗證碼 15 分鐘內有效，請勿轉交他人。`);
    if (!mail.sent) throw new Error("寄信服務未設定");
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM email_verifications WHERE id=?").bind(id).run();
    console.error(JSON.stringify({ message: "registration OTP email failed", error: error instanceof Error ? error.message : "unknown" }));
    return c.json({ error: "驗證碼寄送失敗，請稍後再試" }, 503);
  }
  return c.json({ ok: true, message: "驗證碼已寄出，15 分鐘內有效" });
});

registerRoutes.post("/submit", async (c) => {
  if (!(await consumeIpLimit(c, "submit", SUBMIT_DAILY_LIMIT))) return c.json({ error: "今日註冊嘗試次數已達上限" }, 429);
  const body: RegistrationInput = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email ?? "");
  const [enabled, existing, group] = await Promise.all([
    registrationEnabled(c.env.DB),
    c.env.DB.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(email).first(),
    c.env.DB.prepare("SELECT id,name FROM groups WHERE id=?").bind(body.group_id ?? "").first<{ id: string; name: string }>(),
  ]);
  const validation = validateRegistrationInput(body, { enabled, emailExists: Boolean(existing), groupExists: Boolean(group) });
  if (!validation.ok) return c.json({ error: validation.error }, validation.status);

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

  const userId = createId("usr");
  const admins = await c.env.DB.prepare("SELECT id,email,name FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved'").all<{ id: string; email: string; name: string }>();
  const noticeTitle = `新註冊申請：${validation.value.name}`;
  const noticeBody = `${validation.value.email}／${group!.name}`;
  const statements = [
    c.env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,onboarding_done,approval_status) VALUES (?,?,?,?,?,?,0,0,'pending')")
      .bind(userId, validation.value.email, validation.value.name, await hashPassword(validation.value.password), "member", validation.value.group_id),
    c.env.DB.prepare("UPDATE email_verifications SET verified=1 WHERE id=? AND verified=0").bind(verification!.id),
    ...admins.results.map((admin) => c.env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)")
      .bind(createId("ntf"), admin.id, "registration", noticeTitle, noticeBody, "/admin")),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "此 Email 已註冊" }, 409);
    throw error;
  }
  await Promise.allSettled(admins.results.map((admin) => sendMail(
    c.env,
    admin.email,
    "[艾爾水晶] 新註冊申請",
    `${noticeTitle}\n${noticeBody}\n\n請至管理中心核准：${c.env.APP_BASE_URL}/admin`,
  )));
  return c.json({ id: userId, status: "pending", message: "申請已送出，管理員核准後會寄信通知你" }, 201);
});
