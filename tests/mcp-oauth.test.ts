import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 從 AI 工具的角度走一次完整流程：沒 token 被擋 → 找到授權伺服器 → 動態註冊 →
 * 使用者登入並同意 → 換 token → 呼叫 MCP 工具 → 在個人設定中斷連線。
 * 跑的是正式的 Worker 進入點與 OAuth 套件，只把 D1 與 KV 換成記憶體版。
 */

const BASE = "http://127.0.0.1:8787";
const REDIRECT = "http://127.0.0.1:9999/callback";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const fetchWorker = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}${path}`, { redirect: "manual", ...init }), env, ctx);

const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function login(userId: string): Promise<string> {
  const token = `session-${userId}-${Math.random()}`;
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, new Date(Date.now() + 86_400_000).toISOString()).run();
  return `sid=${token}`;
}

async function register(name = "Claude") {
  const response = await fetchWorker("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  expect(response.status).toBe(201);
  return (await response.json() as { client_id: string }).client_id;
}

async function authorizeUrl(clientId: string) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "st-1", code_challenge: challenge, code_challenge_method: "S256", scope: "mcp:read", resource: `${BASE}/mcp` });
  return { path: `/oauth/authorize?${query}`, verifier };
}

/** 使用者在授權頁按下「允許」或「拒絕」，回傳導回 AI 工具的網址。 */
async function consent(clientId: string, session: string, options: { write?: boolean; decision?: "approve" | "deny" } = {}) {
  const { path, verifier } = await authorizeUrl(clientId);
  const page = await fetchWorker(path, { headers: { Cookie: session } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
  const consentCookie = page.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  const form = new URLSearchParams({ handle, decision: options.decision ?? "approve", ...(options.write === false ? {} : { write: "on" }) });
  const answer = await fetchWorker(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `${session}; ${consentCookie}` }, body: form });
  expect(answer.status).toBe(302);
  return { location: new URL(answer.headers.get("Location")!), verifier, html };
}

async function connect(userId: string, options: { write?: boolean; name?: string } = {}) {
  const clientId = await register(options.name);
  const session = await login(userId);
  const { location, verifier } = await consent(clientId, session, options);
  const token = await fetchWorker("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: location.searchParams.get("code")!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }) });
  expect(token.status).toBe(200);
  return { ...(await token.json() as { access_token: string; scope: string }), session };
}

let rpcId = 0;
async function mcp(accessToken: string, method: string, params?: unknown) {
  const response = await fetchWorker("/mcp", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  return { status: response.status, body: response.status === 200 ? await response.json() as Record<string, any> : null };
}

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('elvis','elvis@example.com','陳冠宇','x','member','grp_general',0),('newbie','new@example.com','新人','x','member','grp_general',1)").run();
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p_qa','QA：GDP/GMP','grp_general','elvis','group','active','auto')").run();
});

describe("AI 工具找到授權的方式", () => {
  it("沒有 token 的 /mcp 回 401，並指向資源說明文件", async () => {
    const response = await fetchWorker("/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("資源說明與授權伺服器說明都找得到，端點是網站自己的網址", async () => {
    const resource = await (await fetchWorker("/.well-known/oauth-protected-resource/mcp")).json() as Record<string, unknown>;
    expect(resource).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["mcp:read"] });
    const server = await (await fetchWorker("/.well-known/oauth-authorization-server")).json() as Record<string, unknown>;
    expect(server).toMatchObject({ issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register` });
    expect(server.scopes_supported).toEqual(["mcp:read", "mcp:write"]);
  });
});

