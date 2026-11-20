import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppContext, AuthUser } from "../types";
import { hashPassword, randomToken, sha256, verifyPassword } from "../services/crypto";
import { approvalLoginError, type ApprovalStatus } from "../services/registration";
import { clearLoginPair, lockedLoginScopes, LOGIN_THROTTLED_MESSAGE, recordLoginFailure } from "../services/login-throttle";
import { clientIp } from "../services/rate-limit";
import { revokeUserAccess } from "../services/revoke-access";
import { companyLoginError, type CompanyStatus } from "../services/tenant";

export const authRoutes = new Hono<AppContext>();

// 帳號不存在或已停用時也要做一次同樣成本的密碼驗證，否則回應時間會洩漏帳號是否存在。
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing"));

authRoutes.post("/login", async (c) => {
  const body: { email?: string; password?: string } = await c.req.json().catch(() => ({}));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return c.json({ error: "請輸入 Email 與密碼" }, 422);
  const ip = clientIp(c.req.raw);
  // 為什麼 429 與 401「帳號或密碼錯誤」不能拼出帳號是否存在：
  // 節流計數只看「輸入的 Email 與來源 IP」，帳號不存在、已停用、公司停用的失敗都照樣累計，
  // 所以同樣的輸入序列對存在與不存在的帳號會得到同樣的 401／429 序列。
  // (帳號, IP) 與帳號鎖連密碼正確也擋；IP 鎖（全公司共用 IP，門檻 100）只擋密碼驗證失敗的嘗試，
  // 因此要先驗密碼再決定。
  const locked = await lockedLoginScopes(c.env.DB, email, ip);
  if (locked.strict) return c.json({ error: LOGIN_THROTTLED_MESSAGE }, 429);
  const account = await c.env.DB.prepare(`
    SELECT u.*, g.name AS group_name, g.type AS group_type, g.company_id, co.name AS company_name, co.status AS company_status
    FROM users u JOIN groups g ON g.id = u.group_id JOIN companies co ON co.id = g.company_id WHERE u.email = ?
  `).bind(email).first<AuthUser & { password_hash: string; is_active: number; failed_count: number; locked_until: string | null; approval_status: ApprovalStatus; email_token: string | null; company_status: CompanyStatus }>();
  const passwordOk = await verifyPassword(body.password, account && account.is_active === 1 ? account.password_hash : await getDummyHash());
  if (!account || account.is_active !== 1 || !passwordOk) {
    if (locked.ip) return c.json({ error: LOGIN_THROTTLED_MESSAGE }, 429);
    await recordLoginFailure(c.env.DB, email, ip);
    return c.json({ error: "帳號或密碼錯誤" }, 401);
  }
  const approvalError = approvalLoginError(account.approval_status);
  if (approvalError) return c.json({ error: approvalError }, 403);
  // 公司還在建置中或已停用：密碼對了也不能登入。
  const companyError = companyLoginError(account.company_status, account.company_name);
  if (companyError) return c.json({ error: companyError, code: "COMPANY_NOT_ACTIVE" }, 403);
  const token = randomToken();
  const sessionId = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 86_400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sessionId, account.id, expiresAt.toISOString()).run();
  await clearLoginPair(c.env.DB, email, ip);
  setCookie(c, "sid", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires: expiresAt });
  const { password_hash: _passwordHash, is_active: _isActive, failed_count: _failedCount, locked_until: _lockedUntil, email_token: _emailToken, company_status: _companyStatus, ...user } = account;
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
  if (!body.current_password || !body.new_password || body.new_password.length < 8 || body.new_password.length > 200) return c.json({ error: "新密碼需為 8 到 200 碼" }, 422);
  if (body.new_password === body.current_password) return c.json({ error: "新密碼不可與目前密碼相同" }, 422);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.current_password, row.password_hash))) return c.json({ error: "目前密碼不正確" }, 422);
  const passwordHash = await hashPassword(body.new_password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(passwordHash, user.id).run();
  // 改密碼的目的常是懷疑外洩：其他裝置的登入與 AI 連接器授權一併收回，只留目前這個 session。
  await revokeUserAccess(c.env, user.id, { keepSessionId: await sha256(c.get("sessionToken")) });
  return c.json({ ok: true });
});

authRoutes.post("/onboarding-done", async (c) => {
  await c.env.DB.prepare("UPDATE users SET onboarding_done=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.get("user").id).run();
  return c.json({ ok: true });
});
