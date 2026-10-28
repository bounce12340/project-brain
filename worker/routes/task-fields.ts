import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, getProjectAccess, touchProject, writeAudit } from "../services/db";
import { canEditProgress } from "../services/permissions";
import { FIELD_TYPES, MAX_FIELDS, cleanFieldName, cleanFieldValue, cleanOptions, projectFields, type FieldType } from "../services/task-fields";

/**
 * 任務自訂欄位（像 Asana 的 custom fields）：每個專案自己定義，能編輯專案的人就能新增、修改欄位與填值。
 * 欄位刪除時值一起刪；單選拿掉某個選項時，選了那個選項的值也清掉。
 */
export const taskFieldsRoutes = new Hono<AppContext>();

async function fieldWithAccess(c: { env: Env; get(key: "user"): AppContext["Variables"]["user"] }, fieldId: string) {
  const field = await c.env.DB.prepare("SELECT id,project_id,name,type,options_json,position FROM task_fields WHERE id=?").bind(fieldId)
    .first<{ id: string; project_id: string; name: string; type: FieldType; options_json: string; position: number }>();
  if (!field) return { error: "找不到欄位", status: 404 as const };
  const access = await getProjectAccess(c.env.DB, field.project_id);
  if (!access || !canEditProgress(c.get("user"), access)) return { error: "沒有編輯權限", status: 403 as const };
  return { field };
}

taskFieldsRoutes.post("/projects/:id/task-fields", async (c) => {
  const projectId = c.req.param("id");
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access) return c.json({ error: "找不到專案" }, 404);
  if (!canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const name = cleanFieldName(body.name);
  if (typeof name === "object") return c.json(name, 422);
  const type = String(body.type ?? "text") as FieldType;
  if (!FIELD_TYPES.includes(type)) return c.json({ error: "欄位類型只能是文字、數字、日期或單選" }, 422);
  const options = type === "select" ? cleanOptions(body.options) : [];
  if (!Array.isArray(options)) return c.json(options, 422);
  const existing = await projectFields(c.env.DB, projectId);
  if (existing.length >= MAX_FIELDS) return c.json({ error: `一個專案最多 ${MAX_FIELDS} 個自訂欄位` }, 422);
  if (existing.some((field) => field.name === name)) return c.json({ error: `已經有「${name}」這個欄位` }, 422);
  const id = createId("fld");
  await c.env.DB.prepare("INSERT INTO task_fields (id,project_id,name,type,options_json,position) VALUES (?,?,?,?,?,?)")
    .bind(id, projectId, name, type, JSON.stringify(options), existing.length).run();
  await touchProject(c.env.DB, projectId);
  await writeAudit(c.env.DB, c.get("user"), "task_field_created", "project", projectId, `新增任務欄位「${name}」`);
  return c.json({ id }, 201);
});

taskFieldsRoutes.patch("/task-fields/:id", async (c) => {
  const found = await fieldWithAccess(c, c.req.param("id"));
  if ("error" in found) return c.json({ error: found.error }, found.status);
  const { field } = found;
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  let name = field.name;
  if ("name" in body) {
    const cleaned = cleanFieldName(body.name);
    if (typeof cleaned === "object") return c.json(cleaned, 422);
    if (cleaned !== field.name && await c.env.DB.prepare("SELECT 1 FROM task_fields WHERE project_id=? AND name=? AND id!=?").bind(field.project_id, cleaned, field.id).first()) {
      return c.json({ error: `已經有「${cleaned}」這個欄位` }, 422);
    }
    name = cleaned;
  }
  let optionsJson = field.options_json;
  const statements: D1PreparedStatement[] = [];
  if ("options" in body && field.type === "select") {
    const options = cleanOptions(body.options);
    if (!Array.isArray(options)) return c.json(options, 422);
    optionsJson = JSON.stringify(options);
    // 拿掉的選項：已經選了它的任務清成未填。
    statements.push(c.env.DB.prepare(`DELETE FROM task_field_values WHERE field_id=? AND value NOT IN (${options.map(() => "?").join(",")})`).bind(field.id, ...options));
  }
  const position = "position" in body && Number.isInteger(body.position) ? Number(body.position) : field.position;
  statements.unshift(c.env.DB.prepare("UPDATE task_fields SET name=?,options_json=?,position=? WHERE id=?").bind(name, optionsJson, position, field.id));
  await c.env.DB.batch(statements);
  await touchProject(c.env.DB, field.project_id);
  return c.json({ ok: true });
});

taskFieldsRoutes.delete("/task-fields/:id", async (c) => {
  const found = await fieldWithAccess(c, c.req.param("id"));
  if ("error" in found) return c.json({ error: found.error }, found.status);
  await c.env.DB.prepare("DELETE FROM task_fields WHERE id=?").bind(found.field.id).run();
  await touchProject(c.env.DB, found.field.project_id);
  await writeAudit(c.env.DB, c.get("user"), "task_field_deleted", "project", found.field.project_id, `刪除任務欄位「${found.field.name}」`);
  return c.json({ ok: true });
});

/** 填任務的欄位值：body 是 { 欄位 id: 值 }，null 或空字串代表清除；沒列到的欄位不動。 */
taskFieldsRoutes.put("/tasks/:id/fields", async (c) => {
  const taskId = c.req.param("id");
  const projectId = await c.env.DB.prepare("SELECT project_id FROM tasks WHERE id=?").bind(taskId).first<string>("project_id");
  if (!projectId) return c.json({ error: "找不到任務" }, 404);
  const access = await getProjectAccess(c.env.DB, projectId);
  if (!access || !canEditProgress(c.get("user"), access)) return c.json({ error: "沒有編輯權限" }, 403);
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "欄位格式不正確" }, 422);
  const fields = new Map((await projectFields(c.env.DB, projectId)).map((field) => [field.id, field]));
  const statements: D1PreparedStatement[] = [];
  for (const [fieldId, raw] of Object.entries(body)) {
    const field = fields.get(fieldId);
    if (!field) return c.json({ error: "欄位不屬於此專案" }, 422);
    const cleaned = cleanFieldValue(field, raw);
    if ("error" in cleaned) return c.json(cleaned, 422);
    statements.push(cleaned.value === null
      ? c.env.DB.prepare("DELETE FROM task_field_values WHERE task_id=? AND field_id=?").bind(taskId, fieldId)
      : c.env.DB.prepare("INSERT INTO task_field_values (task_id,field_id,value) VALUES (?,?,?) ON CONFLICT(task_id,field_id) DO UPDATE SET value=excluded.value").bind(taskId, fieldId, cleaned.value));
  }
  if (statements.length) await c.env.DB.batch(statements);
  await touchProject(c.env.DB, projectId);
  return c.json({ ok: true });
});
