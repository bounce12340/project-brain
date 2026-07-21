import { Hono } from "hono";
import type { AppContext, Role } from "../types";
import { createId, writeAudit } from "../services/db";
import { hashPassword, randomToken, verifyPassword } from "../services/crypto";
import { optionalString, requiredString } from "../services/http";
import { sendMail } from "../services/mailer";
import { canManageRegistrations } from "../services/registration";
import {
  isActiveApprovedAdmin,
  nextCredentialFailure,
  removesActiveApprovedAdmin,
  shouldBlockAdminMutation,
  successorEligibilityError,
  transferRoleSequence,
  type TransferCandidateState,
  type TransferMode,
} from "../services/admin-transfer";

export const adminRoutes = new Hono<AppContext>();

adminRoutes.use("*", async (c, next) => {
  if (!canManageRegistrations(c.get("user").role)) return c.json({ error: "僅限管理員" }, 403);
  return next();
});

adminRoutes.get("/users", async (c) => {
  const [result, activeAdminCount] = await Promise.all([
    c.env.DB.prepare("SELECT u.id,u.email,u.name,u.role,u.group_id,u.must_change_password,u.email_notifications,u.is_active,u.is_demo,u.approval_status,u.created_at,g.name AS group_name FROM users u JOIN groups g ON g.id=u.group_id ORDER BY CASE u.approval_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,u.is_active DESC,u.name").all(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved'").first<number>("value"),
  ]);
  return c.json({ users: result.results, active_admin_count: activeAdminCount ?? 0 });
});

adminRoutes.get("/transfer/candidates", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.role,g.name AS group_name
    FROM users u JOIN groups g ON g.id=u.group_id
    WHERE u.is_active=1 AND u.approval_status='approved' AND u.role!='admin'
    ORDER BY u.name,u.email
  `).all();
  return c.json({ candidates: result.results });
});

adminRoutes.post("/transfer", async (c) => {
  const body: { successor_id?: unknown; mode?: unknown; password?: unknown } = await c.req.json().catch(() => ({}));
  const successorId = typeof body.successor_id === "string" ? body.successor_id : "";
  const mode = body.mode;
  const password = typeof body.password === "string" ? body.password : "";
  if (!successorId || (mode !== "co_admin" && mode !== "full_transfer") || !password) return c.json({ error: "請選擇接班人、模式並輸入目前密碼" }, 422);

  const currentUser = c.get("user");
  const actor = await c.env.DB.prepare("SELECT id,email,name,password_hash,role,is_active,approval_status,failed_count,locked_until FROM users WHERE id=?")
    .bind(currentUser.id).first<{ id: string; email: string; name: string; password_hash: string; role: Role; is_active: number; approval_status: "pending" | "approved" | "rejected"; failed_count: number; locked_until: string | null }>();
  if (!actor || !isActiveApprovedAdmin(actor)) return c.json({ error: "僅限啟用且已核准的管理員" }, 403);
  if (actor.locked_until && new Date(actor.locked_until).getTime() > Date.now()) return c.json({ error: "密碼驗證失敗次數過多，請稍後再試" }, 423);
  if (!(await verifyPassword(password, actor.password_hash))) {
    const failure = nextCredentialFailure(actor.failed_count);
    await c.env.DB.prepare("UPDATE users SET failed_count=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(failure.failedCount, failure.lockedUntil, actor.id).run();
    return c.json({ error: "目前密碼不正確" }, 403);
  }

  const successor = await c.env.DB.prepare("SELECT id,email,name,role,is_active,approval_status FROM users WHERE id=?")
    .bind(successorId).first<{ id: string; email: string; name: string; role: Role; is_active: number; approval_status: "pending" | "approved" | "rejected" }>();
  const eligibilityError = successorEligibilityError(successor as TransferCandidateState | null, actor.id);
  if (eligibilityError || !successor) return c.json({ error: eligibilityError ?? "接班人不存在或不符合資格" }, 422);

  const transferMode = mode as TransferMode;
  const changes = transferRoleSequence(transferMode, actor.id, successor.id);
  const auditId = createId("audit");
  const successorNotificationId = createId("noti");
  const actorNotificationId = createId("noti");
  const auditSummary = `管理權移轉 mode=${transferMode} from=${actor.email} to=${successor.email}`;
  const actorBody = transferMode === "full_transfer"
    ? `管理權已完全移轉給 ${successor.name}，你的角色已調整為正職成員。`
    : `${successor.name} 已升為共同管理員，你仍保有管理權。`;
  const statements = changes.map((change) => c.env.DB.prepare("UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(change.role, change.id));
  statements.push(
    c.env.DB.prepare("UPDATE users SET failed_count=0,locked_until=NULL WHERE id=?").bind(actor.id),
    c.env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,'admin_transfer','你已成為管理員',?,'/admin')").bind(successorNotificationId, successor.id, `${actor.name} 已將管理權授予你。`),
    c.env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,'admin_transfer','管理權已移轉',?,'/')").bind(actorNotificationId, actor.id, actorBody),
    c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'admin_transfer','user',?,?)").bind(auditId, actor.id, successor.id, auditSummary),
  );
  await c.env.DB.batch(statements);

  const mailResults = { successor: false, current: false };
  try {
    mailResults.successor = (await sendMail(c.env, successor.email, "[艾爾水晶] 你已成為管理員", `您好 ${successor.name}，${actor.name} 已將管理權授予你。\n\n${c.env.APP_BASE_URL}/admin`)).sent;
  } catch (error) {
    console.error(JSON.stringify({ message: "successor transfer email failed", error: error instanceof Error ? error.message : "unknown" }));
  }
  try {
    mailResults.current = (await sendMail(c.env, actor.email, "[艾爾水晶] 管理權已移轉", `您好 ${actor.name}，${actorBody}\n\n${c.env.APP_BASE_URL}`)).sent;
  } catch (error) {
    console.error(JSON.stringify({ message: "current admin transfer email failed", error: error instanceof Error ? error.message : "unknown" }));
  }
  return c.json({ ok: true, mode: transferMode, successor: { id: successor.id, name: successor.name, email: successor.email }, email_sent: mailResults });
});

adminRoutes.get("/registrations", async (c) => {
  const [rows, enabled] = await Promise.all([
    c.env.DB.prepare(`
      SELECT u.id,u.name,u.email,u.role,u.group_id,u.created_at,g.name AS group_name
      FROM users u JOIN groups g ON g.id=u.group_id
      WHERE u.approval_status='pending'
      ORDER BY u.created_at
    `).all(),
    c.env.DB.prepare("SELECT value FROM app_settings WHERE key='registration_enabled'").first<string>("value"),
  ]);
  return c.json({ registrations: rows.results, enabled: enabled === "1" });
});

adminRoutes.post("/registrations/:userId/approve", async (c) => {
  const body: { role?: string; group_id?: string } = await c.req.json().catch(() => ({}));
  const registration = await c.env.DB.prepare("SELECT id,name,email,role,group_id,approval_status FROM users WHERE id=?")
    .bind(c.req.param("userId")).first<{ id: string; name: string; email: string; role: Role; group_id: string; approval_status: string }>();
  if (!registration) return c.json({ error: "找不到註冊申請" }, 404);
  if (registration.approval_status !== "pending") return c.json({ error: "此申請已處理" }, 422);
  const role = (body.role ?? registration.role) as Role;
  const groupId = body.group_id ?? registration.group_id;
  if (!(["member", "intern"] as string[]).includes(role)) return c.json({ error: "核准角色只能是正職成員或實習生" }, 422);
  const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id=?").bind(groupId).first();
  if (!group) return c.json({ error: "所選組別不存在" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET approval_status='approved',role=?,group_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND approval_status='pending'").bind(role, groupId, registration.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(registration.id),
  ]);
  await writeAudit(c.env.DB, c.get("user"), "registration_approved", "user", registration.id, `核准註冊 ${registration.email}（${role}）`);
  let emailSent = false;
  try {
    emailSent = (await sendMail(c.env, registration.email, "[艾爾水晶] 帳號已核准", `您好 ${registration.name}，您的帳號已核准，現在可以登入。\n\n${c.env.APP_BASE_URL}/login`)).sent;
  } catch (error) {
    console.error(JSON.stringify({ message: "registration approval email failed", error: error instanceof Error ? error.message : "unknown" }));
  }
  return c.json({ ok: true, email_sent: emailSent });
});

adminRoutes.post("/registrations/:userId/reject", async (c) => {
  const registration = await c.env.DB.prepare("SELECT id,name,email,approval_status FROM users WHERE id=?")
    .bind(c.req.param("userId")).first<{ id: string; name: string; email: string; approval_status: string }>();
  if (!registration) return c.json({ error: "找不到註冊申請" }, 404);
  if (registration.approval_status !== "pending") return c.json({ error: "此申請已處理" }, 422);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET approval_status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND approval_status='pending'").bind(registration.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(registration.id),
  ]);
  await writeAudit(c.env.DB, c.get("user"), "registration_rejected", "user", registration.id, `拒絕註冊 ${registration.email}`);
  let emailSent = false;
  try {
    emailSent = (await sendMail(c.env, registration.email, "[艾爾水晶] 註冊申請結果", `您好 ${registration.name}，很抱歉，您的帳號申請未通過。如有疑問，請聯絡系統管理員。`)).sent;
  } catch (error) {
    console.error(JSON.stringify({ message: "registration rejection email failed", error: error instanceof Error ? error.message : "unknown" }));
  }
  return c.json({ ok: true, email_sent: emailSent });
});

adminRoutes.post("/registration-toggle", async (c) => {
  const body: { enabled?: unknown } = await c.req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return c.json({ error: "enabled 必須是布林值" }, 422);
  await c.env.DB.prepare("INSERT INTO app_settings (key,value) VALUES ('registration_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(body.enabled ? "1" : "0").run();
  await writeAudit(c.env.DB, c.get("user"), "registration_toggle", "setting", "registration_enabled", body.enabled ? "開放自助註冊" : "關閉自助註冊");
  return c.json({ enabled: body.enabled });
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
  const current = await c.env.DB.prepare("SELECT name,email,role,group_id,is_active,email_notifications,approval_status FROM users WHERE id=?").bind(c.req.param("id")).first<{ name: string; email: string; role: Role; group_id: string; is_active: number; email_notifications: number; approval_status: "pending" | "approved" | "rejected" }>();
  if (!current) return c.json({ error: "找不到使用者" }, 404);
  const nextRole = optionalString(body, "role") ?? current.role;
  if (!["admin", "member", "intern"].includes(nextRole)) return c.json({ error: "角色不正確" }, 422);
  const nextIsActive = "is_active" in body ? (body.is_active ? 1 : 0) : current.is_active;
  const activeAdminCount = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved'").first<number>("value") ?? 0;
  if (shouldBlockAdminMutation(current, nextRole as Role, nextIsActive, activeAdminCount)) return c.json({ error: "系統至少需要一名管理員" }, 422);
  const removesAdmin = removesActiveApprovedAdmin(current, nextRole as Role, nextIsActive) ? 1 : 0;
  const result = await c.env.DB.prepare(`
    UPDATE users SET name=?,email=?,role=?,group_id=?,is_active=?,email_notifications=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND (?=0 OR (SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved')>1)
  `).bind(optionalString(body, "name") ?? current.name, optionalString(body, "email")?.toLowerCase() ?? current.email, nextRole, optionalString(body, "group_id") ?? current.group_id, nextIsActive, "email_notifications" in body ? (body.email_notifications ? 1 : 0) : current.email_notifications, c.req.param("id"), removesAdmin).run();
  if (removesAdmin && result.meta.changes === 0) return c.json({ error: "系統至少需要一名管理員" }, 422);
  await writeAudit(c.env.DB, c.get("user"), "update", "user", c.req.param("id"), "更新帳號資料");
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  if (c.req.param("id") === c.get("user").id) return c.json({ error: "不可停用目前登入帳號" }, 422);
  const target = await c.env.DB.prepare("SELECT email,role,is_active,approval_status FROM users WHERE id=?").bind(c.req.param("id")).first<{ email: string; role: Role; is_active: number; approval_status: "pending" | "approved" | "rejected" }>();
  if (!target) return c.json({ error: "找不到使用者" }, 404);
  if (target.approval_status === "pending" || target.approval_status === "rejected") {
    await c.env.DB.prepare("DELETE FROM users WHERE id=?").bind(c.req.param("id")).run();
    await writeAudit(c.env.DB, c.get("user"), "delete", "user", c.req.param("id"), `刪除未核准帳號 ${target.email}`);
    return c.json({ ok: true, deleted: true });
  }
  const activeAdminCount = await c.env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved'").first<number>("value") ?? 0;
  if (shouldBlockAdminMutation(target, target.role, 0, activeAdminCount)) return c.json({ error: "系統至少需要一名管理員" }, 422);
  const removesAdmin = isActiveApprovedAdmin(target) ? 1 : 0;
  const result = await c.env.DB.prepare("UPDATE users SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (?=0 OR (SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1 AND approval_status='approved')>1)")
    .bind(c.req.param("id"), removesAdmin).run();
  if (removesAdmin && result.meta.changes === 0) return c.json({ error: "系統至少需要一名管理員" }, 422);
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
  const cleanup = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM projects WHERE is_demo=1"),
    c.env.DB.prepare(`
      DELETE FROM users WHERE is_demo=1 AND (
        role!='admin' OR is_active!=1 OR approval_status!='approved'
        OR EXISTS (SELECT 1 FROM users AS keeper WHERE keeper.is_demo=0 AND keeper.role='admin' AND keeper.is_active=1 AND keeper.approval_status='approved')
      )
    `),
  ]);
  const deletedProjects = cleanup[0]?.meta.changes ?? 0;
  const deletedUsers = cleanup[1]?.meta.changes ?? 0;
  const preservedUsers = demoUsers.results.length - deletedUsers;
  await writeAudit(c.env.DB, c.get("user"), "clear_demo", "system", "demo", `清除 ${deletedProjects} 個專案與 ${deletedUsers} 個帳號${preservedUsers ? `；為保留最後管理員而略過 ${preservedUsers} 個帳號` : ""}`);
  return c.json({ deleted_projects: deletedProjects, deleted_users: deletedUsers, preserved_users: preservedUsers });
});

adminRoutes.post("/test-email", async (c) => {
  const user = c.get("user");
  const result = await sendMail(c.env, user.email, "[艾爾水晶] 測試信", `您好 ${user.name}，這是艾爾水晶-專案進度的寄信功能測試。\n\n${c.env.APP_BASE_URL}`);
  return c.json(result, result.sent ? 200 : 503);
});
