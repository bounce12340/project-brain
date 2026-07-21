import { llmChat, parseLooseJson } from "./llm";

export const REGWATCH_PRODUCT_LINES = ["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"] as const;
export const REGWATCH_TEXT_CHUNK_LIMIT = 24_000;
export const REGWATCH_TEXT_TOTAL_LIMIT = 120_000;
export type RegwatchExtractMode = "single" | "multi";

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

export function normalizeRegwatchExtractMode(value: unknown): RegwatchExtractMode {
  return value === "multi" ? "multi" : "single";
}

function normalizeKeyPoints(value: unknown): string {
  if (typeof value !== "string") return "";
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  const withoutMarker = (line: string) => line.replace(/^[•●▪◦*-]\s*/, "");
  return [withoutMarker(lines[0]), ...lines.slice(1).map((line) => `• ${withoutMarker(line)}`)].join("\n");
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
    entries.push({
      entry_date: entryDate,
      entry_type: item.entry_type === "meeting" ? "meeting" : "announcement",
      product_line: normalizeProductLine(item.product_line),
      category: typeof item.category === "string" ? item.category.trim().slice(0, 10) : "",
      title,
      key_points: normalizeKeyPoints(item.key_points),
    });
  }
  return entries;
}

export function consolidateSingleAnnouncement(entries: RegwatchExtractedEntry[]): RegwatchExtractedEntry[] {
  if (!entries.length) return [];
  const first = entries[0];
  const earliestDate = entries.reduce((earliest, entry) => entry.entry_date < earliest ? entry.entry_date : earliest, first.entry_date);
  return [{
    ...first,
    entry_date: earliestDate,
    key_points: normalizeKeyPoints(entries.map((entry) => entry.key_points).filter(Boolean).join("\n")),
  }];
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

export function buildRegwatchSystemPrompt(mode: RegwatchExtractMode): string {
  const modeInstruction = mode === "single"
    ? "本次是單則公告模式：把整份輸入視為同一則公告，必須輸出恰好 1 筆。"
    : "本次是多則彙整模式：只有不同發文日期或不同公告標題的獨立公告才拆成不同筆。";
  return `你是台灣醫藥法規資料整理助手。請只回傳嚴格 JSON 陣列，不要 markdown。每筆物件欄位：entry_date（YYYY-MM-DD；民國年加 1911）、entry_type（announcement 或 meeting，無法判定用 announcement）、product_line（只可為藥品、醫療器材、化粧品、健康食品、食品、再生醫療、包裝容器、寵物食品、其他；無法判定用其他）、category（最多 10 字短標籤）、title（最多 100 字）、key_points（第一行是 1～2 句摘要且不帶符號；之後每個項目各一行並以「•」開頭）。

一筆 reg_entry 僅代表一則獨立公告；只有具備自己的發文日期、文號或公告標題的獨立公告才算一筆。同一公告內的多個修正條文、品項、附表、子項目一律併入同一筆 key_points，絕不拆成多筆。${modeInstruction}

範例輸入：
民國115年7月20日，衛福部公告「醫療器材標示規定修正公告」，文號衛授食字第1150000001號。本公告修正三項：一、外盒新增批號；二、說明書增加保存條件；三、植入物標示追溯碼。
範例輸出：
[{"entry_date":"2026-07-20","entry_type":"announcement","product_line":"醫療器材","category":"標示","title":"醫療器材標示規定修正公告","key_points":"本公告修正醫療器材外盒、說明書與植入物的標示要求。\\n• 修正外盒須新增批號\\n• 修正說明書須增加保存條件\\n• 修正植入物須標示追溯碼"}]`;
}

export async function extractRegwatchEntries(env: Env, text: string, mode: RegwatchExtractMode = "single"): Promise<RegwatchExtractedEntry[]> {
  ensureRegwatchTextLimit(text);
  const chunks = splitRegwatchText(text);
  if (!chunks.length) return [];
  const groups: RegwatchExtractedEntry[][] = [];
  for (const chunk of chunks) {
    const response = await llmChat(env, [{ role: "system", content: buildRegwatchSystemPrompt(mode) }, { role: "user", content: chunk }]);
    const parsed = parseLooseJson<unknown>(response);
    const normalized = normalizeExtractedEntries(parsed);
    if (!normalized.length) throw new Error("INVALID_AI_RESPONSE");
    groups.push(normalized);
  }
  return mode === "single" ? consolidateSingleAnnouncement(groups.flat()) : mergeExtractedEntries(groups);
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
