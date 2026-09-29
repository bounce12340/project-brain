import { Hono } from "hono";
import { OAuthProvider, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import type { AppContext } from "./types";
import { originGuard, sessionAuth } from "./middleware/auth";
import { mountApiRoutes } from "./api";
import { oauthRoutes } from "./routes/oauth";
import { handleMcp, MCP_SCOPES, type McpProps } from "./mcp/handler";
import { runDailyWorkflow } from "./services/cron";
import { regenerateMonthlyReports, regenerateWeeklyReports } from "./services/reports";
import { scheduledJobForCron } from "./services/schedule";

const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", error: error.message, path: c.req.path }));
  return c.json({ error: "伺服器發生錯誤" }, 500);
});

app.use("/api/*", originGuard);
app.use("/api/*", sessionAuth);
mountApiRoutes(app);
app.route("/oauth", oauthRoutes);
app.notFound((c) => c.json({ error: "找不到資源" }, 404));

/**
 * AI 工具經 MCP 連接：/mcp 需要 OAuth token，其餘請求照舊交給網站。
 * OAuthProvider 同時提供授權伺服器的 metadata、token、動態註冊與撤銷端點；
 * 授權頁（/oauth/authorize）是網站自己的，用登入 cookie 確認是誰。
 * resource 必須是正式網址，所以依 APP_BASE_URL 建立（本機開發是 http://127.0.0.1:8787）。
 */
const providers = new Map<string, OAuthProvider<Env>>();

function oauthProvider(env: Env): OAuthProvider<Env> {
  const origin = new URL(env.APP_BASE_URL).origin;
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: { fetch: (request, env, ctx) => handleMcp(request, env, ctx as OAuthResourceContext<McpProps>) },
      defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: [MCP_SCOPES.read, MCP_SCOPES.write],
      requiredScopes: [MCP_SCOPES.read],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "艾爾水晶", bearer_methods_supported: ["header"] },
      clientIdMetadataDocumentEnabled: true,
      // 持續使用就不會過期；閒置 30 天才需要重新連接。
      refreshTokenIdleTTL: 30 * 86_400,
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => oauthProvider(env).fetch(request, env, ctx),
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = scheduledJobForCron(controller.cron);
    if (job === "daily-reminders") {
      ctx.waitUntil(runDailyWorkflow(env).then((result) => console.log(JSON.stringify({ message: "每日工作完成", ...result }))));
      // 清掉過期的 AI 連接器授權與 token。
      ctx.waitUntil(oauthProvider(env).purgeExpiredData(env).then((result) => console.log(JSON.stringify({ message: "清除過期 OAuth 資料", ...result }))).catch((error) => console.error(JSON.stringify({ message: "清除過期 OAuth 資料失敗", error: String(error) }))));
    }
    else if (job === "weekly-reports") ctx.waitUntil(regenerateWeeklyReports(env).then((result) => console.log(JSON.stringify({ message: "AI 週報完成", ...result }))));
    else if (job === "monthly-reports") ctx.waitUntil(regenerateMonthlyReports(env).then((result) => console.log(JSON.stringify({ message: "AI 月報完成", ...result }))));
    else console.log(JSON.stringify({ message: "未知排程", cron: controller.cron }));
  },
} satisfies ExportedHandler<Env>;
