import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext, AuthUser } from "../types";
import { sha256 } from "../services/crypto";

const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login"]);
const PASSWORD_PATHS = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

export const originGuard: MiddlewareHandler<AppContext> = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  const requestOrigin = new URL(c.req.url).origin;
  const configuredOrigin = new URL(c.env.APP_BASE_URL).origin;
  if (!origin || (origin !== requestOrigin && origin !== configuredOrigin)) return c.json({ error: "Origin 驗證失敗" }, 403);
  return next();
};

export const sessionAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const token = getCookie(c, "sid");
  if (!token) return c.json({ error: "請先登入" }, 401);
  const sessionId = await sha256(token);
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.group_id, g.name AS group_name, g.type AS group_type,
           u.must_change_password, u.email_notifications
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN groups g ON g.id = u.group_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
  `).bind(sessionId).first<AuthUser>();
  if (!user) return c.json({ error: "登入已失效" }, 401);
  const expiresAt = new Date(Date.now() + 30 * 86_400_000);
  await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expiresAt.toISOString(), sessionId).run();
  setCookie(c, "sid", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires: expiresAt });
  c.set("user", user);
  c.set("sessionToken", token);
  if (user.must_change_password === 1 && !PASSWORD_PATHS.has(c.req.path)) return c.json({ error: "請先變更密碼", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  return next();
};
