/**
 * MCP（Model Context Protocol）的 Streamable HTTP 傳輸，無狀態版本。
 *
 * 只提供工具（tools），每個 POST 一次處理完就回 JSON，不開 SSE、不發 session id：
 * 艾爾水晶的工具都是一問一答，不需要伺服器主動推送。行為對照官方 SDK 1.30 的
 * WebStandardStreamableHTTPServerTransport（enableJsonResponse、無 sessionIdGenerator）：
 * 支援的協定版本、通知回 202、未知版本回 400、批次請求。
 */

/** 和官方 SDK 相同，新的在前。initialize 時對方要的版本在清單裡就用它，否則回最新的。 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export type JsonSchema = {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: readonly (string | number)[];
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  additionalProperties?: boolean;
};

export interface McpTool<Ctx> {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  /** 會新增或修改資料：需要 mcp:write，並寫稽核紀錄。 */
  write?: boolean;
  /** 同一組參數重複呼叫結果相同（例如勾選完成、改日期）。 */
  idempotent?: boolean;
  run(args: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
}

/** 使用者看得懂、AI 可以轉述的失敗（找不到專案、沒有權限…）。回成 isError，而不是協定錯誤。 */
export class ToolError extends Error {}

export interface ServerInfo { name: string; title: string; version: string; instructions: string }

interface HandlerOptions<Ctx> {
  tools: McpTool<Ctx>[];
  info: ServerInfo;
  /** 這個連線有沒有寫入權限。沒有的話寫入工具不列出來，呼叫也會被拒絕。 */
  canWrite: boolean;
  /** 需要時才建立（查使用者、組內部 API），ping 與 tools/list 不必付這個成本。 */
  context(): Promise<Ctx>;
  onError?(error: unknown, tool: string): void;
}

type JsonRpcId = string | number;
interface JsonRpcRequest { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: Record<string, unknown> }
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

export const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internalError: -32603, badRequest: -32000 } as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rpcError = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is JsonRpcId => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

export async function handleMcpRequest<Ctx>(request: Request, options: HandlerOptions<Ctx>): Promise<Response> {
  if (request.method !== "POST") {
    // 無狀態：不提供 GET 的 SSE 串流，也沒有 session 可以 DELETE。
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const headerVersion = request.headers.get("mcp-protocol-version");
  if (headerVersion !== null && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)) {
    return json(rpcError(null, RPC.badRequest, `Bad Request: Unsupported protocol version: ${headerVersion} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`), 400);
  }
  let raw: unknown;
  try { raw = await request.json(); } catch { return json(rpcError(null, RPC.parseError, "Parse error: Invalid JSON"), 400); }
  const batch = Array.isArray(raw);
  const messages = batch ? raw as unknown[] : [raw];
  if (!messages.length || !messages.every((message) => isObject(message) && message.jsonrpc === "2.0")) {
    return json(rpcError(null, RPC.invalidRequest, "Invalid Request: expected JSON-RPC 2.0 message"), 400);
  }
  const requests = (messages as Record<string, unknown>[]).filter((message) => typeof message.method === "string" && "id" in message);
  // 只有通知（notifications/initialized 等）或回應：照規格回 202，不帶內容。
  if (!requests.length) return new Response(null, { status: 202 });

  let context: Promise<Ctx> | null = null;
  const lazyContext = () => (context ??= options.context());
  const responses: JsonRpcResponse[] = [];
  for (const message of requests) {
    if (!isId(message.id)) { responses.push(rpcError(null, RPC.invalidRequest, "Invalid Request: id must be a string or number")); continue; }
    if (message.params !== undefined && !isObject(message.params)) { responses.push(rpcError(message.id, RPC.invalidParams, "params must be an object")); continue; }
    responses.push(await dispatch(message as unknown as JsonRpcRequest, options, lazyContext));
  }
  return json(batch ? responses : responses[0]);
}

