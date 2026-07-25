import { createId } from "./db";
import { extractRegwatchEntries, type RegwatchExtractedEntry } from "./regwatch-ai";
import { taipeiDate } from "./time";

export const TFDA_RSS_URL = "https://www.fda.gov.tw/TC/rssAnnouncement.ashx";
export const TFDA_RSS_TIMEOUT_MS = 20_000;
export const TFDA_RSS_MAX_BYTES = 2_000_000;
export const TFDA_TEXT_LIMIT = 24_000;

export interface TfdaRssItem {
  title: string;
  link: string;
  pubDate: string;
  descriptionHtml: string;
}

export interface TfdaDraft {
  sourceRef: string;
  entryDate: string;
  title: string;
  link: string;
  productLine: RegwatchExtractedEntry["product_line"];
  category: string;
  keyPoints: string;
  usedFallback: boolean;
}

export interface TfdaFetchStats {
  fetched: number;
  new_drafts: number;
  skipped_ref: number;
  skipped_dup: number;
  ai_fallback: number;
  errors: string[];
}

export type TfdaDuplicateReason = "source_ref" | "entry" | null;

interface TfdaFetchDependencies {
  fetcher?: typeof fetch;
  extract?: (env: Env, text: string) => Promise<RegwatchExtractedEntry[]>;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code: string) => {
    const normalized = code.toLocaleLowerCase();
    if (normalized.startsWith("#x")) {
      const point = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    if (normalized.startsWith("#")) {
      const point = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return namedEntities[normalized] ?? entity;
  });
}

function unwrapCdata(value: string): string {
  const match = value.trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i);
  return match ? match[1] : value;
}

function rssField(itemXml: string, name: string): string {
  const match = itemXml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!match) return "";
  return unwrapCdata(decodeHtmlEntities(unwrapCdata(match[1])));
}

export function parseTfdaRss(xml: string): TfdaRssItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => ({
    title: rssField(match[1], "title").trim(),
    link: rssField(match[1], "link").trim(),
    pubDate: rssField(match[1], "pubDate").trim(),
    descriptionHtml: rssField(match[1], "description").trim(),
  })).filter((item) => item.title || item.link || item.pubDate || item.descriptionHtml);
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function tableToText(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) => [...row[1].matchAll(/<t[dh](?:\s[^>]*)?>([\s\S]*?)<\/t[dh]>/gi)]
    .map((cell) => stripHtml(cell[1]))
    .filter(Boolean)
    .join("｜"))
    .filter(Boolean)
    .join("\n");
}

export function tfdaHtmlToText(html: string, limit = TFDA_TEXT_LIMIT): string {
  const withoutUnsafe = unwrapCdata(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, "");
  const withTables = withoutUnsafe.replace(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi, (table) => `\n${tableToText(table)}\n`);
  const withBreaks = withTables
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:address|article|blockquote|div|h[1-6]|li|ol|p|section|thead|tbody|tfoot|tr|ul)>/gi, "\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, " "))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text.slice(0, limit);
}

