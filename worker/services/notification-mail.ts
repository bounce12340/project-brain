import { randomToken } from "./crypto";
import { sendMail, type MailResult } from "./mailer";

/**
 * 通知信（每日提醒、新註冊申請）與帳號相關的信（驗證碼、重設密碼、核准）分開寄：
 * 通知信看使用者的 email_notifications，信末附關閉連結，並帶 RFC 8058 的一鍵取消訂閱標頭。
 *
 * 帶了 List-Unsubscribe，收件人在 Gmail 按「取消訂閱」時，Gmail 會 POST 到我們的連結，
 * 關掉的是艾爾水晶自己的設定。沒帶的話，Gmail 只能把它當成退訂或垃圾信檢舉回報給寄信服務，
 * AgentMail 就會封鎖這個收件人，之後連重設密碼的信都寄不到。
 */
export interface NotificationRecipient { id: string; email: string }

export const NOTIFICATION_FOOTER = "不想再收到艾爾水晶的通知信？點這個連結關閉：";

/** 取得（第一次時產生）這位使用者的取消通知信代碼。代碼只能用來關掉通知信。 */
export async function emailToken(db: D1Database, userId: string): Promise<string> {
  const existing = await db.prepare("SELECT email_token FROM users WHERE id=?").bind(userId).first<string | null>("email_token");
  if (existing) return existing;
  await db.prepare("UPDATE users SET email_token=? WHERE id=? AND email_token IS NULL").bind(randomToken(24), userId).run();
  const token = await db.prepare("SELECT email_token FROM users WHERE id=?").bind(userId).first<string | null>("email_token");
  if (!token) throw new Error(`找不到使用者 ${userId}`);
  return token;
}

export function unsubscribeUrl(env: Env, token: string): string {
  return `${new URL(env.APP_BASE_URL).origin}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

export async function sendNotificationMail(env: Env, recipient: NotificationRecipient, subject: string, body: string): Promise<MailResult> {
  const url = unsubscribeUrl(env, await emailToken(env.DB, recipient.id));
  const text = `${body}\n\n——\n${NOTIFICATION_FOOTER}${url}\n之後可以在「個人設定」重新開啟。重設密碼、帳號核准等帳號相關的信不受影響。`;
  return sendMail(env, recipient.email, subject, text, {
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}
