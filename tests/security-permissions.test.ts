import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { canGenerateReport, canReadReport } from "../worker/services/reports";
import { ImportValidationError, runImport } from "../worker/services/import-data";
import type { AuthUser } from "../worker/types";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 權限審查修正：
 * 1. AI 報告：實習生不能產／讀組別或全公司報告，只能產「我參與的專案」個人報告。
 * 2. CCR：核准／駁回限管理員或 QA 組，且不能核准自己提的 CCR；匯入已核准狀態同規則。
 * 3. 成員模式匯入：非負責人不能改既有專案的可見性、狀態、名稱。
 */

const BASE = "https://brain.test";
let env: Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const sessions: Record<string, string> = {};

async function request(method: string, as: string, path: string, body?: unknown) {
  const headers = new Headers({ Cookie: sessions[as] });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET") headers.set("Origin", BASE);
  const response = await worker.fetch(new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: response.status, body: await response.json().catch(() => null) as any };
}
const get = (as: string, path: string) => request("GET", as, path);
const post = (as: string, path: string, body?: unknown) => request("POST", as, path, body);
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();

const USERS: Array<[string, string, string]> = [
  ["adm", "admin", "grp_general"], ["mem", "member", "grp_general"], ["mem2", "member", "grp_general"], ["kid", "intern", "grp_general"], ["kid2", "intern", "grp_general"],
  ["qa1", "member", "grp_qa"], ["kidqa", "intern", "grp_qa"],
];

const actor = (id: string, role: string, group = "grp_general", type = "general") =>
  ({ id, email: `${id}@example.com`, name: id, role, group_id: group, group_name: group, group_type: type, company_id: "co_uic", company_name: "UIC", is_system_admin: 0 }) as AuthUser;

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("UPDATE users SET must_change_password=0").run();
  for (const [id, role, group] of USERS) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(id, `${id}@example.com`, id, "x", role, group).run();
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
  await db.batch([
    db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p_in','實習生參與案','grp_general','mem','private','active','auto'),('p_grp','同組公開案','grp_general','mem','group','active','auto'),('p_priv','別人私密案','grp_general','mem','private','active','auto'),('p_own','實習生自己的案','grp_general','kid','group','active','auto')"),
    db.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES ('p_in','kid','mem')"),
  ]);
});

describe("1. AI 報告", () => {
  it("純函式：實習生不能產／讀組別與全公司報告，個人報告只有本人", () => {
    const intern = { id: "kid", role: "intern", group_id: "grp_general" } as const;
    expect(canGenerateReport(intern, "grp_general", false)).toBe(false);
    expect(canGenerateReport(intern, "all", false)).toBe(false);
    expect(canGenerateReport(intern, "mine", false)).toBe(true);
    expect(canGenerateReport(intern, "mine", true)).toBe(false);
    expect(canReadReport(intern, { scope: "grp_general", include_private: 0 })).toBe(false);
    expect(canReadReport(intern, { scope: "mine", include_private: 0, owner_user_id: "kid" })).toBe(true);
    expect(canReadReport(intern, { scope: "mine", include_private: 0, owner_user_id: "kid2" })).toBe(false);
    expect(canReadReport(intern, { scope: "mine", include_private: 0, owner_user_id: null })).toBe(false);
  });

  it("實習生產組別報告與全公司報告被擋（403）", async () => {
    expect((await post("kid", "/api/reports/ai/generate", { scope: "grp_general", period: "last-week" })).status).toBe(403);
    expect((await post("kid", "/api/reports/ai/generate", { scope: "all", period: "last-week" })).status).toBe(403);
  });

  it("實習生的個人報告只含自己是擁有者或成員的專案，不含同組其他專案與私密案", async () => {
    const res = await post("kid", "/api/reports/ai/generate", { scope: "mine", period: "last-week" });
    expect(res.status).toBe(201);
    const md: string = res.body.report.content_md;
    expect(md).toContain("實習生參與案");
    expect(md).toContain("實習生自己的案");
    expect(md).not.toContain("同組公開案");
    expect(md).not.toContain("別人私密案");
    expect(res.body.report.owner_user_id).toBe("kid");
    expect(res.body.report.scope_name).toContain("個人");
  });

  it("個人報告只有本人（與同公司管理員）讀得到；其他實習生與同組成員讀不到", async () => {
    const id = (await post("kid", "/api/reports/ai/generate", { scope: "mine", period: "last-week" })).body.report.id;
    expect((await get("kid", `/api/reports/ai/${id}`)).status).toBe(200);
    expect((await get("kid2", `/api/reports/ai/${id}`)).status).toBe(403);
    expect((await get("mem", `/api/reports/ai/${id}`)).status).toBe(403);
    expect((await get("adm", `/api/reports/ai/${id}`)).status).toBe(200);
    expect((await get("kid2", "/api/reports/ai")).body.reports).toEqual([]);
    expect((await get("kid", "/api/reports/ai")).body.reports.map((r: any) => r.id)).toEqual([id]);
  });

  it("實習生列表看不到同組的組別報告（含舊資料）", async () => {
    await env.DB.prepare("INSERT INTO ai_reports (id,period_start,period_end,scope,content_md,period_type,include_private,company_id) VALUES ('old','2026-01-01','2026-01-07','grp_general','同組公開案','week',0,'co_uic')").run();
    expect((await get("kid", "/api/reports/ai")).body.reports).toEqual([]);
    expect((await get("kid", "/api/reports/ai/old")).status).toBe(403);
    expect((await get("mem", "/api/reports/ai/old")).status).toBe(200);
  });

  it("成員仍可產自己組別報告，也可產個人報告", async () => {
    expect((await post("mem", "/api/reports/ai/generate", { scope: "grp_general", period: "last-week" })).status).toBe(201);
    expect((await post("mem", "/api/reports/ai/generate", { scope: "mine", period: "last-week" })).status).toBe(201);
  });
});

