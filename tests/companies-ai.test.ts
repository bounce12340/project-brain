import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../worker/types";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { internalApi } from "../worker/mcp/internal-api";
import { ToolError } from "../worker/mcp/protocol";
import { MCP_TOOLS, type ToolContext } from "../worker/mcp/tools";
import { assistantContext, describeAction, executeAssistantAction, runAssistantTurn } from "../worker/services/ai-agent";
import { chargeAiCall, AiQuotaError } from "../worker/services/ai-tenant";
import { ISOLATION_STAGES } from "../worker/services/tenant";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 多公司第 5 階段：AI 連接器（MCP）與站內 AI 小幫手。
 * UIC 與 B 公司各有同名的專案、同名的使用者；任何一邊的工具、確認卡、送給語言模型的內容
 * 都不能看到或指到另一邊的資料。
 */

const BASE = "http://127.0.0.1:8787";
let db: D1Database;
let baseEnv: Env;

const person = (id: string, company: "co_uic" | "co_b", group: string, name: string, role: AuthUser["role"] = "member") =>
  ({ id, email: `${id}@example.com`, name, role, group_id: group, group_name: group, group_type: "general", must_change_password: 0, company_id: company, company_name: company, is_system_admin: 0 }) as AuthUser;
const uicOwner = person("uic_owner", "co_uic", "grp_general", "陳冠宇");
const uicMate = person("uic_mate", "co_uic", "grp_general", "同組同事");
const bAdmin = person("b_admin", "co_b", "grp_b", "B 管理員", "admin");
const bMember = person("b_member", "co_b", "grp_b", "陳冠宇"); // 和 UIC 的 uic_owner 同名

const toolContext = (user: AuthUser): ToolContext => ({ user, db, baseUrl: BASE, clientName: "Claude", api: internalApi(baseEnv, undefined, user) });
async function run(name: string, args: Record<string, unknown>, user: AuthUser) {
  return MCP_TOOLS.find((item) => item.name === name)!.run(args, toolContext(user)) as Promise<Record<string, any>>;
}
async function fails(name: string, args: Record<string, unknown>, user: AuthUser): Promise<string> {
  try { await run(name, args, user); } catch (error) {
    if (error instanceof ToolError) return error.message;
    throw error;
  }
  throw new Error("預期要失敗");
}
const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();

beforeEach(async () => {
  ({ db } = createTestD1());
  baseEnv = { DB: db, APP_BASE_URL: BASE, LLM_API_KEY: "test", LLM_BASE_URL: "https://llm.test", LLM_MODEL: "m" } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("INSERT INTO companies (id,name,status) VALUES ('co_b','B 公司','active')").run();
  await db.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('grp_b','B 公司研發組','general','co_b')").run();
  for (const user of [uicOwner, uicMate, bAdmin, bMember]) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
  // 兩家公司各有一個叫「QA：GDP/GMP」的專案。
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode,description) VALUES ('p_uic','QA：GDP/GMP','grp_general','uic_owner','group','active','auto','UIC 的背景'),('p_b','QA：GDP/GMP','grp_b','b_admin','group','active','auto','B 公司的機密背景'),('p_b_only','B 公司獨有專案','grp_b','b_admin','group','active','auto','')").run();
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s_uic','p_uic','待辦','#888',0),('s_b','p_b','待辦','#888',0)").run();
  await db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position,assignee_id) VALUES ('t_uic','p_uic','s_uic','UIC 任務',0,'uic_owner'),('t_b','p_b','s_b','B 公司任務',0,'b_member')").run();
  await db.prepare("INSERT INTO milestones (id,project_id,title,due_date,kind) VALUES ('m_b','p_b','B 里程碑','2026-12-01','milestone')").run();
  await db.prepare("INSERT INTO contacts (id,organization,name,email,created_by) VALUES ('c_uic','UIC 往來廠商','王小明','wang@uic.test','uic_owner'),('c_b','B 往來廠商','李小華','li@b.test','b_admin')").run();
  await db.prepare("INSERT INTO meetings (id,kind,title,starts_at,created_by) VALUES ('mt_uic','meeting','UIC 週會','2026-12-01T10:00','uic_owner'),('mt_b','meeting','B 公司董事會','2026-12-02T10:00','b_admin')").run();
  await db.prepare("INSERT INTO reg_entries (id,entry_date,product_line,title,status,created_by) VALUES ('r_uic','2026-11-01','藥品','UIC 的法規動態','published','uic_owner'),('r_b','2026-11-02','藥品','B 公司的法規動態','published','b_admin')").run();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("標記", () => {
  it("第 5 階段完成", () => { expect(ISOLATION_STAGES.ai).toBe(true); });
});