async function dispatch<Ctx>(message: JsonRpcRequest, options: HandlerOptions<Ctx>, context: () => Promise<Ctx>): Promise<JsonRpcResponse> {
  const { id, method } = message;
  const params = message.params ?? {};
  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      const { name, title, version, instructions } = options.info;
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name, title, version }, instructions } };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: options.tools.filter((tool) => options.canWrite || !tool.write).map(describeTool) } };
    case "tools/call": {
      const tool = options.tools.find((item) => item.name === params.name);
      if (!tool) return rpcError(id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments === undefined ? {} : params.arguments;
      // 參數或權限不對是工具層的失敗：回 isError，讓 AI 看到原因後自己修正或轉告使用者。
      if (!isObject(args)) return { jsonrpc: "2.0", id, result: toolError("arguments 必須是物件") };
      if (tool.write && !options.canWrite) {
        return { jsonrpc: "2.0", id, result: toolError("這個連線只有讀取權限。要讓 AI 新增或修改資料，請在 AI 工具裡中斷這個連接器後重新連接，並在艾爾水晶的授權頁勾選「新增與修改」。") };
      }
      const invalid = validate(tool.inputSchema, args, "");
      if (invalid) return { jsonrpc: "2.0", id, result: toolError(`參數不正確：${invalid}`) };
      try {
        const output = await tool.run(args, await context());
        return { jsonrpc: "2.0", id, result: toolResult(output) };
      } catch (error) {
        if (error instanceof ToolError) return { jsonrpc: "2.0", id, result: toolError(error.message) };
        options.onError?.(error, tool.name);
        return { jsonrpc: "2.0", id, result: toolError("系統處理時發生錯誤，請稍後再試。") };
      }
    }
    default:
      return rpcError(id, RPC.methodNotFound, `Method not found: ${method}`);
  }
}

function describeTool<Ctx>(tool: McpTool<Ctx>) {
  return {
    name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: !tool.write || tool.idempotent === true, openWorldHint: false },
  };
}

function toolResult(output: unknown) {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return isObject(output) ? { content: [{ type: "text", text }], structuredContent: output } : { content: [{ type: "text", text }] };
}

const toolError = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * 依工具自己宣告的 inputSchema 檢查參數。只涵蓋這裡用到的關鍵字；
 * 多出來的欄位在 additionalProperties: false 時擋下，免得 AI 以為欄位有生效。
 */
export function validate(schema: JsonSchema, value: unknown, path: string): string | null {
  const at = path || "參數";
  if (value === null && schema.type !== "object") return `${at} 不能是 null`;
  switch (schema.type) {
    case "object": {
      if (!isObject(value)) return `${at} 必須是物件`;
      for (const key of schema.required ?? []) if (value[key] === undefined) return `缺少 ${path ? `${path}.` : ""}${key}`;
      for (const [key, item] of Object.entries(value)) {
        const child = schema.properties?.[key];
        if (!child) { if (schema.additionalProperties === false) return `不認得的欄位 ${path ? `${path}.` : ""}${key}`; continue; }
        if (item === undefined) continue;
        const problem = validate(child, item, path ? `${path}.${key}` : key);
        if (problem) return problem;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${at} 必須是陣列`;
      for (const [index, item] of value.entries()) { const problem = schema.items ? validate(schema.items, item, `${at}[${index}]`) : null; if (problem) return problem; }
      return null;
    }
    case "string":
      if (typeof value !== "string") return `${at} 必須是文字`;
      if (schema.minLength !== undefined && [...value].length < schema.minLength) return `${at} 不能少於 ${schema.minLength} 字`;
      if (schema.maxLength !== undefined && [...value].length > schema.maxLength) return `${at} 不能超過 ${schema.maxLength} 字`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at} 格式不正確`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `${at} 必須是 true 或 false`;
      break;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) return `${at} 必須是${schema.type === "integer" ? "整數" : "數字"}`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${at} 不能小於 ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${at} 不能大於 ${schema.maximum}`;
      break;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) return `${at} 只能是：${schema.enum.join("、")}`;
  return null;
}
