import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppContext, AuthUser } from "../types";
import { hashPassword, randomToken, sha256, verifyPassword } from "../services/crypto";

export const authRoutes = new Hono<AppContext>();

authRoutes.post("/login", async (c) => {
  const body: { email?: string; password?: string } = await c.req.json().catch(() => ({}));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return c.json({ error: "請輸入 Email 與密碼" }, 422);
  const account = await c.env.DB.prepare(`
    SELECT u.*, g.name AS group_name, g.type AS group_type FROM users u JOIN groups g ON g.id = u.group_id WHERE u.email = ?
  `).bind(email).first<AuthUser & { password_hash: string; is_active: number; failed_count: number; locked_until: string | null }>();
  if (!account || account.is_active !== 1) return c.json({ error: "帳號或密碼錯誤" }, 401);
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) return c.json({ error: "登入失敗次數過多，請稍後再試" }, 423);
  if (!(await verifyPassword(body.password, account.password_hash))) {
    const nextCount = account.failed_count + 1;
    const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await c.env.DB.prepare("UPDATE users SET failed_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(nextCount >= 5 ? 0 : nextCount, lockedUntil, account.id).run();
    return c.json({ error: "帳號或密碼錯誤" }, 401);
  }
  const token = randomToken();
  const sessionId = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 86_400_000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET failed_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(account.id),
    c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sessionId, account.id, expiresAt.toISOString()),
  ]);
  setCookie(c, "sid", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires: expiresAt });
  const { password_hash: _passwordHash, is_active: _isActive, failed_count: _failedCount, locked_until: _lockedUntil, ...user } = account;
  return c.json({ user });
});

authRoutes.post("/logout", async (c) => {
  const sessionId = await sha256(c.get("sessionToken"));
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  deleteCookie(c, "sid", { path: "/", secure: true });
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => c.json({ user: c.get("user") }));

authRoutes.post("/change-password", async (c) => {
  const body: { current_password?: string; new_password?: string } = await c.req.json().catch(() => ({}));
  if (!body.current_password || !body.new_password || body.new_password.length < 8) return c.json({ error: "新密碼至少 8 碼" }, 422);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.current_password, row.password_hash))) return c.json({ error: "目前密碼不正確" }, 422);
  const passwordHash = await hashPassword(body.new_password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(passwordHash, user.id).run();
  return c.json({ ok: true });
});

authRoutes.post("/onboarding-done", async (c) => {
  await c.env.DB.prepare("UPDATE users SET onboarding_done=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.get("user").id).run();
  return c.json({ ok: true });
});