describe("MCP 工具：專案", () => {
  it("同名專案：各公司只解析到自己的，name 與 id 都不會指到對方", async () => {
    expect((await run("get_project", { project: "QA：GDP/GMP" }, uicOwner)).id).toBe("p_uic");
    expect((await run("get_project", { project: "QA：GDP/GMP" }, bAdmin)).id).toBe("p_b");
    expect(await fails("get_project", { project: "p_b" }, uicOwner)).toMatch(/找不到專案/);
    expect(await fails("get_project", { project: "p_uic" }, bAdmin)).toMatch(/找不到專案/);
  });

  it("名稱只在對方公司存在時，錯誤訊息不透露它存在（也不猜對方的名稱）", async () => {
    const message = await fails("get_project", { project: "B 公司獨有專案" }, uicOwner);
    expect(message).toMatch(/找不到專案/);
    expect(message).not.toContain("p_b_only");
    expect(message).not.toContain("是不是");
    expect(await fails("create_task", { project: "B 公司獨有專案", title: "x" }, uicOwner)).toMatch(/找不到專案/);
  });

  it("list_projects、search、fetch 只看到自己公司", async () => {
    const uic = JSON.stringify(await run("list_projects", { status: "all" }, uicOwner));
    expect(uic).toContain("p_uic"); expect(uic).not.toContain("p_b");
    const b = JSON.stringify(await run("list_projects", { status: "all" }, bAdmin));
    expect(b).toContain("p_b"); expect(b).not.toContain("p_uic");
    expect(JSON.stringify(await run("search", { query: "QA" }, uicOwner))).not.toContain("p_b");
    expect(JSON.stringify(await run("search", { query: "B 公司獨有" }, uicOwner))).not.toContain("p_b_only");
    expect(await fails("fetch", { id: "p_b" }, uicOwner)).toMatch(/找不到專案/);
    expect(await fails("fetch", { id: "p_uic" }, bAdmin)).toMatch(/找不到專案/);
  });

  it("用別家公司的任務、里程碑 id 讀寫都被擋，資料不變", async () => {
    expect(await fails("update_task", { task_id: "t_b", done: true }, uicOwner)).toMatch(/找不到任務/);
    expect(await fails("delete_task", { task_id: "t_b" }, uicOwner)).toMatch(/找不到任務/);
    expect(await fails("update_milestone", { milestone_id: "m_b", done: true }, uicOwner)).toMatch(/找不到里程碑/);
    expect(await fails("delete_milestone", { milestone_id: "m_b" }, uicOwner)).toMatch(/找不到里程碑/);
    expect(await fails("update_task", { task_id: "t_uic", done: true }, bAdmin)).toMatch(/找不到任務/);
    expect(await row("SELECT done FROM tasks WHERE id='t_b'")).toEqual({ done: 0 });
    expect(await row("SELECT id FROM milestones WHERE id='m_b'")).toBeTruthy();
  });

  it("list_my_work 不列別家公司的任務", async () => {
    // 即使把別家公司的任務指派給 UIC 的人（髒資料），也不會出現。
    await db.prepare("UPDATE tasks SET assignee_id='uic_owner',due_date='2026-11-25' WHERE id='t_b'").run();
    const mine = JSON.stringify(await run("list_my_work", { days_ahead: 60, include_undated: true }, uicOwner));
    expect(mine).not.toContain("B 公司任務");
  });
});

