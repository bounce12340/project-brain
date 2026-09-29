import { Hono } from "hono";
import type { AppContext } from "../types";
import { hashPassword, randomToken, sha256 } from "../services/crypto";
import { createId } from "../services/db";
import { sendMail } from "../services/mailer";
import { clientIp, consumeDailyLimit } from "../services/rate-limit";
import { isValidEmail, normalizeEmail } from "../services/registration";

/**
 * 忘記密碼：寄一次性的重設連結到帳號的 Email。
 *
 * - 不論 Email 有沒有註冊都回同一句話，不讓人拿這裡查誰有帳號。
 * - 連結 30 分鐘內有效、只能用一次；資料庫只存代碼的雜湊。
 * - 這是帳號相關的信，關掉通知信的人照樣會收到。
 * - 重設後登出所有裝置、解除登入鎖定，並寄一封「密碼已重設」通知本人。
 */
export const passwordResetRoutes = new Hono<AppContext>();

const RESET_MINUTES = 30;
const REQUESTS_PER_IP_PER_DAY = 10;
const RESETS_PER_IP_PER_DAY = 30;
const EMAILS_PER_ACCOUNT_PER_DAY = 5;
export const FORGOT_PASSWORD_MESSAGE = `如果這個 Email 在艾爾水晶有帳號，重設密碼的連結已經寄出，${RESET_MINUTES} 分鐘內有效。沒收到請看看垃圾郵件，或聯絡管理員。`;
const INVALID_LINK = "重設連結已失效或已經用過，請重新申請。";

interface ResetRow { id: string; user_id: string; email: string; name: string }

async function openReset(db: D1Database, token: unknown): Promise<ResetRow | null> {
  if (typeof token !== "string" || !token || token.length > 100) return null;
  return db.prepare(`SELECT pr.id,pr.user_id,u.email,u.name FROM password_resets pr JOIN users u ON u.id=pr.user_id
    WHERE pr.token_hash=? AND pr.used_at IS NULL AND pr.expires_at>? AND u.is_active=1 AND u.approval_status='approved'`)
    .bind(await sha256(token), new Date().toISOString()).first<ResetRow>();
}

passwordResetRoutes.post("/forgot-password", async (c) => {
  if (!(await consumeDailyLimit(c.env.DB, "forgot_password", clientIp(c.req.raw), REQUESTS_PER_IP_PER_DAY))) return c.json({ error: "今天申請重設密碼的次數太多了，請明天再試，或聯絡管理員。" }, 429);
  const body: { email?: unknown } = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!isValidEmail(email)) return c.json({ error: "請輸入有效的 Email" }, 422);

  const account = await c.env.DB.prepare(`SELECT u.id,u.name,u.email,
      (SELECT COUNT(*) FROM password_resets pr WHERE pr.user_id=u.id AND pr.created_at>datetime('now','-1 day')) AS today,
      (SELECT COUNT(*) FROM password_resets pr WHERE pr.user_id=u.id AND pr.created_at>datetime('now','-2 minutes')) AS recent
    FROM users u WHERE u.email=? AND u.is_active=1 AND u.approval_status='approved'`).bind(email).first<{ id: string; name: string; email: string; today: number; recent: number }>();
  // 同一個帳號兩分鐘內只寄一次、一天最多五次：避免被拿來灌爆別人的信箱。回應一樣。
  if (account && account.recent === 0 && account.today < EMAILS_PER_ACCOUNT_PER_DAY) {
    const token = randomToken(32);
    const id = createId("pwreset");
    await c.env.DB.prepare("INSERT INTO password_resets (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
      .bind(id, account.id, await sha256(token), new Date(Date.now() + RESET_MINUTES * 60_000).toISOString()).run();
    const link = `${new URL(c.env.APP_BASE_URL).origin}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      const mail = await sendMail(c.env, account.email, "[艾爾水晶] 重設密碼", `${account.name} 您好：\n\n我們收到重設艾爾水晶密碼的要求。請在 ${RESET_MINUTES} 分鐘內開啟下面的連結，設定新密碼：\n${link}\n\n連結只能使用一次。如果不是你本人要求，請忽略這封信，你的密碼不會改變。`);
      if (!mail.sent) throw new Error("寄信服務未設定");
    } catch (error) {
      await c.env.DB.prepare("DELETE FROM password_resets WHERE id=?").bind(id).run();
      console.error(JSON.stringify({ message: "password reset email failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return c.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
});

/** 重設頁打開時先確認連結還能用，失效的就不必讓人輸入密碼。 */
passwordResetRoutes.get("/reset-password", async (c) => c.json({ valid: Boolean(await openReset(c.env.DB, c.req.query("token"))) }));

passwordResetRoutes.post("/reset-password", async (c) => {
  if (!(await consumeDailyLimit(c.env.DB, "reset_password", clientIp(c.req.raw), RESETS_PER_IP_PER_DAY))) return c.json({ error: "今天嘗試的次數太多了，請明天再試，或聯絡管理員。" }, 429);
  const body: { token?: unknown; new_password?: unknown } = await c.req.json().catch(() => ({}));
  const password = typeof body.new_password === "string" ? body.new_password : "";
  if (password.length < 8 || password.length > 200) return c.json({ error: "新密碼至少 8 碼" }, 422);
  const reset = await openReset(c.env.DB, body.token);
  if (!reset) return c.json({ error: INVALID_LINK }, 400);
  // 先把這張代碼標成用過；同時送兩次時只有一次會成功。
  const claimed = await c.env.DB.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL").bind(reset.id).run();
  if (!claimed.meta.changes) return c.json({ error: INVALID_LINK }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash=?,must_change_password=0,failed_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(password), reset.user_id),
    c.env.DB.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").bind(reset.user_id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(reset.user_id),
    c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)")
      .bind(createId("audit"), reset.user_id, "password_reset", "user", reset.user_id, "用 Email 連結重設密碼，並登出所有裝置"),
  ]);
  try {
    await sendMail(c.env, reset.email, "[艾爾水晶] 密碼已重設", `${reset.name} 您好：\n\n你的艾爾水晶密碼剛剛用 Email 連結重設了，所有裝置都已登出，請用新密碼重新登入：\n${new URL(c.env.APP_BASE_URL).origin}/login\n\n如果不是你本人操作，請立刻聯絡管理員。`);
  } catch (error) {
    console.error(JSON.stringify({ message: "password reset confirmation email failed", error: error instanceof Error ? error.message : String(error) }));
  }
  return c.json({ ok: true });
});
