import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import type { AppContext, AuthUser } from "../types";
import { writeAudit } from "../services/db";
import { findSessionUser } from "../services/session-user";
import { consentPage, messagePage } from "../mcp/consent-page";
import { MCP_SCOPES, type McpProps } from "../mcp/handler";
import { withoutIssuerParameter } from "../mcp/issuer-identification";

/**
 * AI 工具（MCP 用戶端）連接艾爾水晶的授權頁：/oauth/authorize。
 * token、註冊、撤銷由 OAuthProvider 處理；這裡只負責「是誰」與「同不同意」。
 * 身分沿用網站的登入 cookie——沒登入就先去登入頁，登入完回到這裡。
 */
export const oauthRoutes = new Hono<AppContext>();

type Ctx = Context<AppContext>;

const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" } });

async function sessionUser(c: Ctx): Promise<AuthUser | null> {
  const token = getCookie(c, "sid");
  return token ? findSessionUser(c.env.DB, token) : null;
}

/** parseAuthRequest 失敗：只有在用戶端與 redirect URI 都驗過時才導回去，否則就地顯示。 */
function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(withoutIssuerParameter(error.redirectTo), 302);
  if (error instanceof AuthorizationError) return html(messagePage("無法連接", error.description ?? "授權請求不正確，請回到 AI 工具重新連接。"), 400);
  if (error instanceof CimdFetchError) return html(messagePage("無法連接", "無法確認這個 AI 工具的身分，請稍後再試。"), 400);
  throw error;
}

oauthRoutes.get("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  let authRequest;
  try { authRequest = await oauth.parseAuthRequest(c.req.raw); } catch (error) { return authorizationFailure(error); }
  const user = await sessionUser(c);
  if (!user) {
    const url = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  if (user.must_change_password === 1) return html(messagePage("請先變更密碼", "你的帳號需要先變更密碼，才能連接 AI 工具。變更後請回到 AI 工具重新連接。", { href: "/change-password", label: "前往變更密碼" }), 403);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(consentPage(details, consent.handle, user), { headers: consent.headers });
});

oauthRoutes.post("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  const user = await sessionUser(c);
  if (!user || user.must_change_password === 1) return html(messagePage("登入已失效", "請回到 AI 工具重新連接。"), 401);
  const form = await c.req.raw.clone().formData();
  const handle = String(form.get("handle") ?? "");
  try {
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      denied.headers.set("Location", withoutIssuerParameter(denied.redirectTo));
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const scope = [MCP_SCOPES.read, ...(form.get("write") === "on" ? [MCP_SCOPES.write] : [])];
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    const client = await oauth.lookupClient(approved.request.clientId).catch(() => null);
    const clientName = (client?.clientName ?? approved.request.clientId).slice(0, 100);
    const props: McpProps = { userId: user.id, clientName };
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: user.id, metadata: { clientName }, scope: approved.request.scope, props });
    await writeAudit(c.env.DB, user, "mcp_connect", "user", user.id, `連接 AI 工具「${clientName}」（${approved.request.scope.includes(MCP_SCOPES.write) ? "查看與修改" : "只能查看"}）`);
    approved.headers.set("Location", withoutIssuerParameter(redirectTo));
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return html(messagePage("授權頁已失效", "這個授權頁已經用過、逾時，或是在另一個瀏覽器開啟。請回到 AI 工具重新連接。"), 400);
    throw error;
  }
});
