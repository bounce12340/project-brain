import { Hono } from "hono";
import type { AppContext, Role } from "../types";
import { createId, writeAudit } from "../services/db";
import { hashPassword, randomToken } from "../services/crypto";
import { optionalString, requiredString } from "../services/http";
import { sendMail } from "../services/mailer";

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "僅限管理員" }, 403);
  return next();
});

adminRoutes.get("/users", async (c) => {
  const result = await c.env.DB.prepare("SELECT u.id,u.email,u.name,u.role,u.group_id,u.must_change_password,u.email_notifications,u.is_active,u.is_demo,u.created_at,g.name AS group_name FROM users u JOIN groups g ON g.id=u.group_id ORDER BY u.is_active DESC,u.name").all();
  return c.json({ users: result.results });
});

adminRoutes.post("/users", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const email = requiredString(body, "email")?.toLowerCase();
  const groupId = requiredString(body, "group_id");
  const role = requiredString(body, "role") as Role | null;
  const password = requiredString(body, "password");
  if (!name || !email || !groupId || !role || !["admin", "member", "intern"].includes(role) || !password || password.length < 8) return c.json({ error: "帳號資料不完整，密碼至少 8 碼" }, 422);
  const id = createId("usr");
  try {
    await c.env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,1)").bind(id, email, name, await hashPassword(password), role, groupId).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return c.json({ error: "Email 已存在" }, 422);
    throw error;
  }
  await writeAudit(c.env.DB, c.get("user"), "create", "user", id, `建立帳號 ${email}`);
  return c.json({ id }, 201);
});

adminRoutes.patch("/users/:id", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT name,email,role,group_id,is_active,email_notifications FROM users WHERE id=?").bind(c.req.param("id")).first<{ name: string; email: string; role: string; group_id: string; is_active: number; email_notifications: number }>();
  if (!current) return c.json({ error: "找不到使用者" }, 404);
  await c.env.DB.prepare("UPDATE users SET name=?,email=?,role=?,group_id=?,is_active=?,email_notifications=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(optionalString(body, "name") ?? current.name, optionalString(body, "email")?.toLowerCase() ?? current.email, optionalString(body, "role") ?? current.role, optionalString(body, "group_id") ?? current.group_id, "is_active" in body ? (body.is_active ? 1 : 0) : current.is_active, "email_notifications" in body ? (body.email_notifications ? 1 : 0) : current.email_notifications, c.req.param("id")).run();
  await writeAudit(c.env.DB, c.get("user"), "update", "user", c.req.param("id"), "更新帳號資料");
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  if (c.req.param("id") === c.get("user").id) return c.json({ error: "不可停用目前登入帳號" }, 422);
  await c.env.DB.prepare("UPDATE users SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.req.param("id")).run();
  await writeAudit(c.env.DB, c.get("user"), "deactivate", "user", c.req.param("id"), "停用帳號");
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const temporaryPassword = requiredString(body, "password") ?? `Brain-${randomToken(6)}`;
  if (temporaryPassword.length < 8) return c.json({ error: "臨時密碼至少 8 碼" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash=?,must_change_password=1,failed_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(temporaryPassword), c.req.param("id")),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(c.req.param("id")),
  ]);
  await writeAudit(c.env.DB, c.get("user"), "reset_password", "user", c.req.param("id"), "重設臨時密碼");
  return c.json({ temporary_password: temporaryPassword });
});

adminRoutes.get("/groups", async (c) => c.json({ groups: (await c.env.DB.prepare("SELECT * FROM groups ORDER BY name").all()).results }));

adminRoutes.post("/groups", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const type = requiredString(body, "type");
  if (!name || !type || !["clinical", "bd", "general"].includes(type)) return c.json({ error: "組別資料不正確" }, 422);
  const id = createId("grp");
  await c.env.DB.prepare("INSERT INTO groups (id,name,type) VALUES (?,?,?)").bind(id, name, type).run();
  await writeAudit(c.env.DB, c.get("user"), "create", "group", id, `建立組別「${name}」`);
  return c.json({ id }, 201);
});

