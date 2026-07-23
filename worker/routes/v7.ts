import { extractText, getDocumentProxy } from "unpdf";
import { Hono } from "hono";
import type { AppContext } from "../types";
import { createId, writeAudit } from "../services/db";
import { r2FileStore } from "../services/filestore";
import { isIsoDate } from "../services/importer";
import { canManageRegwatch } from "../services/regwatch";
import {
  REGWATCH_PRODUCT_LINES,
  combineRegwatchFileTexts,
  ensurePdfText,
  ensureRegwatchTextLimit,
  extractRegwatchEntries,
  markRegwatchDuplicates,
  normalizeRegwatchExtractMode,
  type RegwatchExtractMode,
  type RegwatchExtractedEntry,
} from "../services/regwatch-ai";

export const v7Routes = new Hono<AppContext>();

const maxFileBytes = 10 * 1024 * 1024;
const maxTotalFileBytes = 25 * 1024 * 1024;
const maxFiles = 5;
const productLines = new Set<string>(REGWATCH_PRODUCT_LINES);

interface ExtractInput {
  text: string;
  sourceLink: string | null;
  files: File[];
  mode: RegwatchExtractMode;
}

function safeFilename(name: string): string {
  return name.replace(/[\\/]/g, "_").trim() || "regwatch-source";
}

async function readExtractInput(request: Request): Promise<ExtractInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const files = [...form.getAll("files"), ...form.getAll("file")]
      .filter((value): value is File => value instanceof File && value.size > 0);
    const pastedText = typeof form.get("text") === "string" ? String(form.get("text")) : "";
    const sourceLink = typeof form.get("source_link") === "string" && String(form.get("source_link")).trim() ? String(form.get("source_link")).trim() : null;
    const mode = normalizeRegwatchExtractMode(form.get("mode"));
    if (files.length && pastedText.trim()) throw new Error("MULTIPLE_INPUTS");
    if (!files.length) return { text: pastedText, sourceLink, files: [], mode };
    validateSourceFiles(files);
    const texts: Array<{ name: string; text: string }> = [];
    for (const file of files) {
      const extension = file.name.toLocaleLowerCase().endsWith(".pdf") ? "pdf" : "txt";
      if (extension === "txt") {
        texts.push({ name: safeFilename(file.name), text: await file.text() });
        continue;
      }
      try {
        const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
        const result = await extractText(pdf, { mergePages: false });
        texts.push({ name: safeFilename(file.name), text: ensurePdfText(result.text.join("\f")) });
      } catch (error) {
        if (error instanceof Error && error.message === "PDF_NO_TEXT") throw error;
        throw new Error("INVALID_PDF");
      }
    }
    return { text: combineRegwatchFileTexts(texts), sourceLink, files, mode };
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  return {
    text: typeof body.text === "string" ? body.text : "",
    sourceLink: typeof body.source_link === "string" && body.source_link.trim() ? body.source_link.trim() : null,
    files: [],
    mode: normalizeRegwatchExtractMode(body.mode),
  };
}

function validateSourceFiles(files: File[]): void {
  if (files.length > maxFiles) throw new Error("TOO_MANY_FILES");
  if (files.some((file) => file.size > maxFileBytes)) throw new Error("FILE_TOO_LARGE");
  if (files.reduce((total, file) => total + file.size, 0) > maxTotalFileBytes) throw new Error("FILES_TOO_LARGE");
  if (files.some((file) => !/\.(?:txt|pdf)$/i.test(file.name))) throw new Error("INVALID_FILE_TYPE");
}

async function existingRegwatchKeys(db: D1Database, entries: RegwatchExtractedEntry[]): Promise<Set<string>> {
  const dates = [...new Set(entries.map((entry) => entry.entry_date))];
  const keys = new Set<string>();
  for (let start = 0; start < dates.length; start += 50) {
    const slice = dates.slice(start, start + 50);
    const rows = await db.prepare(`SELECT entry_date,title FROM reg_entries WHERE entry_date IN (${slice.map(() => "?").join(",")})`).bind(...slice).all<{ entry_date: string; title: string }>();
    for (const row of rows.results) keys.add(`${row.entry_date}\u0000${row.title}`);
  }
  return keys;
}

