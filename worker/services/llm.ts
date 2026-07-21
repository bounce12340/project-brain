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

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function llmChat(env: Env, messages: ChatMessage[], options: { json?: boolean } = {}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (env.LLM_API_KEY) {
        const response = await withTimeout((signal) => fetch(`${env.LLM_BASE_URL}/chat/completions`, {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: env.LLM_MODEL, messages, response_format: options.json ? { type: "json_object" } : undefined }),
        }));
        if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
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
