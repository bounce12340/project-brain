import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, writeAudit } from "../services/db";
import { isValidEmail } from "../services/registration";

/**
 * 聯絡人資料庫：外部醫院、公司的窗口。
 * 所有登入的人都能查看、新增與修改（大家一起維護才會是最新的）；刪除限建立的人與管理員。
 * 每一筆新增、修改、刪除都記稽核紀錄。同一個機構的同一個人不重複建立。
 */
export const contactsRoutes = new Hono<AppContext>();

export const CONTACT_FIELDS = {
  organization: 100,
  department: 100,
  name: 60,
  title: 60,
  phone: 60,
  mobile: 60,
  email: 200,
  address: 300,
  notes: 2000,
} as const;
type ContactField = keyof typeof CONTACT_FIELDS;
const LABELS: Record<ContactField, string> = { organization: "醫院／公司", department: "部門", name: "姓名", title: "職稱", phone: "電話", mobile: "手機", email: "Email", address: "地址", notes: "備註" };
const REQUIRED: ContactField[] = ["organization", "name"];

interface ContactRow { id: string; organization: string; name: string; created_by: string | null }

/** 只收認得的欄位；去頭尾空白，單行欄位的連續空白併成一個。回傳錯誤或整理好的值。 */
function cleanFields(body: Record<string, unknown>, partial: boolean): { error: string } | { values: Partial<Record<ContactField, string>> } {
  const values: Partial<Record<ContactField, string>> = {};
  for (const [field, max] of Object.entries(CONTACT_FIELDS) as Array<[ContactField, number]>) {
    if (!(field in body)) {
      if (!partial && REQUIRED.includes(field)) return { error: `請填寫${LABELS[field]}` };
      continue;
    }
    const raw = body[field];
    if (raw !== null && raw !== undefined && typeof raw !== "string") return { error: `${LABELS[field]}格式不正確` };
    const text = (raw ?? "").normalize("NFC");
    const value = field === "notes" || field === "address" ? text.trim() : text.replace(/\s+/g, " ").trim();
    if (REQUIRED.includes(field) && !value) return { error: `請填寫${LABELS[field]}` };
    if ([...value].length > max) return { error: `${LABELS[field]}不能超過 ${max} 字` };
    if (field === "email" && value && !isValidEmail(value.toLowerCase())) return { error: "Email 格式不正確" };
    values[field] = field === "email" ? value.toLowerCase() : value;
  }
  return { values };
}

async function findDuplicate(db: D1Database, organization: string, name: string, exceptId = ""): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM contacts WHERE lower(organization)=lower(?) AND lower(name)=lower(?) AND id<>?").bind(organization, name, exceptId).first());
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

const duplicateError = (organization: string, name: string) => `「${organization}」已經有「${name}」這位聯絡人，要更新請直接編輯那一筆。`;

contactsRoutes.get("/contacts", async (c) => {
  const result = await c.env.DB.prepare(`SELECT ct.*, cu.name AS created_by_name, uu.name AS updated_by_name
    FROM contacts ct LEFT JOIN users cu ON cu.id=ct.created_by LEFT JOIN users uu ON uu.id=ct.updated_by
    ORDER BY ct.organization COLLATE NOCASE, ct.name COLLATE NOCASE LIMIT 5000`).all();
  return c.json({ contacts: result.results });
});

contactsRoutes.post("/contacts", async (c) => {
  const user = c.get("user");
  const cleaned = cleanFields(await readObject(c.req.raw), false);
  if ("error" in cleaned) return c.json({ error: cleaned.error }, 422);
  const values = cleaned.values as Record<ContactField, string>;
  if (await findDuplicate(c.env.DB, values.organization, values.name)) return c.json({ error: duplicateError(values.organization, values.name) }, 409);
  const id = createId("contact");
  const fields = Object.keys(CONTACT_FIELDS) as ContactField[];
  await c.env.DB.prepare(`INSERT INTO contacts (id,${fields.join(",")},created_by,updated_by) VALUES (?,${fields.map(() => "?").join(",")},?,?)`)
    .bind(id, ...fields.map((field) => values[field] ?? ""), user.id, user.id).run();
  await writeAudit(c.env.DB, user, "create", "contact", id, `新增聯絡人「${values.organization}／${values.name}」`);
  return c.json({ id }, 201);
});

contactsRoutes.patch("/contacts/:id", async (c) => {
  const user = c.get("user");
  const current = await c.env.DB.prepare("SELECT id,organization,name,created_by FROM contacts WHERE id=?").bind(c.req.param("id")).first<ContactRow>();
  if (!current) return c.json({ error: "找不到聯絡人" }, 404);
  const cleaned = cleanFields(await readObject(c.req.raw), true);
  if ("error" in cleaned) return c.json({ error: cleaned.error }, 422);
  const changes = Object.entries(cleaned.values) as Array<[ContactField, string]>;
  if (!changes.length) return c.json({ ok: true });
  const organization = cleaned.values.organization ?? current.organization;
  const name = cleaned.values.name ?? current.name;
  if (await findDuplicate(c.env.DB, organization, name, current.id)) return c.json({ error: duplicateError(organization, name) }, 409);
  await c.env.DB.prepare(`UPDATE contacts SET ${changes.map(([field]) => `${field}=?`).join(",")},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(...changes.map(([, value]) => value), user.id, current.id).run();
  await writeAudit(c.env.DB, user, "update", "contact", current.id, `更新聯絡人「${organization}／${name}」：${changes.map(([field]) => LABELS[field]).join("、")}`);
  return c.json({ ok: true });
});

contactsRoutes.delete("/contacts/:id", async (c) => {
  const user = c.get("user");
  const current = await c.env.DB.prepare("SELECT id,organization,name,created_by FROM contacts WHERE id=?").bind(c.req.param("id")).first<ContactRow>();
  if (!current) return c.json({ error: "找不到聯絡人" }, 404);
  if (user.role !== "admin" && current.created_by !== user.id) return c.json({ error: "只有建立這筆聯絡人的人或管理員可以刪除" }, 403);
  await c.env.DB.prepare("DELETE FROM contacts WHERE id=?").bind(current.id).run();
  await writeAudit(c.env.DB, user, "delete", "contact", current.id, `刪除聯絡人「${current.organization}／${current.name}」`);
  return c.json({ ok: true });
});