describe("MCP 工具：使用者名稱與 Email", () => {
  it("負責人同名時只比對自己公司，不會誤判成同名衝突或指到對方", async () => {
    // 兩家公司都有「陳冠宇」：UIC 的人指派時只會找到 UIC 那位。
    await run("update_task", { task_id: "t_uic", assignee: "陳冠宇" }, uicOwner);
    expect(await row("SELECT assignee_id FROM tasks WHERE id='t_uic'")).toEqual({ assignee_id: "uic_owner" });
    await run("update_task", { task_id: "t_b", assignee: "陳冠宇" }, bAdmin);
    expect(await row("SELECT assignee_id FROM tasks WHERE id='t_b'")).toEqual({ assignee_id: "b_member" });
  });

  it("別家公司的人（姓名或 Email）找不到", async () => {
    expect(await fails("update_task", { task_id: "t_uic", assignee: "b_admin@example.com" }, uicOwner)).toMatch(/找不到使用者/);
    expect(await fails("update_task", { task_id: "t_uic", assignee: "B 管理員" }, uicOwner)).toMatch(/找不到使用者/);
    expect(await fails("update_task", { task_id: "t_b", assignee: "uic_mate@example.com" }, bAdmin)).toMatch(/找不到使用者/);
    expect(await row("SELECT assignee_id FROM tasks WHERE id='t_uic'")).toEqual({ assignee_id: "uic_owner" });
  });
});

describe("MCP 工具：聯絡人、會議、法規（雙向）", () => {
  it("search_contacts", async () => {
    const uic = JSON.stringify(await run("search_contacts", { query: "往來廠商" }, uicOwner));
    expect(uic).toContain("c_uic"); expect(uic).not.toContain("c_b");
    const b = JSON.stringify(await run("search_contacts", { query: "往來廠商" }, bAdmin));
    expect(b).toContain("c_b"); expect(b).not.toContain("c_uic");
  });

  it("list_meetings", async () => {
    const uic = JSON.stringify(await run("list_meetings", {}, uicOwner));
    expect(uic).toContain("mt_uic"); expect(uic).not.toContain("mt_b");
    const b = JSON.stringify(await run("list_meetings", {}, bAdmin));
    expect(b).toContain("mt_b"); expect(b).not.toContain("mt_uic");
    expect(await fails("update_meeting", { meeting_id: "mt_b", title: "改名" }, uicOwner)).toMatch(/找不到會議/);
  });

  it("list_regulations", async () => {
    const uic = JSON.stringify(await run("list_regulations", {}, uicOwner));
    expect(uic).toContain("r_uic"); expect(uic).not.toContain("r_b");
    const b = JSON.stringify(await run("list_regulations", {}, bAdmin));
    expect(b).toContain("r_b"); expect(b).not.toContain("r_uic");
  });

  it("create_regulation 草稿由建立者的公司看得到，別家公司看不到", async () => {
    const created = await run("create_regulation", { title: "UIC 新增的公告", entry_date: "2026-11-10", product_line: "藥品" }, uicOwner);
    expect(created.ok).toBe(true);
    expect(await row("SELECT created_by FROM reg_entries WHERE id=?", created.id)).toEqual({ created_by: "uic_owner" });
    expect(JSON.stringify(await run("list_regulations", { keyword: "UIC 新增" }, bAdmin))).not.toContain(created.id);
  });
});

