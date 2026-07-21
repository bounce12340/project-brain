import { llmChat, parseLooseJson } from "./llm";

export const REGWATCH_PRODUCT_LINES = ["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"] as const;
export const REGWATCH_TEXT_CHUNK_LIMIT = 24_000;
export const REGWATCH_TEXT_TOTAL_LIMIT = 120_000;

const productLineSet = new Set<string>(REGWATCH_PRODUCT_LINES);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export interface RegwatchExtractedEntry {
  entry_date: string;
  entry_type: "announcement" | "meeting";
  product_line: (typeof REGWATCH_PRODUCT_LINES)[number];
  category: string;
  title: string;
  key_points: string;
  link?: string;
  duplicate?: boolean;
}

function validDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeRegwatchDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const roc = text.match(/^(?:民國\s*)?(\d{2,3})(?:\s*年\s*|[-/.])(\d{1,2})(?:\s*月\s*|[-/.])(\d{1,2})\s*日?$/);
  const match = iso ?? roc;
  if (!match) return null;
  const rawYear = Number(match[1]);
  const year = iso ? rawYear : rawYear + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeProductLine(value: unknown): RegwatchExtractedEntry["product_line"] {
  return typeof value === "string" && productLineSet.has(value) ? value as RegwatchExtractedEntry["product_line"] : "其他";
}

export function splitRegwatchText(text: string, limit = REGWATCH_TEXT_CHUNK_LIMIT): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of normalized.split(/\n\s*\n|\f+/)) {
    const value = paragraph.trim();
    if (!value) continue;
    if (value.length > limit) {
      if (current) { chunks.push(current); current = ""; }
      for (let start = 0; start < value.length; start += limit) chunks.push(value.slice(start, start + limit));
    } else if (!current) current = value;
    else if (current.length + value.length + 2 <= limit) current += `\n\n${value}`;
    else { chunks.push(current); current = value; }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function normalizeExtractedEntries(value: unknown): RegwatchExtractedEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RegwatchExtractedEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const entryDate = normalizeRegwatchDate(item.entry_date);
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 100) : "";
    if (!entryDate || !title) continue;
    const keyPoints = typeof item.key_points === "string" ? item.key_points.trim() : "";
    entries.push({
      entry_date: entryDate,
      entry_type: item.entry_type === "meeting" ? "meeting" : "announcement",
      product_line: normalizeProductLine(item.product_line),
      category: typeof item.category === "string" ? item.category.trim().slice(0, 10) : "",
      title,
      key_points: keyPoints.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.startsWith("•") ? line : `• ${line.replace(/^[-*]\s*/, "")}`).join("\n"),
    });
  }
  return entries;
}

export function mergeExtractedEntries(groups: RegwatchExtractedEntry[][]): RegwatchExtractedEntry[] {
  const seen = new Set<string>();
  const merged: RegwatchExtractedEntry[] = [];
  for (const entry of groups.flat()) {
    const key = entry.title.trim().toLocaleLowerCase("zh-TW");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

export function markRegwatchDuplicates(entries: RegwatchExtractedEntry[], existingKeys: Iterable<string>): RegwatchExtractedEntry[] {
  const keys = new Set(existingKeys);
  return entries.map((entry) => ({ ...entry, duplicate: keys.has(`${entry.entry_date}\u0000${entry.title}`) }));
}

export function ensurePdfText(text: string): string {
  const normalized = text.trim();
  if (!normalized) throw new Error("PDF_NO_TEXT");
  return normalized;
}

export function ensureRegwatchTextLimit(text: string): string {
  if (text.length > REGWATCH_TEXT_TOTAL_LIMIT) throw new Error("TEXT_TOO_LONG");
  return text;
}

export function regwatchExtractionErrorStatus(error: unknown): 422 | 502 {
  const code = error instanceof Error ? error.message : "";
  return code === "PDF_NO_TEXT" || code === "TEXT_TOO_LONG" ? 422 : 502;
}

export function canDownloadFileForRegwatch(projectId: string | null, authenticated: boolean): boolean {
  return authenticated && projectId === null;
}

const systemPrompt = `你是台灣醫藥法規資料整理助手。請只回傳嚴格 JSON 陣列，不要 markdown。每筆物件欄位：entry_date（YYYY-MM-DD；民國年加 1911）、entry_type（announcement 或 meeting，無法判定用 announcement）、product_line（只可為藥品、醫療器材、化粧品、健康食品、食品、再生醫療、包裝容器、寵物食品、其他；無法判定用其他）、category（最多 10 字短標籤）、title（最多 100 字）、key_points（每點以「•」開頭並換行）。一份彙整公告若含多則，拆成多筆。`;

export async function extractRegwatchEntries(env: Env, text: string): Promise<RegwatchExtractedEntry[]> {
  ensureRegwatchTextLimit(text);
  const chunks = splitRegwatchText(text);
  if (!chunks.length) return [];
  const groups: RegwatchExtractedEntry[][] = [];
  for (const chunk of chunks) {
    const response = await llmChat(env, [{ role: "system", content: systemPrompt }, { role: "user", content: chunk }]);
    const parsed = parseLooseJson<unknown>(response);
    const normalized = normalizeExtractedEntries(parsed);
    if (!normalized.length) throw new Error("INVALID_AI_RESPONSE");
    groups.push(normalized);
  }
  return mergeExtractedEntries(groups);
}

export function batchDuplicateStats(keys: string[]): { created: number; skipped: number } {
  const seen = new Set<string>();
  let skipped = 0;
  for (const key of keys) {
    if (seen.has(key)) skipped += 1;
    else seen.add(key);
  }
  return { created: seen.size, skipped };
}
