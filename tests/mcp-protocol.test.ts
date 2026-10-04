import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest, LATEST_PROTOCOL_VERSION, ToolError, validate, type McpTool } from "../worker/mcp/protocol";

/**
 * MCP 的 Streamable HTTP（無狀態、只回 JSON）。行為對照官方 SDK：
 * 支援的版本、通知回 202、不支援的版本回 400、工具層失敗回 isError 而不是協定錯誤。
 */

type Ctx = { who: string };
const tools: McpTool<Ctx>[] = [
  { name: "read_thing", title: "讀", description: "read", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 5 } } },
    run: async (args, ctx) => ({ id: args.id, by: ctx.who }) },
  { name: "write_thing", title: "寫", description: "write", write: true, inputSchema: { type: "object", properties: {} }, run: async () => ({ ok: true }) },
  { name: "fail_nicely", title: "錯", description: "", inputSchema: { type: "object", properties: {} }, run: async () => { throw new ToolError("找不到專案「X」"); } },
  { name: "explode", title: "炸", description: "", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("D1_ERROR: boom"); } },
];

async function post(body: unknown, options: { canWrite?: boolean; headers?: Record<string, string>; context?: () => Promise<Ctx>; onError?: () => void } = {}) {
  const request = new Request("https://example.com/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...options.headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const response = await handleMcpRequest(request, {
    tools, info: { name: "project-brain", title: "艾爾水晶", version: "1.0.0", instructions: "hi" }, canWrite: options.canWrite ?? true,
    context: options.context ?? (async () => ({ who: "陳冠宇" })), onError: options.onError,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}
const call = (name: string, args?: unknown, options?: Parameters<typeof post>[1]) => post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } }, options);

describe("連線與版本", () => {
  it("initialize：對方要的版本支援就用它，並宣告只有工具", async () => {
    const { status, body } = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } } });
    expect(status).toBe(200);
    expect(body).toEqual({ jsonrpc: "2.0", id: 1, result: {
      protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "project-brain", title: "艾爾水晶", version: "1.0.0" }, instructions: "hi",
    } });
  });

  it("initialize：不認得的版本回我們最新的，讓對方決定要不要繼續", async () => {
    const { body } = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("之後的請求帶了不支援的 MCP-Protocol-Version 就回 400", async () => {
    const { status, body } = await post({ jsonrpc: "2.0", id: 2, method: "ping" }, { headers: { "MCP-Protocol-Version": "1999-01-01" } });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32000);
  });

  it("通知不需要回應：202、沒有內容", async () => {
    const { status, body } = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(status).toBe(202);
    expect(body).toBeNull();
  });

  it("不提供 SSE 串流與 session：GET、DELETE 回 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await handleMcpRequest(new Request("https://example.com/mcp", { method }), { tools, info: { name: "", title: "", version: "", instructions: "" }, canWrite: true, context: async () => ({ who: "" }) });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
  });

  it("壞掉的 JSON 回 -32700，不是 JSON-RPC 的回 -32600，未知方法回 -32601", async () => {
    expect((await post("{oops")).body.error.code).toBe(-32700);
    expect((await post({ id: 1, method: "ping" })).body.error.code).toBe(-32600);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "resources/list" })).body.error.code).toBe(-32601);
  });

  it("批次請求逐一回覆，通知不佔位置", async () => {
    const { body } = await post([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "ping" }]);
    expect(body).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }, { jsonrpc: "2.0", id: "b", result: {} }]);
  });
});

