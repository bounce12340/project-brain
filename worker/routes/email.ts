import { Hono, type Context } from "hono";
import type { AppContext } from "../types";
import { createId } from "../services/db";
import { escapeHtml, messagePage, page } from "../mcp/consent-page";

/**
 * 通知信的關閉連結：/email/unsubscribe?token=…（不用登入，代碼本身就是憑證，只能用來關掉通知信）。
 *
 * GET 只顯示確認頁，不直接關：信箱的安全掃描會先把信裡的連結點過一遍。
 * POST 才關——確認頁的按鈕，或 Gmail「取消訂閱」依 RFC 8058 送來的一鍵 POST
 * （body 是 List-Unsubscribe=One-Click，不帶 cookie、不帶 Origin）。
 */
export const emailRoutes = new Hono<AppContext>();

type Ctx = Context<AppContext>;
interface Subscriber { id: string; email: string; email_notifications: number }

const html = (body: string, status = 200) => new Response(body, {
  status,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
});

const invalid = () => html(messagePage("連結已失效", "這個連結用不了了。要調整通知信，請登入艾爾水晶，到「個人設定」修改。", { href: "/profile", label: "前往個人設定" }), 404);

/** 只露出第一個字與網域，連結被轉寄時不會整個 Email 曝光。 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "***";
}

async function subscriber(c: Ctx): Promise<Subscriber | null> {
  const token = c.req.query("token") ?? "";
  if (!token || token.length > 100) return null;
  return c.env.DB.prepare("SELECT id,email,email_notifications FROM users WHERE email_token=? AND is_active=1").bind(token).first<Subscriber>();
}

emailRoutes.get("/unsubscribe", async (c) => {
  const user = await subscriber(c);
  if (!user) return invalid();
  if (user.email_notifications !== 1) return html(messagePage("通知信已經關閉", "艾爾水晶不會再寄通知信給你。要重新開啟，請到「個人設定」。", { href: "/profile", label: "前往個人設定" }));
  return html(page("關閉通知信", `
<h1>要關閉艾爾水晶的通知信嗎？</h1>
<p>寄給 <strong>${escapeHtml(maskEmail(user.email))}</strong> 的每日提醒與其他通知信都會停止，系統裡的「通知」照常顯示。</p>
<p class="dim">重設密碼、帳號核准等帳號相關的信仍會寄出。之後可以在「個人設定」重新開啟。</p>
<form method="post"><div class="actions"><button class="allow">關閉通知信</button></div></form>`));
});

emailRoutes.post("/unsubscribe", async (c) => {
  const user = await subscriber(c);
  if (!user) return invalid();
  if (user.email_notifications === 1) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET email_notifications=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id),
      c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)")
        .bind(createId("audit"), user.id, "email_unsubscribe", "user", user.id, "從通知信的連結關閉通知信"),
    ]);
  }
  return html(messagePage("已關閉通知信", "艾爾水晶不會再寄通知信給你。要重新開啟，請到「個人設定」。", { href: "/profile", label: "前往個人設定" }));
});
