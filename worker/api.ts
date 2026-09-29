import type { Hono } from "hono";
import type { AppContext } from "./types";
import { authRoutes } from "./routes/auth";
import { projectsRoutes } from "./routes/projects";
import { resourcesRoutes } from "./routes/resources";
import { generalRoutes } from "./routes/general";
import { adminRoutes } from "./routes/admin";
import { aiRoutes, reportsRoutes } from "./routes/reports";
import { v2Routes } from "./routes/v2";
import { registerRoutes } from "./routes/register";
import { v6Routes } from "./routes/v6";
import { adminImportRoutes, importRoutes } from "./routes/import";
import { v7Routes } from "./routes/v7";
import { mcpGrantRoutes } from "./routes/mcp-grants";

/**
 * 掛上所有 /api 路由。網站（登入 cookie）與 MCP 連接器（OAuth token）共用同一份，
 * 所以 AI 工具經過的權限檢查、驗證與自動化規則，和使用者在畫面上操作時一模一樣。
 * 驗證身分的中介層由呼叫端各自掛。
 */
export function mountApiRoutes(app: Hono<AppContext>): void {
  app.get("/api/health", (c) => c.json({ ok: true, service: "project-brain" }));
  app.route("/api/auth", authRoutes);
  app.route("/api/register", registerRoutes);
  app.route("/api/projects", projectsRoutes);
  app.route("/api", resourcesRoutes);
  app.route("/api", generalRoutes);
  app.route("/api", v2Routes);
  app.route("/api", v7Routes);
  app.route("/api", v6Routes);
  app.route("/api/reports", reportsRoutes);
  app.route("/api/ai", aiRoutes);
  app.route("/api", importRoutes);
  app.route("/api", mcpGrantRoutes);
  app.route("/api/admin", adminImportRoutes);
  app.route("/api/admin", adminRoutes);
}
