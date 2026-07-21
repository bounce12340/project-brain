import { Hono } from "hono";
import type { AppContext } from "./types";
import { originGuard, sessionAuth } from "./middleware/auth";
import { authRoutes } from "./routes/auth";

const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", error: error.message, path: c.req.path }));
  return c.json({ error: "伺服器發生錯誤" }, 500);
});

app.use("/api/*", originGuard);
app.use("/api/*", sessionAuth);
app.get("/api/health", (c) => c.json({ ok: true, service: "project-brain" }));
app.route("/api/auth", authRoutes);
app.notFound((c) => c.json({ error: "找不到資源" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(JSON.stringify({ message: "scheduled handler 尚未註冊" }));
  },
} satisfies ExportedHandler<Env>;
