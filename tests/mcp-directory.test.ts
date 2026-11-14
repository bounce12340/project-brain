import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { ASSISTANT_ONLY_TOOLS, CONNECTOR_TOOLS, MCP_SERVER_INFO, MCP_TOOLS } from "../worker/mcp/tools";
import { handleMcpRequest, toolIsDestructive } from "../worker/mcp/protocol";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * Claude 連接器目錄的審查標準（Connector pre-submission checklist）：
 * 每個工具要有 title 與正確的 readOnlyHint / destructiveHint、名稱 64 字以內、
 * 描述只說工具做什麼而不指揮 AI、只呼叫自家 API，並有公開的說明頁與隱私權政策。
 */

const BASE = "https://brain.test";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const fetchWorker = (path: string) => worker.fetch(new Request(`${BASE}${path}`), env, ctx);

beforeEach(() => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE, SUPPORT_EMAIL: "" } as unknown as Env;
});

async function listedTools(canWrite: boolean) {
  const response = await handleMcpRequest(new Request(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), {
    tools: CONNECTOR_TOOLS, info: { ...MCP_SERVER_INFO }, canWrite, context: async () => ({}) as never,
  });
  return ((await response.json()) as { result: { tools: Array<{ name: string; title: string; description: string; annotations: Record<string, unknown> }> } }).result.tools;
}

describe("工具設計", () => {
  it("每個工具都有 title、名稱 64 字以內，並宣告 readOnlyHint 與 destructiveHint", async () => {
    for (const tool of await listedTools(true)) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
      expect(tool.annotations.title, tool.name).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint, tool.name).toBe("boolean");
    }
  });

  it("修改或刪除既有資料的工具宣告 destructiveHint: true；只新增的是 false；唯讀的一律 false", async () => {
    const hints = Object.fromEntries((await listedTools(true)).map((tool) => [tool.name, tool.annotations]));
    for (const name of ["update_task", "update_subtask", "update_milestone", "rename_stage", "reorder_stages", "update_project_background", "update_project_settings", "update_todo", "update_meeting", "delete_task", "delete_subtask", "delete_milestone", "delete_stage"]) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    for (const name of ["add_progress_update", "create_task", "add_subtask", "add_milestone", "add_stage", "create_todo", "create_meeting", "create_regulation"]) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
    for (const tool of CONNECTOR_TOOLS.filter((item) => !item.write)) expect(hints[tool.name], tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    // 每個寫入工具都歸到其中一類，沒有漏標。
    expect(CONNECTOR_TOOLS.filter((tool) => tool.write).every((tool) => toolIsDestructive(tool) !== (tool.additive === true && !tool.destructive))).toBe(true);
  });

  it("工具描述只說明工具做什麼，不指揮 AI 怎麼做", () => {
    const directive = /\b(you must|always|never|ask the user|tell the user|confirm with|get (their|the user's) explicit|before calling|ignore|instead of other tools)\b/i;
    for (const tool of CONNECTOR_TOOLS) {
      expect(tool.description, tool.name).not.toMatch(directive);
      for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) expect(schema.description ?? "", `${tool.name}.${field}`).not.toMatch(directive);
    }
  });

  it("連接器只提供艾爾水晶自己的資料：網路搜尋只留給站內 AI 小幫手", async () => {
    const names = (await listedTools(true)).map((tool) => tool.name);
    for (const name of ASSISTANT_ONLY_TOOLS) {
      expect(names).not.toContain(name);
      expect(MCP_TOOLS.some((tool) => tool.name === name)).toBe(true);
    }
    expect(CONNECTOR_TOOLS.every((tool) => !tool.openWorld)).toBe(true);
  });

  it("沒有寫入權限的連線只列出唯讀工具", async () => {
    expect((await listedTools(false)).every((tool) => tool.annotations.readOnlyHint === true)).toBe(true);
  });
});

describe("OAuth：Claude 用戶端的要求", () => {
  it("授權伺服器宣告 S256 PKCE 與公開用戶端（token_endpoint_auth_method: none），並提供動態註冊", async () => {
    const server = await (await fetchWorker("/.well-known/oauth-authorization-server")).json() as Record<string, unknown>;
    expect(server.code_challenge_methods_supported).toContain("S256");
    expect(server.token_endpoint_auth_methods_supported).toContain("none");
    expect(server.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(server.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]));
  });
});

describe("公開說明頁", () => {
  it("隱私權政策不用登入就看得到，涵蓋收集、用途、第三方、保存期間與聯絡方式", async () => {
    const response = await fetchWorker("/privacy");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    for (const heading of ["Data we collect", "How we use data", "Third parties", "Retention", "Contact"]) expect(html).toContain(heading);
    expect(html).toContain("不讀取也不保存你與 AI 的對話內容");
    expect(html).toContain("請洽你所屬公司的艾爾水晶管理員");
  });

  it("設定 SUPPORT_EMAIL 後列出聯絡信箱", async () => {
    env = { ...env, SUPPORT_EMAIL: "support@example.com" } as unknown as Env;
    expect(await (await fetchWorker("/privacy")).text()).toContain('href="mailto:support@example.com"');
  });

  it("連接器說明列出伺服器網址與實際提供的每個工具", async () => {
    const response = await fetchWorker("/connector");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`${BASE}/mcp`);
    for (const tool of CONNECTOR_TOOLS) expect(html).toContain(`<code>${tool.name}</code>`);
    for (const name of ASSISTANT_ONLY_TOOLS) expect(html).not.toContain(`<code>${name}</code>`);
    expect(html).toContain('href="/privacy"');
  });
});