adminRoutes.patch("/groups/:id", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT name,type FROM groups WHERE id=?").bind(c.req.param("id")).first<{ name: string; type: string }>();
  if (!current) return c.json({ error: "找不到組別" }, 404);
  await c.env.DB.prepare("UPDATE groups SET name=?,type=? WHERE id=?").bind(optionalString(body, "name") ?? current.name, optionalString(body, "type") ?? current.type, c.req.param("id")).run();
  await writeAudit(c.env.DB, c.get("user"), "update", "group", c.req.param("id"), "更新組別");
  return c.json({ ok: true });
});

adminRoutes.delete("/groups/:id", async (c) => {
  try {
    await c.env.DB.prepare("DELETE FROM groups WHERE id=?").bind(c.req.param("id")).run();
  } catch {
    return c.json({ error: "此組別仍被帳號、專案或模板使用" }, 422);
  }
  await writeAudit(c.env.DB, c.get("user"), "delete", "group", c.req.param("id"), "刪除組別");
  return c.json({ ok: true });
});

adminRoutes.get("/templates", async (c) => c.json({ templates: (await c.env.DB.prepare("SELECT * FROM stage_templates ORDER BY name").all()).results }));

adminRoutes.post("/templates", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = requiredString(body, "name");
  const stages = body.stages;
  if (!name || !Array.isArray(stages) || !stages.length || !stages.every((item) => typeof item === "string" && item.trim())) return c.json({ error: "模板名稱與階段不正確" }, 422);
  const id = createId("tpl");
  await c.env.DB.prepare("INSERT INTO stage_templates (id,name,group_id,stages_json) VALUES (?,?,?,?)").bind(id, name, optionalString(body, "group_id"), JSON.stringify(stages)).run();
  await writeAudit(c.env.DB, c.get("user"), "create", "template", id, `建立模板「${name}」`);
  return c.json({ id }, 201);
});

adminRoutes.patch("/templates/:id", async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare("SELECT name,group_id,stages_json FROM stage_templates WHERE id=?").bind(c.req.param("id")).first<{ name: string; group_id: string | null; stages_json: string }>();
  if (!current) return c.json({ error: "找不到模板" }, 404);
  const stages = Array.isArray(body.stages) && body.stages.every((item) => typeof item === "string" && item.trim()) ? body.stages : JSON.parse(current.stages_json);
  await c.env.DB.prepare("UPDATE stage_templates SET name=?,group_id=?,stages_json=? WHERE id=?").bind(optionalString(body, "name") ?? current.name, "group_id" in body ? optionalString(body, "group_id") : current.group_id, JSON.stringify(stages), c.req.param("id")).run();
  await writeAudit(c.env.DB, c.get("user"), "update", "template", c.req.param("id"), "更新階段模板");
  return c.json({ ok: true });
});

adminRoutes.delete("/templates/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM stage_templates WHERE id=?").bind(c.req.param("id")).run();
  await writeAudit(c.env.DB, c.get("user"), "delete", "template", c.req.param("id"), "刪除階段模板");
  return c.json({ ok: true });
});

adminRoutes.get("/audit-log", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = 30;
  const [rows, total] = await Promise.all([
    c.env.DB.prepare("SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?").bind(pageSize, (page - 1) * pageSize).all(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM audit_log").first<number>("value"),
  ]);
  return c.json({ audit_log: rows.results, page, total: total ?? 0, total_pages: Math.ceil((total ?? 0) / pageSize) });
});

adminRoutes.post("/clear-demo", async (c) => {
  const demoProjects = await c.env.DB.prepare("SELECT id FROM projects WHERE is_demo=1").all<{ id: string }>();
  const demoUsers = await c.env.DB.prepare("SELECT id FROM users WHERE is_demo=1").all<{ id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM projects WHERE is_demo=1"),
    c.env.DB.prepare("DELETE FROM users WHERE is_demo=1"),
  ]);
  await writeAudit(c.env.DB, c.get("user"), "clear_demo", "system", "demo", `清除 ${demoProjects.results.length} 個專案與 ${demoUsers.results.length} 個帳號`);
  return c.json({ deleted_projects: demoProjects.results.length, deleted_users: demoUsers.results.length });
});

adminRoutes.post("/test-email", async (c) => {
  const user = c.get("user");
  const result = await sendMail(c.env, user.email, "[專案進度大腦] 測試信", `您好 ${user.name}，這是專案進度大腦的寄信功能測試。\n\n${c.env.APP_BASE_URL}`);
  return c.json(result, result.sent ? 200 : 503);
});