async function saveSourceFile(env: Env, userId: string, file: File): Promise<{ id: string; storageKey: string }> {
  const id = createId("file");
  const filename = safeFilename(file.name);
  const storageKey = `regwatch/${id}/${filename}`;
  const contentType = file.type || (filename.toLocaleLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain");
  const store = r2FileStore(env.FILES);
  await store.put(storageKey, file, contentType);
  try {
    await env.DB.prepare("INSERT INTO files (id,project_id,task_id,filename,size,content_type,storage_key,uploaded_by) VALUES (?,NULL,NULL,?,?,?,?,?)")
      .bind(id, filename, file.size, contentType, storageKey, userId).run();
  } catch (error) {
    await store.delete(storageKey);
    throw error;
  }
  return { id, storageKey };
}

async function cleanupSourceFiles(env: Env, files: Array<{ id: string; storageKey: string }>): Promise<void> {
  for (const file of files) {
    await env.FILES.delete(file.storageKey);
    await env.DB.prepare("DELETE FROM files WHERE id=?").bind(file.id).run();
  }
}

v7Routes.post("/regwatch/ai-extract", async (c) => {
  const user = c.get("user");
  if (!canManageRegwatch(user)) return c.json({ error: "僅 RA/PV 組成員與管理員可使用 AI 匯入" }, 403);
  let input: ExtractInput;
  try {
    input = await readExtractInput(c.req.raw);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "TOO_MANY_FILES") return c.json({ error: "一次最多上傳 5 個檔案" }, 422);
    if (code === "FILE_TOO_LARGE") return c.json({ error: "單一檔案不可超過 10 MB" }, 422);
    if (code === "FILES_TOO_LARGE") return c.json({ error: "檔案總量不可超過 25 MB" }, 422);
    if (code === "INVALID_FILE_TYPE") return c.json({ error: "僅支援 .txt 或 .pdf 檔案" }, 422);
    if (code === "MULTIPLE_INPUTS") return c.json({ error: "請擇一貼上文字或上傳檔案" }, 422);
    if (code === "PDF_NO_TEXT") return c.json({ error: "此 PDF 無文字層，請貼上文字或提供文字版" }, 422);
    if (code === "INVALID_PDF") return c.json({ error: "無法讀取 PDF，請確認檔案含可擷取的文字層" }, 422);
    throw error;
  }
  const text = input.text.trim();
  if (!text) return c.json({ error: "請貼上公告文字或上傳檔案" }, 422);
  try { ensureRegwatchTextLimit(text); } catch { return c.json({ error: "文字內容不可超過 120,000 字元" }, 422); }
  try {
    const extracted = await extractRegwatchEntries(c.env, text, input.mode);
    if (!extracted.length) return c.json({ error: "AI 服務暫時無法使用，可改用手動新增" }, 502);
    const entries = markRegwatchDuplicates(extracted.map((entry) => ({ ...entry, link: input.sourceLink ?? undefined })), await existingRegwatchKeys(c.env.DB, extracted));
    return c.json({ entries });
  } catch (error) {
    console.error(JSON.stringify({ message: "regwatch ai extract failed", error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: "AI 服務暫時無法使用，可改用手動新增" }, 502);
  }
});

function validateBatchEntry(value: unknown): RegwatchExtractedEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const date = typeof item.entry_date === "string" ? item.entry_date : "";
  const type = item.entry_type === "meeting" ? "meeting" : item.entry_type === "announcement" ? "announcement" : null;
  const line = typeof item.product_line === "string" && productLines.has(item.product_line) ? item.product_line as RegwatchExtractedEntry["product_line"] : null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const category = typeof item.category === "string" ? item.category.trim() : "";
  const keyPoints = typeof item.key_points === "string" ? item.key_points.trim() : "";
  const link = typeof item.link === "string" && item.link.trim() ? item.link.trim() : undefined;
  if (!isIsoDate(date) || !type || !line || !title || title.length > 100 || category.length > 10) return null;
  return { entry_date: date, entry_type: type, product_line: line, category, title, key_points: keyPoints, link };
}