describe("2. CCR 核准", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode) VALUES ('p_qa','QA 專案','grp_qa','qa1','all','active','auto')"),
      env.DB.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES ('p_qa','kid','qa1')"),
      env.DB.prepare("INSERT INTO ccr_records (id,company_id,project_id,ccr_no,title,target_type,description,reason,classification,status,requested_by) VALUES ('c_kid','co_uic','p_qa','CCR-2026-001','實習生提的','其他','d','r','次要','評估中','kid'),('c_qa1','co_uic','p_qa','CCR-2026-002','QA 提的','其他','d','r','次要','評估中','qa1'),('c_adm','co_uic','p_qa','CCR-2026-003','管理員提的','其他','d','r','次要','評估中','adm')"),
    ]);
  });
  const move = (as: string, id: string, status: string) => post(as, `/api/ccrs/${id}/transition`, { status });
  const status = async (id: string) => (await one("SELECT status FROM ccr_records WHERE id=?", id))?.status;

  it("實習生（專案成員）不能核准或駁回自己的 CCR", async () => {
    const approve = await move("kid", "c_kid", "已核准");
    expect(approve.status).toBe(403);
    expect(approve.body.error).toContain("QA");
    expect((await move("kid", "c_kid", "駁回")).status).toBe(403);
    expect(await status("c_kid")).toBe("評估中");
  });

  it("非 QA 組的成員（有編輯權）不能核准", async () => {
    await env.DB.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES ('p_qa','mem','qa1')").run();
    expect((await move("mem", "c_qa1", "已核准")).status).toBe(403);
  });

  it("QA 組成員可核准別人的 CCR，但不能核准自己的", async () => {
    expect((await move("qa1", "c_qa1", "已核准")).status).toBe(403);
    expect((await move("qa1", "c_kid", "已核准")).status).toBe(200);
    expect(await status("c_kid")).toBe("已核准");
  });

  it("管理員可核准／駁回別人的，不能核准自己的（駁回自己的不受此限）", async () => {
    expect((await move("adm", "c_adm", "已核准")).status).toBe(403);
    expect((await move("adm", "c_qa1", "已核准")).status).toBe(200);
    expect((await move("adm", "c_adm", "駁回")).status).toBe(200);
  });

  it("其他流轉維持原規則：實習生仍可把 CCR 從申請推到評估中", async () => {
    await env.DB.prepare("UPDATE ccr_records SET status='申請' WHERE id='c_kid'").run();
    expect((await move("kid", "c_kid", "評估中")).status).toBe(200);
  });

  it("列表回傳 can_approve", async () => {
    expect((await get("kid", "/api/projects/p_qa/ccrs")).body.can_approve).toBe(false);
    expect((await get("qa1", "/api/projects/p_qa/ccrs")).body.can_approve).toBe(true);
    expect((await get("adm", "/api/projects/p_qa/ccrs")).body.can_approve).toBe(true);
  });

  it("匯入：非核准人不能直接匯入已核准以後的 CCR，申請／評估中可以", async () => {
    const payload = (status: string) => ({ projects: [{ name: "QA 專案", ccrs: [{ title: `匯入-${status}`, status }] }] });
    const intern = actor("kid", "intern");
    for (const s of ["已核准", "執行中", "效期確認", "已結案"]) {
      await expect(runImport(env.DB, intern, payload(s), { mode: "admin" })).rejects.toBeInstanceOf(ImportValidationError);
    }
    expect((await runImport(env.DB, intern, payload("評估中"), { mode: "admin" })).projects.updated).toBe(1);
    await runImport(env.DB, actor("qa1", "member", "grp_qa", "qa"), payload("已核准"), { mode: "admin" });
    expect(await one("SELECT status FROM ccr_records WHERE title='匯入-已核准'")).toEqual({ status: "已核准" });
  });
});

describe("3. 成員模式匯入既有專案", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE projects SET external_key='K-GRP' WHERE id='p_grp'").run();
    await env.DB.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES ('p_grp','kid','mem')").run();
  });
  const attempt = async (who: AuthUser, fields: Record<string, unknown>) => {
    try { await runImport(env.DB, who, { projects: [{ external_key: "K-GRP", ...fields }] }, { mode: who.role === "admin" ? "admin" : "member" }); return []; }
    catch (error) { if (error instanceof ImportValidationError) return error.issues; throw error; }
  };

  it("同組成員不能透過匯入改可見性、狀態、名稱", async () => {
    for (const fields of [{ visibility: "all" }, { status: "archived" }, { name: "被改名" }]) {
      expect((await attempt(actor("mem2", "member"), fields)).length).toBeGreaterThan(0);
    }
    expect(await one("SELECT name,visibility,status FROM projects WHERE id='p_grp'")).toEqual({ name: "同組公開案", visibility: "group", status: "active" });
  });

  it("專案成員（實習生）同樣被擋；值沒變或只改描述則放行", async () => {
    expect((await attempt(actor("kid", "intern"), { status: "done" })).join()).toContain("狀態");
    expect(await attempt(actor("kid", "intern"), { status: "active", visibility: "group", description: "更新" })).toEqual([]);
  });

  it("擁有者與管理員可以改", async () => {
    expect(await attempt(actor("mem", "member"), { visibility: "all", status: "paused" })).toEqual([]);
    expect(await attempt(actor("adm", "admin"), { status: "done" })).toEqual([]);
    expect(await one("SELECT status FROM projects WHERE id='p_grp'")).toEqual({ status: "done" });
  });
});