describe("授權頁", () => {
  it("沒登入先去登入頁，登入完回到同一個授權頁", async () => {
    const { path } = await authorizeUrl(await register());
    const response = await fetchWorker(path);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/login?next=${encodeURIComponent(path)}`);
  });

  it("顯示是哪個 AI 工具、會回到哪裡、目前是誰；AI 工具自己取的名稱會被跳脫", async () => {
    const clientId = await register('<script>alert("x")</script>');
    const { path } = await authorizeUrl(clientId);
    const page = await fetchWorker(path, { headers: { Cookie: await login("elvis") } });
    const html = await page.text();
    expect(html).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("127.0.0.1");
    expect(html).toContain("陳冠宇");
    expect(html).toContain("授權會送到這台電腦上的程式");
    expect(page.headers.get("X-Frame-Options") ?? page.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("按「拒絕」就帶著 access_denied 回到 AI 工具，不發任何 token", async () => {
    const { location } = await consent(await register(), await login("elvis"), { decision: "deny" });
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("還沒改預設密碼的帳號不能連接", async () => {
    const { path } = await authorizeUrl(await register());
    const page = await fetchWorker(path, { headers: { Cookie: await login("newbie") } });
    expect(page.status).toBe(403);
    expect(await page.text()).toContain("請先變更密碼");
  });
});

describe("連上之後", () => {
  it("勾選「新增與修改」：可以讀也可以寫，寫入記在使用者名下並註明經哪個 AI 工具", async () => {
    const { access_token, scope } = await connect("elvis");
    expect(scope.split(" ").sort()).toEqual(["mcp:read", "mcp:write"]);
    const init = await mcp(access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body?.result.serverInfo.title).toBe("艾爾水晶");
    const tools = (await mcp(access_token, "tools/list")).body!.result.tools.map((tool: { name: string }) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["list_projects", "get_project", "add_progress_update", "create_task"]));
    const listed = await mcp(access_token, "tools/call", { name: "list_projects", arguments: {} });
    expect(listed.body!.result.structuredContent.projects.map((project: { name: string }) => project.name)).toEqual(["QA：GDP/GMP"]);
    const added = await mcp(access_token, "tools/call", { name: "add_progress_update", arguments: { project: "QA：GDP/GMP", content: "AI 代寫的進度" } });
    expect(added.body!.result.isError).toBeUndefined();
    expect(await env.DB.prepare("SELECT author_id FROM progress_updates WHERE content='AI 代寫的進度'").first()).toEqual({ author_id: "elvis" });
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE action='mcp_add_progress_update'").first()).toEqual({ summary: "經 AI 連接器（Claude）新增進度紀錄到「QA：GDP/GMP」" });
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE action='mcp_connect'").first()).toEqual({ summary: "連接 AI 工具「Claude」（查看與修改）" });
  });

  it("沒勾「新增與修改」：只看得到讀取工具，硬要寫也會被拒絕", async () => {
    const { access_token, scope } = await connect("elvis", { write: false });
    expect(scope).toBe("mcp:read");
    const tools = (await mcp(access_token, "tools/list")).body!.result.tools.map((tool: { name: string }) => tool.name);
    expect(tools).not.toContain("add_progress_update");
    const refused = await mcp(access_token, "tools/call", { name: "add_progress_update", arguments: { project: "p_qa", content: "x" } });
    expect(refused.body!.result.isError).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM progress_updates").first()).toEqual({ n: 0 });
  });

  it("帳號停用後，舊的 token 立刻不能再動資料", async () => {
    const { access_token } = await connect("elvis");
    await env.DB.prepare("UPDATE users SET is_active=0 WHERE id='elvis'").run();
    const result = await mcp(access_token, "tools/call", { name: "list_projects", arguments: {} });
    expect(result.body!.result).toMatchObject({ isError: true });
    expect(result.body!.result.content[0].text).toContain("已停用");
  });

  it("個人設定看得到已連接的 AI 工具，中斷後 token 立刻失效", async () => {
    const { access_token, session } = await connect("elvis");
    const listed = await fetchWorker("/api/mcp/connections", { headers: { Cookie: session } });
    const { endpoint, connections } = await listed.json() as { endpoint: string; connections: Array<{ id: string; client_name: string; can_write: boolean }> };
    expect(endpoint).toBe(`${BASE}/mcp`);
    expect(connections).toEqual([expect.objectContaining({ client_name: "Claude", can_write: true })]);
    const removed = await fetchWorker(`/api/mcp/connections/${connections[0].id}`, { method: "DELETE", headers: { Cookie: session, Origin: BASE } });
    expect(removed.status).toBe(200);
    expect((await mcp(access_token, "tools/list")).status).toBe(401);
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE action='mcp_disconnect'").first()).toEqual({ summary: "中斷 AI 工具「Claude」的連線" });
  });

  it("別人的連線撤銷不了", async () => {
    await env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('other','o@example.com','o','x','member','grp_general',0)").run();
    const { session } = await connect("elvis");
    const mine = (await (await fetchWorker("/api/mcp/connections", { headers: { Cookie: session } })).json() as { connections: Array<{ id: string }> }).connections[0];
    const otherSession = await login("other");
    const attempt = await fetchWorker(`/api/mcp/connections/${mine.id}`, { method: "DELETE", headers: { Cookie: otherSession, Origin: BASE } });
    expect(attempt.status).toBe(404);
    expect((await (await fetchWorker("/api/mcp/connections", { headers: { Cookie: session } })).json() as { connections: unknown[] }).connections).toHaveLength(1);
  });
});