v7Routes.post("/regwatch/batch", async (c) => {
  const user = c.get("user");
  if (!canManageRegwatch(user)) return c.json({ error: "僅 RA/PV 組成員與管理員可使用 AI 匯入" }, 403);
  const contentType = c.req.header("content-type") ?? "";
  let rawEntries: unknown;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.raw.formData();
    const entryText = form.get("entries");
    try { rawEntries = typeof entryText === "string" ? JSON.parse(entryText) : null; }
    catch { return c.json({ error: "匯入條目 JSON 格式不正確" }, 422); }
    files = [...form.getAll("files"), ...form.getAll("file")]
      .filter((value): value is File => value instanceof File && value.size > 0);
    try { validateSourceFiles(files); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "TOO_MANY_FILES") return c.json({ error: "一次最多上傳 5 個檔案" }, 422);
      if (code === "FILE_TOO_LARGE") return c.json({ error: "單一檔案不可超過 10 MB" }, 422);
      if (code === "FILES_TOO_LARGE") return c.json({ error: "檔案總量不可超過 25 MB" }, 422);
      return c.json({ error: "原始檔須為 .txt 或 .pdf" }, 422);
    }
    if (!files.length) return c.json({ error: "請至少上傳一個原始檔" }, 422);
  } else {
    const body = await c.req.json().catch(() => ({})) as { entries?: unknown };
    rawEntries = body.entries;
  }
  if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > 500) return c.json({ error: "匯入條目須為 1 至 500 筆" }, 422);
  const entries = rawEntries.map(validateBatchEntry);
  if (entries.some((entry) => entry === null)) return c.json({ error: "匯入條目欄位不合規" }, 422);
  const savedFiles: Array<{ id: string; storageKey: string }> = [];
  try {
    for (const file of files) savedFiles.push(await saveSourceFile(c.env, user.id, file));
  } catch (error) {
    await cleanupSourceFiles(c.env, savedFiles);
    throw error;
  }
  const fileId = savedFiles[0]?.id ?? null;
  const pendingEntries = (entries as RegwatchExtractedEntry[]).map((entry) => ({ id: createId("reg"), entry }));
  const statements = pendingEntries.map(({ id, entry }) => c.env.DB.prepare("INSERT OR IGNORE INTO reg_entries (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by,file_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, entry.entry_date, entry.entry_type, entry.product_line, entry.category || null, entry.title, entry.key_points || null, entry.link || null, user.id, fileId));
  let results: D1Result[];
  try {
    results = await c.env.DB.batch(statements);
  } catch (error) {
    await cleanupSourceFiles(c.env, savedFiles);
    throw error;
  }
  const created = results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  const skipped = entries.length - created;
  const createdEntryIds = pendingEntries.filter((_, index) => (results[index].meta.changes ?? 0) > 0).map(({ id }) => id);
  if (savedFiles.length && createdEntryIds.length) {
    try {
      await c.env.DB.batch(createdEntryIds.flatMap((entryId) => savedFiles.map((file, position) => c.env.DB.prepare("INSERT INTO reg_entry_files (entry_id,file_id,position) VALUES (?,?,?)").bind(entryId, file.id, position))));
    } catch (error) {
      await c.env.DB.batch(createdEntryIds.map((entryId) => c.env.DB.prepare("DELETE FROM reg_entries WHERE id=?").bind(entryId)));
      await cleanupSourceFiles(c.env, savedFiles);
      throw error;
    }
  } else if (savedFiles.length) {
    await cleanupSourceFiles(c.env, savedFiles);
  }
  await writeAudit(c.env.DB, user, "regwatch_ai_import", "reg_entry", created > 0 && fileId ? fileId : "batch", `AI 匯入法規動態：created=${created}, skipped=${skipped}, files=${created > 0 ? savedFiles.length : 0}`);
  return c.json({ created, skipped, file_id: created > 0 ? fileId : null, file_ids: created > 0 ? savedFiles.map((file) => file.id) : [] });
});
