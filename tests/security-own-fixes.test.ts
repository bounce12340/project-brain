import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { safeHttpUrl } from "../worker/services/http";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 資安測試的修正：
 * - 法規動態的來源連結只收 http(s)，javascript: 這類連結存不進去。
 * - 看不到專案的人也改不到它（私人專案的同組成員）。
 * - 自動化規則的通知／指派／待辦對象必須看得到專案。
 */

const BASE = "https://brain.test";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const sessions: Record<string, string> = {};

async function request(path: string, init: RequestInit & { as?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.as) headers.set("Cookie", sessions[init.as]);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("Origin", BASE);
  const response = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, ctx);
  return { status: response.status, body: await response.json().catch(() => null) as any };
}
const get = (as: string, path: string) => request(path, { as });
const send = (method: string) => (as: string, path: string, body?: unknown) => request(path, { method, as, body: body === undefined ? undefined : JSON.stringify(body) });
const post = send("POST");
const patch = send("PATCH");

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.batch([
    db.prepare("UPDATE users SET must_change_password=0"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('owner','owner@t.test','擁有者','x','member','grp_general',0),('peer','peer@t.test','同組成員','x','member','grp_general',0),('intern','intern@t.test','實習生','x','intern','grp_general',0)"),
    db.prepare("INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at) VALUES ('prj_secret','機密專案','','grp_general','owner','private','active',0,datetime('now')),('prj_open','公開專案','','grp_general','owner','all','active',0,datetime('now'))"),
    db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('stg_s','prj_secret','進行中','#888',0)"),
    db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('tsk_s','prj_secret','stg_s','機密工作',0)"),
  ]);
  for (const id of ["usr_admin", "owner", "peer", "intern"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
});

describe("來源連結只收 http(s)", () => {
  it("safeHttpUrl 擋掉 javascript:、data: 與不完整的網址", () => {
    expect(safeHttpUrl("https://www.fda.gov.tw/x?id=1")).toBe("https://www.fda.gov.tw/x?id=1");
    expect(safeHttpUrl("  http://a.test ")).toBe("http://a.test");
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x", "//evil.test", "www.fda.gov.tw", "https://", 42, null]) {
      expect(safeHttpUrl(bad), String(bad)).toBeNull();
    }
  });

  it("新增與修改法規動態時拒絕 javascript: 連結", async () => {
    const entry = { entry_date: "2026-01-02", entry_type: "announcement", product_line: "藥品", title: "公告" };
    const bad = await post("usr_admin", "/api/regwatch", { ...entry, link: "javascript:fetch('/api/admin/users')" });
    expect(bad.status).toBe(422);
    const ok = await post("usr_admin", "/api/regwatch", { ...entry, link: "https://www.fda.gov.tw/a" });
    expect(ok.status).toBe(201);
    expect((await patch("usr_admin", `/api/regwatch/${ok.body.id}`, { link: "javascript:alert(1)" })).status).toBe(422);
    expect(await env.DB.prepare("SELECT link FROM reg_entries WHERE id=?").bind(ok.body.id).first()).toEqual({ link: "https://www.fda.gov.tw/a" });
    // 清掉連結仍然可以。
    expect((await patch("usr_admin", `/api/regwatch/${ok.body.id}`, { link: "" })).status).toBe(200);
  });

  it("AI 匯入帶的來源連結不是 http(s) 時直接丟掉", async () => {
    const response = await post("usr_admin", "/api/regwatch/batch", { entries: [{ entry_date: "2026-01-03", entry_type: "announcement", product_line: "藥品", title: "AI 草稿", link: "javascript:alert(1)" }] });
    expect(response.status).toBeLessThan(300);
    expect(await env.DB.prepare("SELECT link FROM reg_entries WHERE title='AI 草稿'").first()).toEqual({ link: null });
  });
});

describe("看不到專案就改不到", () => {
  it("同組成員打不開私人專案，也不能改它的工作、加進度、建規則或連待辦", async () => {
    expect((await get("peer", "/api/projects/prj_secret")).status).toBe(403);
    expect((await patch("peer", "/api/tasks/tsk_s", { title: "改掉" })).status).toBe(403);
    expect((await post("peer", "/api/projects/prj_secret/progress-updates", { content: "偷加", status_color: "green" })).status).toBe(403);
    expect((await post("peer", "/api/projects/prj_secret/rules", { name: "規則", trigger_type: "task_done", action_type: "log_update" })).status).toBe(403);
    expect(await env.DB.prepare("SELECT title FROM tasks WHERE id='tsk_s'").first()).toEqual({ title: "機密工作" });
  });

  it("擁有者與管理員照常可以改", async () => {
    expect((await patch("owner", "/api/tasks/tsk_s", { title: "擁有者改" })).status).toBe(200);
    expect((await patch("usr_admin", "/api/tasks/tsk_s", { title: "管理員改" })).status).toBe(200);
  });
});

describe("自動化規則的對象必須看得到專案", () => {
  it("私人專案的規則不能通知、指派或建待辦給看不到它的人", async () => {
    for (const action of ["notify_user", "assign_task_to", "create_todo_for"]) {
      const blocked = await post("owner", "/api/projects/prj_secret/rules", { name: "規則", trigger_type: "task_done", action_type: action, action_param_user: "peer" });
      expect(blocked.status, action).toBe(422);
    }
    expect((await post("owner", "/api/projects/prj_secret/rules", { name: "規則", trigger_type: "task_done", action_type: "notify_user", action_param_user: "intern" })).status).toBe(422);
    // 看得到的人（管理員）可以。
    expect((await post("owner", "/api/projects/prj_secret/rules", { name: "規則", trigger_type: "task_done", action_type: "notify_user", action_param_user: "usr_admin" })).status).toBe(201);
  });

  it("全公司可見的專案照常可以指定同組成員", async () => {
    expect((await post("owner", "/api/projects/prj_open/rules", { name: "規則", trigger_type: "task_done", action_type: "notify_user", action_param_user: "peer" })).status).toBe(201);
  });
});
