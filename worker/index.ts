import { Hono } from "hono";
import type { AppContext } from "./types";
import { originGuard, sessionAuth } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { projectsRoutes } from "./routes/projects";
import { resourcesRoutes } from "./routes/resources";
import { generalRoutes } from "./routes/general";
import { adminRoutes } from "./routes/admin";
import { aiRoutes, reportsRoutes } from "./routes/reports";
import { runDailyReminders } from "./services/cron";
import { regenerateWeeklyReports } from "./services/reports";
import { v2Routes } from "./routes/v2";
import { registerRoutes } from "./routes/register";
import { v6Routes } from "./routes/v6";
import { importRoutes } from "./routes/import";
import { v7Routes } from "./routes/v7";

const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", error: error.message, path: c.req.path }));
  return c.json({ error: "伺服器發生錯誤" }, 500);
});

app.use("/api/*", originGuard);
app.use("/api/*", sessionAuth);
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
app.route("/api/admin", importRoutes);
app.route("/api/admin", adminRoutes);
app.notFound((c) => c.json({ error: "找不到資源" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 1 * * *") ctx.waitUntil(runDailyReminders(env).then((result) => console.log(JSON.stringify({ message: "每日提醒完成", ...result }))));
    else if (controller.cron === "30 0 * * 1") ctx.waitUntil(regenerateWeeklyReports(env).then((result) => console.log(JSON.stringify({ message: "AI 週報完成", ...result }))));
    else console.log(JSON.stringify({ message: "未知排程", cron: controller.cron }));
  },
} satisfies ExportedHandler<Env>;