describe("站內 AI 小幫手", () => {
  /** 假語言模型；記下每次送出的 messages 全文。 */
  function fakeLlm(replies: Array<{ content?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(String(init.body));
      const reply = replies.shift() ?? { content: "好" };
      const tool_calls = reply.calls?.map((call, index) => ({ id: `call_${seen.length}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }));
      return new Response(JSON.stringify({ choices: [{ message: { content: reply.content ?? null, tool_calls } }] }), { headers: { "Content-Type": "application/json" } });
    }));
    return seen;
  }
  const ctxOf = (user: AuthUser) => assistantContext(baseEnv, undefined, user);

  it("查資料的工具結果（交給語言模型的內容）不含別家公司的資料", async () => {
    const seen = fakeLlm([
      { calls: [{ name: "list_projects", args: { status: "all" } }, { name: "search_contacts", args: { query: "廠商" } }, { name: "list_meetings", args: {} }, { name: "list_regulations", args: {} }] },
      { content: "完成" },
    ]);
    await runAssistantTurn(baseEnv, ctxOf(uicOwner), { question: "看一下", history: [], lang: "zh", openProject: null });
    const sent = seen[1];
    expect(sent).toContain("p_uic"); expect(sent).toContain("c_uic");
    for (const secret of ["p_b", "B 公司", "c_b", "mt_b", "r_b", "b_admin"]) expect(sent, secret).not.toContain(secret);
  });

  it("反向：B 公司的小幫手也看不到 UIC", async () => {
    const seen = fakeLlm([{ calls: [{ name: "list_projects", args: { status: "all" } }, { name: "search_contacts", args: { query: "廠商" } }] }, { content: "完成" }]);
    await runAssistantTurn(baseEnv, ctxOf(bAdmin), { question: "看一下", history: [], lang: "zh", openProject: null });
    for (const secret of ["p_uic", "UIC 任務", "c_uic", "往來廠商\"", "uic_owner"]) expect(seen[1], secret).not.toContain(secret);
  });

  it("確認卡的名稱在公司內解析：別家公司的 id 丟錯誤、不出名稱", async () => {
    await expect(describeAction(ctxOf(uicOwner), "update_task", { task_id: "t_b", done: true }, "zh")).rejects.toThrow(/找不到任務/);
    await expect(describeAction(ctxOf(uicOwner), "update_milestone", { milestone_id: "m_b", done: true }, "zh")).rejects.toThrow(/找不到里程碑/);
    await expect(describeAction(ctxOf(uicOwner), "create_task", { project: "B 公司獨有專案", title: "x" }, "zh")).rejects.toThrow(/找不到專案/);
    // 同名專案解析到自己公司的那個，確認卡不會因為同名而報「好幾個專案」。
    expect(await describeAction(ctxOf(bAdmin), "create_task", { project: "QA：GDP/GMP", title: "x" }, "zh")).toEqual(["專案：QA：GDP/GMP", "名稱：x"]);
  });

  it("按確認時也只作用在自己公司（即使卡片被竄改成別家公司的 id）", async () => {
    await expect(executeAssistantAction(ctxOf(uicOwner), "update_task", { task_id: "t_b", done: true })).rejects.toBeInstanceOf(ToolError);
    await expect(executeAssistantAction(ctxOf(uicOwner), "create_task", { project: "p_b", title: "闖入" })).rejects.toBeInstanceOf(ToolError);
    expect(await row("SELECT COUNT(*) AS n FROM tasks WHERE project_id='p_b'")).toEqual({ n: 1 });
  });

  describe("HTTP 端點", () => {
    const sessions: Record<string, string> = {};
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    const post = (userId: string, path: string, body: unknown, env = baseEnv) =>
      worker.fetch(new Request(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);

    beforeEach(async () => {
      await db.prepare("UPDATE users SET must_change_password=0").run();
      for (const user of [uicOwner, bAdmin]) {
        const token = `session-${user.id}`;
        await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), user.id, new Date(Date.now() + 86_400_000).toISOString()).run();
        sessions[user.id] = `sid=${token}`;
      }
    });

    it("/api/ai/assistant 送給語言模型的專案只含自己公司", async () => {
      const seen = fakeLlm([{ content: "好" }]);
      const response = await post("uic_owner", "/api/ai/assistant", { question: "有哪些專案", project_id: "p_uic" });
      expect(response.status).toBe(200);
      expect(seen[0]).toContain("UIC 的背景");
      for (const secret of ["B 公司", "p_b"]) expect(seen[0], secret).not.toContain(secret);
    });

    it("帶別家公司的專案 id：所有 /api/ai 端點回找不到，也不呼叫語言模型", async () => {
      const seen = fakeLlm([]);
      for (const path of ["/api/ai/assistant", "/api/ai/organize", "/api/ai/project-risk", "/api/ai/task-summary", "/api/ai/draft-update", "/api/ai/progress-links", "/api/ai/schedule-suggest"]) {
        const response = await post("uic_owner", path, { project_id: "p_b", question: "x", brief: "x", raw_text: "x", content: "x" });
        expect(response.status, path).toBe(404);
      }
      expect(seen).toHaveLength(0);
      const reverse = await post("b_admin", "/api/ai/organize", { project_id: "p_uic", brief: "x" });
      expect(reverse.status).toBe(404);
    });
  });
});

describe("AI 用量與每日上限", () => {
  it("每家公司分開計數，達上限後回繁體中文錯誤", async () => {
    const env = { ...baseEnv, AI_DAILY_CALL_CAP: "2" } as unknown as Env;
    await chargeAiCall(env, "co_uic");
    await chargeAiCall(env, "co_uic");
    await expect(chargeAiCall(env, "co_uic")).rejects.toBeInstanceOf(AiQuotaError);
    await expect(chargeAiCall(env, "co_uic")).rejects.toThrow("今天的 AI 使用次數已達上限");
    await chargeAiCall(env, "co_b"); // 另一家公司不受影響
    expect((await row<{ calls: number }>("SELECT calls FROM ai_usage WHERE company_id='co_uic'"))?.calls).toBe(2);
    expect((await row<{ calls: number }>("SELECT calls FROM ai_usage WHERE company_id='co_b'"))?.calls).toBe(1);
  });

  it("預設上限夠高，UIC 的一般使用不受影響", async () => {
    for (let i = 0; i < 50; i += 1) await chargeAiCall(baseEnv, "co_uic");
    expect((await row<{ calls: number }>("SELECT calls FROM ai_usage WHERE company_id='co_uic'"))?.calls).toBe(50);
  });

  it("/api/ai 端點超過上限回 429，不呼叫語言模型", async () => {
    const env = { ...baseEnv, AI_DAILY_CALL_CAP: "1" } as unknown as Env;
    await db.prepare("UPDATE users SET must_change_password=0").run();
    const token = "session-cap";
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), "uic_owner", new Date(Date.now() + 86_400_000).toISOString()).run();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "好" } }] }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    const call = () => worker.fetch(new Request(`${BASE}/api/ai/assistant`, { method: "POST", body: JSON.stringify({ question: "hi" }), headers: { Cookie: `sid=${token}`, Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
    expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toContain("已達上限");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("MCP 授權", () => {
  it("連線清單與中斷以登入者為範圍（grant 本來就是每人一份）", async () => {
    const listed: string[] = [];
    const revoked: Array<[string, string]> = [];
    const oauth = {
      listUserGrants: async (userId: string) => { listed.push(userId); return { items: userId === "uic_owner" ? [{ id: "g1", clientId: "c", scope: ["mcp:write"], metadata: { clientName: "Claude" } }] : [], cursor: undefined }; },
      revokeGrant: async (id: string, userId: string) => { revoked.push([id, userId]); },
      lookupClient: async () => null,
    };
    await db.prepare("UPDATE users SET must_change_password=0").run();
    const token = "session-grant";
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), "b_admin", new Date(Date.now() + 86_400_000).toISOString()).run();
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    const env = { ...baseEnv, OAUTH_PROVIDER: oauth } as unknown as Env;
    const headers = { Cookie: `sid=${token}`, Origin: BASE };
    const list = await worker.fetch(new Request(`${BASE}/api/mcp/connections`, { headers }), env, ctx);
    expect(((await list.json()) as { connections: unknown[] }).connections).toEqual([]);
    const del = await worker.fetch(new Request(`${BASE}/api/mcp/connections/g1`, { method: "DELETE", headers }), env, ctx);
    expect(del.status).toBe(404);
    expect(listed.every((id) => id === "b_admin")).toBe(true);
    expect(revoked).toEqual([]);
  });
});
