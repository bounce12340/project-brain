/**
 * DeepSeek 的網頁搜尋與抓取 API（https://api-docs.deepseek.com/zh-cn/guides/search/）。
 * 用 LLM_API_KEY——只在 LLM_BASE_URL 指向 DeepSeek 官方 API 時才有效，否則視為沒有這個功能。
 * 搜尋與抓取都是 DeepSeek 那端去連網，Worker 只呼叫 api.deepseek.com，不會替使用者去打任意網址。
 */

export const WEB_SEARCH_MAX_RESULTS = 10;
const SUMMARY_LIMIT = 800;
export const WEB_FETCH_LIMIT = 10_000;
const DEEPSEEK_HOST = "api.deepseek.com";

export interface WebSearchResult { title: string; url: string; site: string | null; date: string | null; authority: number; summary: string }
export interface WebPage { title: string; url: string; content: string; truncated: boolean }

export class WebSearchError extends Error {}

/** 有 DeepSeek 金鑰才回端點；回 null 時 AI 小幫手不提供網路工具。 */
export function webSearchEndpoint(env: Env): { origin: string; apiKey: string } | null {
  if (!env.LLM_API_KEY) return null;
  try {
    const url = new URL(env.LLM_BASE_URL);
    return url.hostname === DEEPSEEK_HOST ? { origin: url.origin, apiKey: env.LLM_API_KEY } : null;
  } catch {
    return null;
  }
}

const MESSAGES: Record<number, string> = {
  401: "DeepSeek 金鑰無效",
  402: "DeepSeek 帳戶餘額不足",
  403: "這個網址被 DeepSeek 的安全策略拒絕",
  404: "這個網址抓不到可用的內容",
  429: "網路搜尋太頻繁，請稍後再試",
};

async function call<T>(env: Env, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const endpoint = webSearchEndpoint(env);
  if (!endpoint) throw new WebSearchError("沒有設定 DeepSeek 金鑰，無法使用網路搜尋");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint.origin}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new WebSearchError(MESSAGES[response.status] ?? `網路搜尋服務回應 ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(controller.signal.aborted ? "網路搜尋逾時" : "連不上網路搜尋服務");
  } finally {
    clearTimeout(timer);
  }
}

const clip = (value: unknown, limit: number) => {
  const text = typeof value === "string" ? value : "";
  return [...text].length > limit ? `${[...text].slice(0, limit).join("")}…` : text;
};

export async function webSearch(env: Env, input: { query: string; count?: number; question?: string }): Promise<WebSearchResult[]> {
  const count = Math.min(WEB_SEARCH_MAX_RESULTS, Math.max(1, Math.floor(input.count ?? 5)));
  const body: Record<string, unknown> = { query: input.query, count };
  if (input.question) body.ori_question = clip(input.question, 128);
  const data = await call<{ results?: Array<Record<string, unknown>> }>(env, "/v1/tools/search", body, 20_000);
  return (data.results ?? [])
    .filter((item) => typeof item.url === "string" && /^https?:\/\//i.test(item.url))
    .map((item) => ({
      title: clip(item.title, 200) || String(item.url),
      url: String(item.url),
      site: typeof item.site_name === "string" ? item.site_name : null,
      date: typeof item.date === "string" ? item.date : null,
      authority: typeof item.authority === "number" ? item.authority : -1,
      summary: clip(item.summary || item.snippet, SUMMARY_LIMIT),
    }));
}

export async function webFetch(env: Env, url: string): Promise<WebPage> {
  const data = await call<{ title?: string; content?: string }>(env, "/v1/tools/fetch", { url }, 30_000);
  const content = typeof data.content === "string" ? data.content : "";
  return { title: clip(data.title, 200), url, content: clip(content, WEB_FETCH_LIMIT), truncated: [...content].length > WEB_FETCH_LIMIT };
}
