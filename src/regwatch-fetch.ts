/**
 * 「立即抓取」回傳的錯誤是給工程師看的代碼（fetch: RSS_HTTP_403、parse: no RSS items…），
 * 這裡歸成幾種看得懂的原因，畫面上照樣附原始代碼，回報問題時能直接對到日誌。
 */
export type FetchErrorReason = "blocked" | "http" | "not_rss" | "timeout" | "too_large" | "item" | "other";

export interface FetchErrorSummary { reason: FetchErrorReason; status?: number; raw: string }

export function describeFetchError(raw: string): FetchErrorSummary {
  const status = raw.match(/RSS_HTTP_(\d{3})/)?.[1];
  if (status) return { reason: status === "403" || status === "429" ? "blocked" : "http", status: Number(status), raw };
  if (/no RSS items/i.test(raw)) return { reason: "not_rss", raw };
  if (/abort|timed? ?out/i.test(raw)) return { reason: "timeout", raw };
  if (/RSS_TOO_LARGE/.test(raw)) return { reason: "too_large", raw };
  if (/^item\b/.test(raw)) return { reason: "item", raw };
  return { reason: "other", raw };
}

/** 同一種原因只列一次，最多 limit 則；單則公告的錯誤可能很多，只當一種原因看。 */
export function summarizeFetchErrors(errors: string[], limit = 2): FetchErrorSummary[] {
  const seen = new Set<string>();
  const out: FetchErrorSummary[] = [];
  for (const error of errors) {
    const summary = describeFetchError(error);
    const key = `${summary.reason}:${summary.status ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
    if (out.length >= limit) break;
  }
  return out;
}
