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
  /** main＝平常用的主力模型；advisor＝較慢、較強的顧問模型（只在設定了 Ollama Cloud 時有）。 */
  role?: LlmRole;
}

export type LlmRole = "main" | "advisor";
export interface LlmEndpoint { provider: string; baseUrl: string; model: string; apiKey: string }

/**
 * 要打哪個端點。設定了 OLLAMA_API_KEY 就走 Ollama Cloud：主力 OLLAMA_MODEL、顧問 OLLAMA_ADVISOR_MODEL，同一把金鑰。
 * 沒有的話照舊用 LLM_*（目前是 DeepSeek 官方 API），沒有顧問。都沒有時回 null，llmChat 改用 Workers AI。
 */
export function llmEndpoint(env: Env, role: LlmRole = "main"): LlmEndpoint | null {
  if (env.OLLAMA_API_KEY) {
    const model = role === "advisor" ? env.OLLAMA_ADVISOR_MODEL : env.OLLAMA_MODEL;
    return model ? { provider: "Ollama Cloud", baseUrl: env.OLLAMA_BASE_URL, model, apiKey: env.OLLAMA_API_KEY } : null;
  }
  if (role === "advisor" || !env.LLM_API_KEY) return null;
  return { provider: "OpenAI 相容端點", baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY };
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
  const endpoint = llmEndpoint(env, options.role);
  if (!endpoint && options.role === "advisor") throw new Error("沒有設定顧問模型");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (endpoint) {
        const response = await withTimeout((signal) => fetch(`${endpoint.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: endpoint.model, messages, response_format: options.json ? { type: "json_object" } : undefined }),
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

/**
 * 讓 AI 呼叫工具（OpenAI 相容的 function calling，DeepSeek 支援）。
 * 只在有主力端點（Ollama Cloud 或 LLM_API_KEY）時可用；沒有時丟 ToolCallingUnavailable，呼叫端退回純問答。
 */
export interface AgentToolCall { id: string; name: string; arguments: string }
export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };
export interface AgentTool { type: "function"; function: { name: string; description: string; parameters: unknown } }
export class ToolCallingUnavailable extends Error {}

export async function llmChatWithTools(env: Env, messages: AgentMessage[], tools: AgentTool[], options: { timeoutMs?: number } = {}): Promise<{ content: string; toolCalls: AgentToolCall[] }> {
  const endpoint = llmEndpoint(env);
  if (!endpoint) throw new ToolCallingUnavailable("沒有設定語言模型金鑰");
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? 90_000));
  const response = await withTimeout((signal) => fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: endpoint.model, messages, tools, tool_choice: "auto" }),
  }), timeoutMs);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ToolCallingUnavailable(`LLM HTTP ${response.status}${detail ? `: ${upstreamMessage(detail)}` : ""}`);
  }
  const body = await response.json<{ choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> }>();
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("LLM 回應缺少內容");
  const toolCalls = (message.tool_calls ?? []).flatMap((call, index) => call.function?.name
    ? [{ id: call.id || `call_${index}`, name: call.function.name, arguments: call.function.arguments || "{}" }] : []);
  return { content: message.content ?? "", toolCalls };
}
