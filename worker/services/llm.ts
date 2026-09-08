export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function parseLooseJson<T>(text: string): T | null {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const objectStart = unfenced.indexOf("{");
  const arrayStart = unfenced.indexOf("[");
  const useArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? unfenced.lastIndexOf("]") : unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export interface LlmChatOptions {
  json?: boolean;
  timeoutMs?: number;
  attempts?: number;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 從供應商的錯誤回應裡取出可讀的一句話，長度設限避免把整份 HTML 錯誤頁塞進日誌。 */
export function upstreamMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const error = parsed.error;
    const text = typeof error === "string" ? error : error?.message ?? parsed.message;
    if (text) return String(text).slice(0, 200);
  } catch { /* 不是 JSON 就退回原文 */ }
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function llmChat(env: Env, messages: ChatMessage[], options: LlmChatOptions = {}): Promise<string> {
  let lastError: unknown;
  const attempts = Math.max(1, Math.floor(options.attempts ?? 2));
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? 60_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (env.LLM_API_KEY) {
        const response = await withTimeout((signal) => fetch(`${env.LLM_BASE_URL}/chat/completions`, {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: env.LLM_MODEL, messages, response_format: options.json ? { type: "json_object" } : undefined }),
        }), timeoutMs);
        if (!response.ok) {
          // 帶上供應商自己的錯誤訊息。只回「LLM HTTP 401」的話，看的人分不出是金鑰無效、
          // 模型名不存在還是額度用盡——而這三者的處理方式完全不同。
          // DeepSeek 的錯誤內容會把金鑰遮成 ****，其他 OpenAI 相容端點同理。
          const detail = await response.text().catch(() => "");
          throw new Error(`LLM HTTP ${response.status}${detail ? `: ${upstreamMessage(detail)}` : ""}`);
        }
        const body = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>();
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error("LLM 回應缺少內容");
        return content;
      }
      const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages });
      if (typeof result === "object" && result !== null && "response" in result && typeof result.response === "string") return result.response;
      throw new Error("Workers AI 回應格式錯誤");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM 呼叫失敗");
}
