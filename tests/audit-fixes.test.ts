import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { taipeiDate } from "../worker/services/time";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 多公司上線後的獨立審查修正：
 * 1. 公司管理員不能改、停用、刪除系統管理員，也不能重設其密碼。
 * 2、3. CCR 編號與專案代碼各公司各自唯一（migration 0034）。
 * 4. 不存在與屬於別家公司的資料回一樣的「找不到」。
 * 5. 只有系統原本的公司看得到公開註冊開關。
 * 6. AI 連線診斷只給系統管理員。
 * 7. 會呼叫語言模型的報表與法規 AI 端點也計入公司每日 AI 用量。
 * 8. Email 重複時不透露該 Email 已被其他公司使用。
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
const del = send("DELETE");
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.batch([
    db.prepare("UPDATE users SET must_change_password=0"),
    db.prepare("INSERT INTO companies (id,name,status) VALUES ('co_b','B 公司','active')"),
    db.prepare("INSERT INTO groups (id,name,type,company_id) VALUES ('grp_b','RA/PV組','general','co_b'),('grp_b_qa','QA組','qa','co_b')"),
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('b_admin','b_admin@b.test','B 管理員','x','admin','grp_b',0),('uic_admin','uic_admin@uic.test','UIC 管理員','x','admin','grp_general',0)"),
    db.prepare("INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at,external_key) VALUES ('prj_uic_qa','UIC QA','','grp_qa','uic_admin','all','active',0,datetime('now'),'KEY-1'),('prj_b_qa','B QA','','grp_b_qa','b_admin','all','active',0,datetime('now'),NULL)"),
    db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('stg_uic','prj_uic_qa','進行中','#888',0)"),
    db.prepare("INSERT INTO tasks (id,project_id,stage_id,title,position) VALUES ('tsk_uic','prj_uic_qa','stg_uic','UIC 的工作',0)"),
  ]);
  for (const id of ["usr_admin", "b_admin", "uic_admin"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
});

describe("1. 系統管理員的帳號受保護", () => {
  it("同公司的一般管理員不能改、刪、重設系統管理員", async () => {
    expect((await patch("uic_admin", "/api/admin/users/usr_admin", { role: "member" })).status).toBe(403);
    expect((await patch("uic_admin", "/api/admin/users/usr_admin", { is_active: false })).status).toBe(403);
    expect((await post("uic_admin", "/api/admin/users/usr_admin/reset-password")).status).toBe(403);
    expect((await del("uic_admin", "/api/admin/users/usr_admin")).status).toBe(403);
    expect(await one("SELECT role,is_active FROM users WHERE id='usr_admin'")).toEqual({ role: "admin", is_active: 1 });
  });

  it("系統管理員自己仍可管理一般帳號", async () => {
    expect((await patch("usr_admin", "/api/admin/users/uic_admin", { name: "改名" })).status).toBe(200);
  });
});

describe("8. Email 重複不透露是哪家公司的", () => {
  it("新增與修改都回同一句通用訊息", async () => {
    const created = await post("b_admin", "/api/admin/users", { email: "uic_admin@uic.test", name: "撞信箱", role: "member", group_id: "grp_b", password: "Passw0rd!long" });
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(created.body)).not.toMatch(/已被使用|已存在|UIC/);
    const changed = await patch("b_admin", "/api/admin/users/b_admin", { email: "uic_admin@uic.test" });
    expect(changed.status).toBe(422);
    expect(changed.body.error).toBe("這個 Email 無法使用，請換一個");
  });
});

describe("5. 公開註冊開關只屬於系統原本的公司", () => {
  it("其他公司的管理員看不到開關", async () => {
    const other = await get("b_admin", "/api/admin/registrations");
    expect(other.status).toBe(200);
    expect(other.body.public_registration).toBe(false);
    expect(other.body.enabled).toBe(false);
    expect((await get("uic_admin", "/api/admin/registrations")).body.public_registration).toBe(true);
  });
});

describe("6. AI 連線診斷", () => {
  it("公司管理員不能用，系統管理員可以", async () => {
    expect((await get("uic_admin", "/api/ai/diagnostics")).status).toBe(403);
    expect((await get("b_admin", "/api/ai/diagnostics")).status).toBe(403);
    expect((await get("usr_admin", "/api/ai/diagnostics")).status).not.toBe(403);
  });
});

