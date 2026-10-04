import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { loadActiveUser } from "../services/session-user";
import { internalApi } from "./internal-api";
import { handleMcpRequest, ToolError } from "./protocol";
import { MCP_SERVER_INFO, MCP_TOOLS, type ToolContext } from "./tools";

/** 授權時存進 token 的資料。只放 id 與顯示用的名稱；使用者的權限每次呼叫重新查。 */
export interface McpProps { userId: string; clientName?: string }

export const MCP_SCOPES = { read: "mcp:read", write: "mcp:write" } as const;

/** 圖示放在網站的 public/ 底下；網址跟著這次請求的網域走，本機測試也對得上。 */
export const serverIcons = (requestUrl: string) => [
  { src: new URL("/icon-512.png", requestUrl).href, mimeType: "image/png", sizes: ["512x512"] },
  { src: new URL("/favicon.svg", requestUrl).href, mimeType: "image/svg+xml", sizes: ["any"] },
];

/**
 * /mcp：OAuth 驗過 token 之後才會進到這裡，ctx.props 是授權時存的資料，
 * ctx.auth.scope 是使用者在授權頁勾選的權限。
 */
export async function handleMcp(request: Request, env: Env, ctx: OAuthResourceContext<McpProps>): Promise<Response> {
  return handleMcpRequest<ToolContext>(request, {
    tools: MCP_TOOLS,
    info: { ...MCP_SERVER_INFO, icons: serverIcons(request.url) },
    canWrite: ctx.auth.scope.includes(MCP_SCOPES.write),
    async context() {
      const user = await loadActiveUser(env.DB, ctx.props.userId);
      if (!user) throw new ToolError("這個艾爾水晶帳號已停用或尚未核准，無法使用 AI 連接器。");
      if (user.must_change_password === 1) throw new ToolError("請先登入艾爾水晶變更密碼，再使用 AI 連接器。");
      return { user, baseUrl: env.APP_BASE_URL, api: internalApi(env, ctx, user), db: env.DB, clientName: ctx.props.clientName || "AI 工具" };
    },
    onError(error, tool) {
      console.error(JSON.stringify({ message: "MCP tool failed", tool, user: ctx.props.userId, error: error instanceof Error ? error.message : String(error) }));
    },
  });
}
