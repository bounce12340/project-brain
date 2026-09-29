import { Hono } from "hono";
import type { AppContext, AuthUser } from "../types";
import { mountApiRoutes } from "../api";
import { ToolError } from "./protocol";

export interface InternalApi {
  get<T>(path: string): Promise<T>;
  send<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>;
}

/**
 * 以某位使用者的身分呼叫網站自己的 /api。MCP 工具不另寫一套查詢與寫入：
 * 權限、欄位驗證、自動進度、自動化規則都走和畫面操作同一條路。
 * 路由回的錯誤訊息（「沒有編輯權限」「找不到專案」）原樣變成工具錯誤，AI 可以直接轉述。
 */
export function internalApi(env: Env, executionCtx: ExecutionContext | undefined, user: AuthUser): InternalApi {
  const app = new Hono<AppContext>();
  app.onError((error, c) => {
    console.error(JSON.stringify({ message: "MCP internal request failed", error: error.message, path: c.req.path }));
    return c.json({ error: "伺服器發生錯誤" }, 500);
  });
  app.use("/api/*", async (c, next) => { c.set("user", user); await next(); });
  mountApiRoutes(app);
  app.notFound((c) => c.json({ error: "找不到資源" }, 404));

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
    const response = await app.request(path, init, env, executionCtx);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new ToolError(typeof data.error === "string" ? data.error : `系統回應 HTTP ${response.status}`);
    return data as T;
  };
  return { get: (path) => call("GET", path), send: (method, path, body) => call(method, path, body) };
}
