import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId } from "../services/db";
import { ImportValidationError, runAdminImport } from "../services/import-data";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const importRoutes = new Hono<AppContext>();

importRoutes.use("*", async (c, next) => c.get("user").role === "admin" ? next() : c.json({ error: "僅限管理員" }, 403));

importRoutes.post("/import", async (c) => {
  const contentLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) return c.json({ error: "匯入內容不可超過 5 MB" }, 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) return c.json({ error: "匯入內容不可超過 5 MB" }, 413);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return c.json({ error: "JSON 格式不正確" }, 422); }
  try {
    const result = await runAdminImport(c.env.DB, c.get("user"), payload);
    await c.env.DB.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,'batch_import','system','import',?)")
      .bind(createId("audit"), c.get("user").id, JSON.stringify(result)).run();
    return c.json(result);
  } catch (error) {
    if (error instanceof ImportValidationError) return c.json({ error: error.message }, 422);
    throw error;
  }
});