describe("4. 不存在與別家公司的資料回一樣的結果", () => {
  it("別家公司的工作和不存在的工作，回應一模一樣", async () => {
    const foreign = await patch("b_admin", "/api/tasks/tsk_uic", { title: "x" });
    const missing = await patch("b_admin", "/api/tasks/tsk_nope", { title: "x" });
    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
  });

  it("AI 任務摘要：別家公司的任務回 404「找不到任務」，不是 403", async () => {
    const foreign = await post("b_admin", "/api/ai/task-summary", { task_id: "tsk_uic" });
    expect(foreign).toEqual({ status: 404, body: { error: "找不到任務" } });
    expect(await post("b_admin", "/api/ai/task-summary", { task_id: "tsk_nope" })).toEqual(foreign);
    // 擋在計費之前，不算用量。
    expect(await one("SELECT COUNT(*) AS n FROM ai_usage")).toEqual({ n: 0 });
  });
});

describe("7. 報表與法規 AI 也計入每日用量", () => {
  beforeEach(async () => {
    env = { ...env, AI_DAILY_CALL_CAP: "1" } as unknown as Env;
    await env.DB.prepare("INSERT INTO ai_usage (company_id,day,calls) VALUES ('co_b',?,1)").bind(taipeiDate()).run();
  });

  it("已達上限時回 429，不呼叫語言模型", async () => {
    for (const [path, body] of [
      ["/api/reports/ai/generate", { scope: "all", period: "this-week" }],
      ["/api/reports/ai/regenerate", {}],
      ["/api/regwatch/ai-extract", { text: "公告內容" }],
      ["/api/regwatch/tfda-fetch", {}],
    ] as const) {
      const response = await post("b_admin", path, body);
      expect(response.status, path).toBe(429);
      expect(response.body.error, path).toContain("今天的 AI 使用次數已達上限");
    }
    // 別家公司不受影響（UIC 還沒用過，第一次照常計數）。
    expect((await post("uic_admin", "/api/regwatch/ai-extract", { text: "公告內容" })).status).not.toBe(429);
    expect(await one("SELECT calls FROM ai_usage WHERE company_id='co_uic'")).toEqual({ calls: 1 });
  });
});

describe("2、3. migration 0034：CCR 編號與專案代碼各公司各自唯一", () => {
  it("既有專案補上 company_id，之後新增與換組自動跟著組別的公司", async () => {
    expect(await one("SELECT COUNT(*) AS n FROM projects WHERE company_id IS NULL")).toEqual({ n: 0 });
    expect(await one("SELECT company_id FROM projects WHERE id='prj_b_qa'")).toEqual({ company_id: "co_b" });
    await env.DB.prepare("UPDATE projects SET group_id='grp_b' WHERE id='prj_b_qa'").run();
    expect(await one("SELECT company_id FROM projects WHERE id='prj_b_qa'")).toEqual({ company_id: "co_b" });
  });

  it("專案代碼：別家公司可用同一個，同公司不能重複", async () => {
    await env.DB.prepare("UPDATE projects SET external_key='KEY-1' WHERE id='prj_b_qa'").run();
    await expect(env.DB.prepare("INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at,external_key) VALUES ('prj_dup','重複','','grp_general','uic_admin','all','active',0,datetime('now'),'KEY-1')").run()).rejects.toThrow(/UNIQUE/);
  });

  it("CCR 編號每家公司各自從 001 起算", async () => {
    const year = taipeiDate().slice(0, 4);
    const ccr = { title: "變更", target_type: "文件", description: "說明", reason: "原因", classification: "次要" };
    const uic = await post("uic_admin", "/api/projects/prj_uic_qa/ccrs", ccr);
    expect(uic.status).toBe(201);
    expect(uic.body.ccr_no).toBe(`CCR-${year}-001`);
    const b = await post("b_admin", "/api/projects/prj_b_qa/ccrs", ccr);
    expect(b.status).toBe(201);
    expect(b.body.ccr_no).toBe(`CCR-${year}-001`);
    expect((await post("uic_admin", "/api/projects/prj_uic_qa/ccrs", ccr)).body.ccr_no).toBe(`CCR-${year}-002`);
    expect(await one("SELECT company_id FROM ccr_records WHERE id=?", b.body.id)).toEqual({ company_id: "co_b" });
  });

  it("同公司的 CCR 編號仍不能重複", async () => {
    const insert = (id: string) => env.DB.prepare("INSERT INTO ccr_records (id,project_id,ccr_no,title,target_type,description,reason,classification,requested_by) VALUES (?,'prj_uic_qa','CCR-2026-900','t','文件','d','r','次要','uic_admin')").bind(id).run();
    await insert("ccr_a");
    expect(await one("SELECT company_id FROM ccr_records WHERE id='ccr_a'")).toEqual({ company_id: "co_uic" });
    await expect(insert("ccr_b")).rejects.toThrow(/UNIQUE/);
  });
});
