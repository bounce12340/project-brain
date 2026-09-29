import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    /** OAuth 授權、token 與已連接的 AI 工具（MCP 連接器）存在這裡。 */
    OAUTH_KV: KVNamespace;
    /** OAuthProvider 注入給一般請求的輔助函式：授權頁、列出與撤銷連線。 */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

export {};