export function extractTfdaSourceRef(link: string): string | null {
  try {
    const id = new URL(link).searchParams.get("id");
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function tfdaPubDateToTaipeiDate(pubDate: string): string | null {
  const timestamp = Date.parse(pubDate);
  return Number.isFinite(timestamp) ? taipeiDate(new Date(timestamp)) : null;
}

export function tfdaDuplicateReason(
  sourceRef: string,
  entryDate: string,
  title: string,
  existingRefs: ReadonlySet<string>,
  existingEntryKeys: ReadonlySet<string>,
): TfdaDuplicateReason {
  if (existingRefs.has(sourceRef)) return "source_ref";
  return existingEntryKeys.has(`${entryDate}\u0000${title}`) ? "entry" : null;
}

export function buildTfdaDraft(
  item: TfdaRssItem,
  sourceRef: string,
  entryDate: string,
  plainText: string,
  extracted?: RegwatchExtractedEntry,
): TfdaDraft {
  return {
    sourceRef,
    entryDate,
    title: item.title,
    link: item.link,
    productLine: extracted?.product_line ?? "其他",
    category: extracted?.category ?? "",
    keyPoints: extracted?.key_points.trim() || plainText.slice(0, 500),
    usedFallback: !extracted,
  };
}

async function responseTextWithinLimit(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > limit) {
        await reader.cancel();
        throw new Error("RSS_TOO_LARGE");
      }
      text += decoder.decode(result.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function notifyTfdaDrafts(db: D1Database, count: number): Promise<void> {
  if (count <= 0) return;
  const recipients = await db.prepare(`SELECT id FROM users
    WHERE is_active=1 AND approval_status='approved'
      AND (role='admin' OR (role='member' AND group_id='grp_general'))`).all<{ id: string }>();
  if (!recipients.results.length) return;
  await db.batch(recipients.results.map((recipient) => db.prepare(
    "INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)",
  ).bind(
    createId("noti"),
    recipient.id,
    "tfda_draft",
    `TFDA 新公告 ${count} 則待審核`,
    "請至法規動態的草稿檢視進行審核。",
    "/regwatch?view=drafts",
  )));
}

function emptyStats(): TfdaFetchStats {
  return { fetched: 0, new_drafts: 0, skipped_ref: 0, skipped_dup: 0, ai_fallback: 0, errors: [] };
}

export async function fetchTfdaDrafts(env: Env, dependencies: TfdaFetchDependencies = {}): Promise<TfdaFetchStats> {
  const stats = emptyStats();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TFDA_RSS_TIMEOUT_MS);
  let xml: string;
  try {
    const response = await (dependencies.fetcher ?? fetch)(TFDA_RSS_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "ProjectBrain-Regwatch/11.0 (+https://projects.uic-ai.com)" },
    });
    if (!response.ok) throw new Error(`RSS_HTTP_${response.status}`);
    xml = await responseTextWithinLimit(response, TFDA_RSS_MAX_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats.errors.push(`fetch: ${message}`);
    console.error(JSON.stringify({ message: "TFDA RSS fetch failed", error: message }));
    return stats;
  } finally {
    clearTimeout(timer);
  }

  const items = parseTfdaRss(xml);
  stats.fetched = items.length;
  if (!items.length) {
    stats.errors.push("parse: no RSS items");
    console.error(JSON.stringify({ message: "TFDA RSS parse failed", error: "no RSS items" }));
    return stats;
  }
  for (const item of items) {
    const sourceRef = extractTfdaSourceRef(item.link);
    const entryDate = tfdaPubDateToTaipeiDate(item.pubDate);
    if (!sourceRef || !entryDate || !item.title) {
      stats.errors.push(`item: invalid metadata (${item.link || item.title || "unknown"})`);
      continue;
    }
    try {
      const existingRef = await env.DB.prepare("SELECT 1 FROM reg_entries WHERE source_ref=? LIMIT 1").bind(sourceRef).first();
      if (existingRef) {
        stats.skipped_ref += 1;
        continue;
      }
      const existingEntry = await env.DB.prepare("SELECT 1 FROM reg_entries WHERE entry_date=? AND title=? LIMIT 1").bind(entryDate, item.title).first();
      if (existingEntry) {
        stats.skipped_dup += 1;
        continue;
      }

      const plainText = tfdaHtmlToText(item.descriptionHtml);
      let extracted: RegwatchExtractedEntry | undefined;
      try {
        extracted = (await (dependencies.extract ?? ((activeEnv, text) => extractRegwatchEntries(activeEnv, text, "single")))(env, plainText))[0];
      } catch (error) {
        console.error(JSON.stringify({
          message: "TFDA RSS AI enrichment failed",
          source_ref: sourceRef,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      const draft = buildTfdaDraft(item, sourceRef, entryDate, plainText, extracted);
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO reg_entries
        (id,entry_date,entry_type,product_line,category,title,key_points,link,created_by,status,source,source_ref)
        VALUES (?,?,?,?,?,?,?,?,NULL,'draft','tfda_rss',?)`)
        .bind(createId("reg"), draft.entryDate, "announcement", draft.productLine, draft.category || null, draft.title, draft.keyPoints || null, draft.link, draft.sourceRef)
        .run();
      if ((inserted.meta.changes ?? 0) > 0) {
        stats.new_drafts += 1;
        if (draft.usedFallback) stats.ai_fallback += 1;
      } else if (await env.DB.prepare("SELECT 1 FROM reg_entries WHERE source_ref=? LIMIT 1").bind(sourceRef).first()) {
        stats.skipped_ref += 1;
      } else {
        stats.skipped_dup += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.errors.push(`item ${sourceRef}: ${message}`);
      console.error(JSON.stringify({ message: "TFDA RSS item failed", source_ref: sourceRef, error: message }));
    }
  }
  try {
    await notifyTfdaDrafts(env.DB, stats.new_drafts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats.errors.push(`notification: ${message}`);
    console.error(JSON.stringify({ message: "TFDA draft notification failed", error: message }));
  }
  return stats;
}