describe("工具", () => {
  it("列出工具時標明唯讀，只能讀的連線看不到寫入工具", async () => {
    const all = (await post({ jsonrpc: "2.0", id: 3, method: "tools/list" })).body.result.tools;
    expect(all.map((tool: { name: string }) => tool.name)).toEqual(["read_thing", "write_thing", "fail_nicely", "explode"]);
    expect(all[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(all[1].annotations).toMatchObject({ readOnlyHint: false });
    const readOnly = (await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { canWrite: false })).body.result.tools;
    expect(readOnly.map((tool: { name: string }) => tool.name)).not.toContain("write_thing");
  });

  it("列工具不必查使用者；真的呼叫工具才建立 context", async () => {
    const context = vi.fn(async () => ({ who: "x" }));
    await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { context });
    expect(context).not.toHaveBeenCalled();
    await call("read_thing", { id: "p1" }, { context });
    expect(context).toHaveBeenCalledTimes(1);
  });

  it("成功時同時給文字與結構化結果", async () => {
    const { body } = await call("read_thing", { id: "p1" });
    expect(body.result.structuredContent).toEqual({ id: "p1", by: "陳冠宇" });
    expect(JSON.parse(body.result.content[0].text)).toEqual({ id: "p1", by: "陳冠宇" });
    expect(body.result.isError).toBeUndefined();
  });

  it("參數不對、找不到東西、沒有寫入權限：都回 isError 與看得懂的原因", async () => {
    expect((await call("read_thing", {})).body.result).toEqual({ content: [{ type: "text", text: "參數不正確：缺少 id" }], isError: true });
    expect((await call("read_thing", { id: "p1", extra: 1 })).body.result.content[0].text).toBe("參數不正確：不認得的欄位 extra");
    expect((await call("read_thing", { id: "p1", limit: 9 })).body.result.content[0].text).toBe("參數不正確：limit 不能大於 5");
    expect((await call("fail_nicely", {})).body.result).toEqual({ content: [{ type: "text", text: "找不到專案「X」" }], isError: true });
    expect((await call("write_thing", {}, { canWrite: false })).body.result.content[0].text).toContain("這個連線只有讀取權限");
  });

  it("非預期的錯誤不把內部訊息交給 AI，但會記下來", async () => {
    const onError = vi.fn();
    const { body } = await call("explode", {}, { onError });
    expect(body.result).toEqual({ content: [{ type: "text", text: "系統處理時發生錯誤，請稍後再試。" }], isError: true });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "D1_ERROR: boom" }), "explode");
  });

  it("不存在的工具是協定錯誤 -32602", async () => {
    expect((await call("nope", {})).body.error).toEqual({ code: -32602, message: "Unknown tool: nope" });
  });
});

describe("參數檢查", () => {
  it("日期格式、列舉、型別", () => {
    const schema = { type: "object" as const, properties: { date: { type: "string" as const, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, kind: { type: "string" as const, enum: ["milestone", "event"] }, done: { type: "boolean" as const } } };
    expect(validate(schema, { date: "2026/9/30" }, "")).toBe("date 格式不正確");
    expect(validate(schema, { kind: "task" }, "")).toBe("kind 只能是：milestone、event");
    expect(validate(schema, { done: "true" }, "")).toBe("done 必須是 true 或 false");
    expect(validate(schema, { date: "2026-09-30", kind: "event", done: false }, "")).toBeNull();
  });
});

describe("用戶端相容性與錯誤請求", () => {
  it.each(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"])("協商 %s 並保留同一版本", async (version) => {
    const init = await post({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "client", version: "1" } } });
    expect(init.body.result.protocolVersion).toBe(version);
    expect((await call("read_thing", { id: "p1" }, { headers: { "MCP-Protocol-Version": version } })).body.result.structuredContent.id).toBe("p1");
  });

  it("缺少 method 的請求回錯誤，不會被當成已收到的通知", async () => {
    expect((await post({ jsonrpc: "2.0", id: 0 })).body.error.code).toBe(-32600);
    expect((await post({ jsonrpc: "2.0", method: 42 })).body.error.code).toBe(-32600);
    expect((await post({ jsonrpc: "2.0", id: 1, result: {} })).status).toBe(202);
  });

  it("tools/list 不接受假的翻頁游標，含工具資料的回應不可快取", async () => {
    const result = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "invented" } });
    expect(result.body.error.code).toBe(-32602);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
});
