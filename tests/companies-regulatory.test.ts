import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { runDailyReminders } from "../worker/services/cron";
import { refreshStaleProjectRisks } from "../worker/services/project-risk";
import { canManageRegwatch } from "../worker/services/regwatch";
import { regenerateMonthlyReports, regenerateWeeklyReports } from "../worker/services/reports";
import { ISOLATION_STAGES } from "../worker/services/tenant";
import { fetchTfdaDrafts } from "../worker/services/tfda";
import { taipeiDate } from "../worker/services/time";
import { applyMigration, createTestD1 } from "./helpers/d1-sqlite";

/**
 * 多公司第 4 階段：法規動態、AI 報表、排程。
 * 兩家使用中的公司（UIC 與 B 公司）都有管理員與成員，雙向證明誰也看不到、改不到對方的資料，
 * 而且排程寄出的提醒與通知不會跨公司。
 */

const BASE = "https://brain.test";
let env: Env;
let raw: DatabaseSync;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

async function request(path: string, init: RequestInit & { session?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.session) headers.set("Cookie", init.session);
  if (init.body) { headers.set("Content-Type", "application/json"); headers.set("Origin", BASE); }
  const response = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, ctx);
  return { status: response.status, body: await response.json().catch(() => null) as any, response };
}
const post = (path: string, body: unknown, session?: string) => request(path, { method: "POST", body: JSON.stringify(body), session });
const patch = (path: string, body: unknown, session?: string) => request(path, { method: "PATCH", body: JSON.stringify(body), session });
const del = (path: string, session?: string) => request(path, { method: "DELETE", session, headers: { Origin: BASE } });

async function login(userId: string): Promise<string> {
  const token = `session-${userId}-${Math.random()}`;
  await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, new Date(Date.now() + 86_400_000).toISOString()).run();
  return `sid=${token}`;
}
const one = (sql: string, ...params: unknown[]) => env.DB.prepare(sql).bind(...params).first<Record<string, any>>();
const rows = async (sql: string, ...params: unknown[]) => (await env.DB.prepare(sql).bind(...params).all<Record<string, any>>()).results;

const shift = (days: number) => {
  const value = new Date(`${taipeiDate()}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const longAgo = `${shift(-30)} 04:30:22`;

const notice = { entry_date: "2026-10-29", entry_type: "announcement", product_line: "藥品", title: "共同的公告標題", key_points: "重點" };

let uicAdmin: string;
let uicRa: string;
let bAdmin: string;
let bRa: string;
let bBd: string;

beforeEach(async () => {
  const created = createTestD1();
  raw = created.raw;
  env = {
    DB: created.db, APP_BASE_URL: BASE,
    FILES: { get: async () => ({ body: new Blob(["pdf"]).stream(), size: 3, httpEtag: "\"e\"" }), put: async () => undefined, delete: async () => undefined },
  } as unknown as Env;
  const db = created.db;
  await db.prepare("UPDATE users SET must_change_password=0").run();
  // B 公司：使用中；一個 general 組（RA/PV）、一個 QA 組、一個 BD 組。
  await db.prepare("INSERT INTO companies (id,name,status) VALUES ('co_b','B 公司','active'),('co_c','C 公司','suspended')").run();
  await db.prepare(`INSERT INTO groups (id,name,type,company_id) VALUES
    ('gb_ra','RA組','general','co_b'),('gb_qa','QA組','qa','co_b'),('gb_bd','BD組','bd','co_b'),('gc_ra','RA組','general','co_c')`).run();
  const user = (id: string, role: string, group: string) => db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,'x',?,?,0)").bind(id, `${id}@test`, id, role, group).run();
  await user("uic_ra", "member", "grp_general");
  await user("uic_qa", "member", "grp_qa");
  await user("b_admin", "admin", "gb_ra");
  await user("b_ra", "member", "gb_ra");
  await user("b_qa", "member", "gb_qa");
  await user("b_bd", "member", "gb_bd");
  await user("c_user", "member", "gc_ra");
  uicAdmin = await login("usr_admin");
  uicRa = await login("uic_ra");
  bAdmin = await login("b_admin");
  bRa = await login("b_ra");
  bBd = await login("b_bd");
  // 種子裡的示範專案會干擾提醒與報表。
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("DELETE FROM todos").run();
});

afterEach(() => vi.unstubAllGlobals());

describe("隔離階段與審核權限", () => {
  it("第 4 階段完成", () => {
    expect(ISOLATION_STAGES.regulatory).toBe(true);
  });

  it("UIC 維持 RA/PV 組（grp_general）；其他公司是類型為 general 的組別成員與管理員", () => {
    expect(canManageRegwatch({ role: "member", group_id: "grp_general", group_type: "general", company_id: "co_uic" })).toBe(true);
    expect(canManageRegwatch({ role: "member", group_id: "grp_qa", group_type: "general", company_id: "co_uic" })).toBe(false);
    expect(canManageRegwatch({ role: "member", group_id: "gb_ra", group_type: "general", company_id: "co_b" })).toBe(true);
    expect(canManageRegwatch({ role: "member", group_id: "gb_bd", group_type: "bd", company_id: "co_b" })).toBe(false);
    expect(canManageRegwatch({ role: "intern", group_id: "gb_ra", group_type: "general", company_id: "co_b" })).toBe(false);
    expect(canManageRegwatch({ role: "admin", group_id: "gb_bd", group_type: "bd", company_id: "co_b" })).toBe(true);
  });
});

describe("法規動態：兩家公司互相看不到、改不到", () => {
  it("同日期同標題各公司各有一份；清單只看到自己公司的", async () => {
    const uic = await post("/api/regwatch", notice, uicAdmin);
    const b = await post("/api/regwatch", notice, bAdmin);
    expect(uic.status).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    // 同一家公司內重複仍然不行。
    expect((await post("/api/regwatch", notice, bAdmin)).status).toBe(422);
    expect((await one("SELECT company_id FROM reg_entries WHERE id=?", uic.body.id))!.company_id).toBe("co_uic");
    expect((await one("SELECT company_id FROM reg_entries WHERE id=?", b.body.id))!.company_id).toBe("co_b");
    const uicList = await request("/api/regwatch", { session: uicAdmin });
    const bList = await request("/api/regwatch", { session: bAdmin });
    expect(uicList.body.entries.map((entry: { id: string }) => entry.id)).toEqual([uic.body.id]);
    expect(bList.body.entries.map((entry: { id: string }) => entry.id)).toEqual([b.body.id]);
    expect((await request("/api/regwatch", { session: bBd })).body.entries.map((entry: { id: string }) => entry.id)).toEqual([b.body.id]);
  });

  it("不能修改、刪除、核准別家公司的條目（雙向）", async () => {
    const uic = (await post("/api/regwatch", { ...notice, title: "UIC 草稿", status: "draft" }, uicAdmin)).body.id as string;
    const b = (await post("/api/regwatch", { ...notice, title: "B 草稿", status: "draft" }, bAdmin)).body.id as string;
    for (const [session, other] of [[bAdmin, uic], [uicAdmin, b]] as const) {
      expect((await patch(`/api/regwatch/${other}`, { title: "被改掉" }, session)).status).toBe(404);
      expect((await post(`/api/regwatch/${other}/approve`, {}, session)).status).toBe(404);
      expect((await del(`/api/regwatch/${other}`, session)).status).toBe(404);
      const batch = await post("/api/regwatch/drafts/batch", { action: "approve", ids: [other] }, session);
      expect(batch.body).toEqual({ processed: 0, skipped: 1 });
      const batchDelete = await post("/api/regwatch/drafts/batch", { action: "delete", ids: [other] }, session);
      expect(batchDelete.body).toEqual({ processed: 0, skipped: 1 });
    }
    // 「全部核准」只動自己公司。
    expect((await post("/api/regwatch/approve-all", {}, bAdmin)).body).toEqual({ approved: 1 });
    expect(await one("SELECT status FROM reg_entries WHERE id=?", uic)).toEqual({ status: "draft" });
    expect(await one("SELECT status FROM reg_entries WHERE id=?", b)).toEqual({ status: "published" });
    expect((await one("SELECT title FROM reg_entries WHERE id=?", uic))!.title).toBe("UIC 草稿");
    // 草稿檢視與待審數也只算自己的。
    const drafts = await request("/api/regwatch?view=drafts", { session: uicAdmin });
    expect(drafts.body.entries.map((entry: { id: string }) => entry.id)).toEqual([uic]);
    expect(drafts.body.pending_count).toBe(1);
  });

  it("審核權限：B 公司 general 組成員可以，BD 組不行；UIC 照舊 RA/PV 組", async () => {
    expect((await post("/api/regwatch", { ...notice, title: "B RA" }, bRa)).status).toBe(201);
    expect((await post("/api/regwatch", { ...notice, title: "B BD" }, bBd)).status).toBe(403);
    expect((await post("/api/regwatch", { ...notice, title: "UIC RA" }, uicRa)).status).toBe(201);
    expect((await post("/api/regwatch", { ...notice, title: "UIC BD" }, await login("usr_bd1"))).status).toBe(403);
  });

  it("AI 匯入的重複判斷與批次寫入都只看自己公司", async () => {
    await post("/api/regwatch", notice, uicAdmin);
    const batch = await post("/api/regwatch/batch", { entries: [{ ...notice, category: "" }] }, bAdmin);
    expect(batch.status, JSON.stringify(batch.body)).toBe(200);
    expect(batch.body).toMatchObject({ created: 1, skipped: 0 });
    expect((await one("SELECT company_id FROM reg_entries WHERE id=?", batch.body.entry_ids[0]))!.company_id).toBe("co_b");
    expect((await post("/api/regwatch/batch", { entries: [{ ...notice, category: "" }] }, bAdmin)).body).toMatchObject({ created: 0, skipped: 1 });
  });

  it("附件：只有掛在自己公司條目底下的檔案能下載；刪除條目只清自己的附件", async () => {
    await env.DB.prepare("INSERT INTO files (id,project_id,filename,size,content_type,storage_key,uploaded_by) VALUES ('f_uic',NULL,'uic.pdf',3,'application/pdf','regwatch/f_uic/uic.pdf','usr_admin'),('f_b',NULL,'b.pdf',3,'application/pdf','regwatch/f_b/b.pdf','b_admin')").run();
    const uic = (await post("/api/regwatch", { ...notice, title: "UIC 附件" }, uicAdmin)).body.id as string;
    const b = (await post("/api/regwatch", { ...notice, title: "B 附件" }, bAdmin)).body.id as string;
    await env.DB.prepare("INSERT INTO reg_entry_files (entry_id,file_id,position) VALUES (?,?,0),(?,?,0)").bind(uic, "f_uic", b, "f_b").run();
    expect((await request("/api/files/f_uic/download", { session: uicAdmin })).status).toBe(200);
    expect((await request("/api/files/f_uic/download", { session: bAdmin })).status).toBe(404);
    expect((await request("/api/files/f_b/download", { session: bBd })).status).toBe(200);
    expect((await request("/api/files/f_b/download", { session: uicRa })).status).toBe(404);
    // 清單上也只看到自己的附件。
    expect((await request("/api/regwatch", { session: bAdmin })).body.entries[0].files.map((file: { id: string }) => file.id)).toEqual(["f_b"]);
    expect((await del(`/api/regwatch/${uic}`, bAdmin)).status).toBe(404);
    expect(await one("SELECT id FROM files WHERE id='f_uic'")).not.toBeNull();
    expect((await del(`/api/regwatch/${b}`, bAdmin)).body).toMatchObject({ ok: true, deleted_files: 1 });
    expect(await one("SELECT id FROM files WHERE id='f_b'")).toBeNull();
    expect(await one("SELECT id FROM files WHERE id='f_uic'")).not.toBeNull();
  });
});

const feed = (...ids: Array<[string, string]>) => `<rss><channel>${ids.map(([id, title]) => `<item>
  <title>${title}</title><link>https://www.fda.gov.tw/TC/newsContent.aspx?id=${id}</link>
  <pubDate>Sat, 25 Jul 2026 16:00:00 GMT</pubDate><description><![CDATA[<p>內容 ${id}</p>]]></description></item>`).join("")}</channel></rss>`;
const fetcher = (xml: string) => async () => new Response(xml);
const extract = async () => [];

describe("TFDA 抓取：每家使用中的公司各建一份草稿", () => {
  it("每家使用中的公司各有自己的草稿、去重與墓碑；停用的公司不建", async () => {
    const xml = feed(["1001", "公告甲"], ["1002", "公告乙"]);
    const first = await fetchTfdaDrafts(env, { fetcher: fetcher(xml), extract });
    expect(first).toMatchObject({ fetched: 2, new_drafts: 4 });
    expect(await rows("SELECT company_id,COUNT(*) AS n FROM reg_entries GROUP BY company_id ORDER BY company_id")).toEqual([{ company_id: "co_b", n: 2 }, { company_id: "co_uic", n: 2 }]);
    // B 公司駁回公告甲；UIC 不受影響。
    const bDraft = (await one("SELECT id FROM reg_entries WHERE company_id='co_b' AND source_ref='1001'"))!.id as string;
    expect((await del(`/api/regwatch/${bDraft}`, bAdmin)).status).toBe(200);
    expect(await rows("SELECT company_id,source_ref FROM tfda_rejected")).toEqual([{ company_id: "co_b", source_ref: "1001" }]);
    const second = await fetchTfdaDrafts(env, { fetcher: fetcher(xml), extract });
    expect(second).toMatchObject({ new_drafts: 0, skipped_rejected: 1, skipped_ref: 3 });
    expect(await one("SELECT COUNT(*) AS n FROM reg_entries WHERE company_id='co_uic' AND source_ref='1001'")).toEqual({ n: 1 });
    expect(await one("SELECT COUNT(*) AS n FROM reg_entries WHERE company_id='co_b' AND source_ref='1001'")).toEqual({ n: 0 });
    expect(await one("SELECT COUNT(*) AS n FROM reg_entries WHERE company_id='co_c'")).toEqual({ n: 0 });
  });

  it("待審通知只發給各公司自己的審核者", async () => {
    await fetchTfdaDrafts(env, { fetcher: fetcher(feed(["2001", "公告丙"])), extract });
    const receivers = (await rows("SELECT user_id FROM notifications WHERE type='tfda_draft' ORDER BY user_id")).map((row) => row.user_id);
    expect(receivers).toContain("usr_admin");
    expect(receivers).toContain("uic_ra");
    expect(receivers).toContain("b_admin");
    expect(receivers).toContain("b_ra");
    expect(receivers).not.toContain("b_bd");
    expect(receivers).not.toContain("b_qa");
    expect(receivers).not.toContain("uic_qa");
    expect(receivers).not.toContain("c_user");
    // B 公司的審核者只收到一則（自己公司的）。
    expect(receivers.filter((id) => id === "b_admin")).toHaveLength(1);
  });

  it("立即抓取只替自己的公司建草稿", async () => {
    vi.stubGlobal("fetch", async () => new Response(feed(["3001", "公告丁"])));
    const result = await post("/api/regwatch/tfda-fetch", {}, bAdmin);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.new_drafts).toBe(1);
    expect(await rows("SELECT company_id FROM reg_entries")).toEqual([{ company_id: "co_b" }]);
    expect((await post("/api/regwatch/tfda-fetch", {}, await login("usr_bd1"))).status).toBe(403);
  });
});

async function seedProjects() {
  await env.DB.prepare(`INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress,last_activity_at) VALUES
    ('p_uic','UIC專案','grp_bd','usr_bd1','all','active',40,datetime('now')),
    ('p_b','B專案','gb_bd','b_bd','all','active',40,datetime('now'))`).run();
}

describe("AI 報表", () => {
  it("清單與讀取只限自己公司；內容只含自己公司的專案", async () => {
    await seedProjects();
    const generatedB = await post("/api/reports/ai/generate", { scope: "all", period: "last-week" }, bAdmin);
    expect(generatedB.status, JSON.stringify(generatedB.body)).toBe(201);
    expect(generatedB.body.report.content_md).toContain("B專案");
    expect(generatedB.body.report.content_md).not.toContain("UIC專案");
    expect(generatedB.body.report.company_id).toBe("co_b");
    const generatedUic = await post("/api/reports/ai/generate", { scope: "all", period: "last-week" }, uicAdmin);
    expect(generatedUic.body.report.content_md).toContain("UIC專案");
    expect(generatedUic.body.report.content_md).not.toContain("B專案");
    const bId = generatedB.body.report.id as string;
    const uicId = generatedUic.body.report.id as string;
    expect((await request("/api/reports/ai", { session: bAdmin })).body.reports.map((report: { id: string }) => report.id)).toEqual([bId]);
    expect((await request("/api/reports/ai", { session: uicAdmin })).body.reports.map((report: { id: string }) => report.id)).toEqual([uicId]);
    expect((await request(`/api/reports/ai/${uicId}`, { session: bAdmin })).status).toBe(404);
    expect((await request(`/api/reports/ai/${bId}`, { session: uicAdmin })).status).toBe(404);
    expect((await request(`/api/reports/ai/${bId}`, { session: bAdmin })).status).toBe(200);
  });

  it("不能對別家公司的組別產生報告；成員只能產自己組別", async () => {
    await seedProjects();
    expect((await post("/api/reports/ai/generate", { scope: "grp_bd", period: "last-week" }, bAdmin)).status).toBe(404);
    expect((await post("/api/reports/ai/generate", { scope: "gb_bd", period: "last-week" }, uicAdmin)).status).toBe(404);
    expect((await post("/api/reports/ai/generate", { scope: "grp_bd", period: "last-week" }, bBd)).status).toBe(403);
    expect((await post("/api/reports/ai/generate", { scope: "gb_bd", period: "last-week" }, bBd)).status).toBe(201);
    // 成員的清單只有自己組別、自己公司的報告。
    expect((await request("/api/reports/ai", { session: bBd })).body.reports).toHaveLength(1);
  });

  it("報表統計只算自己公司的專案", async () => {
    await seedProjects();
    const summary = await request(`/api/reports/summary?from=${shift(-7)}&to=${shift(1)}`, { session: bAdmin });
    expect(summary.body.projects.map((project: { id: string }) => project.id)).toEqual(["p_b"]);
  });

  it("排程為每家使用中的公司各產一組報告，內容與通知不跨公司；停用的公司不產", async () => {
    await seedProjects();
    const period = { start: "2026-11-09", end: "2026-11-15" };
    const result = await regenerateWeeklyReports(env, period);
    // 每家公司：「全公司」加上自己的組別。UIC 3 個組別（+ grp_qa = 4），B 3 個。
    const uicGroups = (await one("SELECT COUNT(*) AS n FROM groups WHERE company_id='co_uic'"))!.n as number;
    expect(result.reports).toBe(uicGroups + 1 + 3 + 1);
    expect(await rows("SELECT DISTINCT company_id FROM ai_reports ORDER BY company_id")).toEqual([{ company_id: "co_b" }, { company_id: "co_uic" }]);
    const bAll = (await one("SELECT content_md FROM ai_reports WHERE company_id='co_b' AND scope='all'"))!.content_md as string;
    const uicAll = (await one("SELECT content_md FROM ai_reports WHERE company_id='co_uic' AND scope='all'"))!.content_md as string;
    expect(bAll).toContain("B專案");
    expect(bAll).not.toContain("UIC專案");
    expect(uicAll).toContain("UIC專案");
    expect(uicAll).not.toContain("B專案");
    // B 的組別報告只列 B 的組別；UIC 的組別報告不會出現 B 的組別 id。
    expect(await rows("SELECT scope FROM ai_reports WHERE company_id='co_b' ORDER BY scope")).toEqual([{ scope: "all" }, { scope: "gb_bd" }, { scope: "gb_qa" }, { scope: "gb_ra" }]);
    const notified = await rows("SELECT DISTINCT user_id FROM notifications WHERE type='weekly_report'");
    expect(notified.map((row) => row.user_id)).toContain("b_admin");
    expect(notified.map((row) => row.user_id)).toContain("usr_admin");
    expect(notified.map((row) => row.user_id)).not.toContain("c_user");
    await env.DB.prepare("DELETE FROM ai_reports").run();
    await regenerateMonthlyReports(env, period, ["co_b"]);
    expect(await rows("SELECT DISTINCT company_id FROM ai_reports")).toEqual([{ company_id: "co_b" }]);
  });

  it("管理員重新產生週報只動自己公司", async () => {
    await seedProjects();
    const result = await post("/api/reports/ai/regenerate", { period_start: "2026-11-09", period_end: "2026-11-15" }, bAdmin);
    expect(result.status).toBe(200);
    expect(await rows("SELECT DISTINCT company_id FROM ai_reports")).toEqual([{ company_id: "co_b" }]);
    expect((await post("/api/reports/ai/regenerate", {}, bBd)).status).toBe(403);
  });
});

const received = () => rows("SELECT user_id,title,body FROM notifications WHERE type='daily_reminder'");
const usersFor = (list: Array<Record<string, any>>, text: string) => list.filter((row) => row.body.includes(text)).map((row) => row.user_id).sort();

describe("每日提醒：收件人和專案同一家公司", () => {
  it("里程碑、停滯、證照提醒不跨公司，QA 通知用各自公司的 QA 組", async () => {
    await env.DB.prepare(`INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress,last_activity_at) VALUES
      ('p_uic','UIC專案','grp_bd','usr_bd1','all','active',40,?),
      ('p_b','B專案','gb_bd','b_bd','all','active',40,?)`).bind(longAgo, longAgo).run();
    // UIC 的人被（錯誤地）加進 B 的專案：不該收到 B 專案的任何提醒。
    await env.DB.prepare("INSERT INTO project_members (project_id,user_id,added_by) VALUES ('p_b','uic_qa','b_admin')").run();
    await env.DB.prepare("INSERT INTO milestones (id,project_id,title,due_date,done,kind) VALUES ('m1','p_uic','UIC里程碑',?,0,'milestone'),('m2','p_b','B里程碑',?,0,'milestone')").bind(shift(1), shift(1)).run();
    await env.DB.prepare(`INSERT INTO licenses (id,project_id,name,subject,expires_at,created_by) VALUES
      ('l_uic','p_uic','UIC證照','x',?,'usr_admin'),('l_b','p_b','B證照','x',?,'b_admin')`).bind(shift(-1), shift(-1)).run();
    const result = await runDailyReminders(env);
    expect(result.notifications).toBeGreaterThan(0);
    const list = await received();
    expect(usersFor(list, "B里程碑")).toEqual(["b_bd"]);
    expect(usersFor(list, "UIC里程碑")).toEqual(["usr_bd1"]);
    // 停滯：同組成員（B 公司只有 b_bd；UIC 是 BD 組成員）。
    expect(usersFor(list, "B專案 已超過")).toEqual(["b_bd"]);
    expect(usersFor(list, "UIC專案 已超過").every((id) => !id.startsWith("b_"))).toBe(true);
    // 證照：負責人加 QA。B 的證照給 b_bd 與 b_qa；UIC 的給 usr_bd1 與 uic_qa（grp_qa）。
    expect(usersFor(list, "B證照")).toEqual(["b_bd", "b_qa"]);
    expect(usersFor(list, "UIC證照")).toEqual(["uic_qa", "usr_bd1"]);
    expect(await one("SELECT last_notified_stage FROM licenses WHERE id='l_b'")).toEqual({ last_notified_stage: "expired" });
    // 沒有任何 UIC 帳號收到 B 的提醒，反之亦然。
    const bUsers = new Set(["b_admin", "b_ra", "b_qa", "b_bd"]);
    for (const row of list) {
      if (row.body.includes("B專案") || row.body.includes("B里程碑") || row.body.includes("B證照")) expect(bUsers.has(row.user_id), `${row.user_id}:${row.body}`).toBe(true);
      else expect(bUsers.has(row.user_id), `${row.user_id}:${row.body}`).toBe(false);
    }
  });

  it("自動歸檔與待辦也各算各的；停用公司的專案不處理", async () => {
    await env.DB.prepare(`INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress,last_activity_at,auto_archive) VALUES
      ('a_uic','UIC完成','grp_bd','usr_bd1','all','done',100,?,1),
      ('a_b','B完成','gb_bd','b_bd','all','done',100,?,1),
      ('a_c','Z完成','gc_ra','c_user','all','done',100,?,1)`).bind(longAgo, longAgo, longAgo).run();
    const result = await runDailyReminders(env);
    expect(result.archived).toBe(2);
    expect(await rows("SELECT id,status FROM projects ORDER BY id")).toEqual([{ id: "a_b", status: "archived" }, { id: "a_c", status: "done" }, { id: "a_uic", status: "archived" }]);
    const list = await received();
    expect(usersFor(list, "B完成")).toEqual(["b_bd"]);
    expect(usersFor(list, "Z完成")).toEqual([]);
  });

  it("一家公司出錯不影響其他公司", async () => {
    await env.DB.prepare(`INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress,last_activity_at) VALUES
      ('p_uic','UIC專案','grp_bd','usr_bd1','all','active',40,?),
      ('p_b','B專案','gb_bd','b_bd','all','active',40,?)`).bind(longAgo, longAgo).run();
    // 寫入 UIC 同仁的通知時出錯（UIC 排在 B 之前處理）。
    raw.exec("CREATE TRIGGER boom BEFORE INSERT ON notifications WHEN NEW.user_id='usr_bd1' BEGIN SELECT RAISE(ABORT,'boom'); END");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runDailyReminders(env);
    const list = await received();
    expect(usersFor(list, "UIC專案")).toEqual([]);
    expect(usersFor(list, "B專案")).toEqual(["b_bd"]);
  });
});

describe("AI 風險分析排程", () => {
  it("每家公司各取各的專案；一家的 AI 失敗不擋其他公司", async () => {
    await env.DB.prepare(`INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at,risk_updated_at) VALUES
      ('p_uic','UIC專案','','grp_bd','usr_bd1','all','active',10,datetime('now'),NULL),
      ('p_b','B專案','','gb_bd','b_bd','all','active',10,datetime('now'),NULL),
      ('p_c','C專案','','gc_ra','c_user','all','active',10,datetime('now'),NULL)`).run();
    (env as unknown as Record<string, string>).LLM_API_KEY = "test";
    (env as unknown as Record<string, string>).LLM_BASE_URL = "https://llm.test";
    (env as unknown as Record<string, string>).LLM_MODEL = "m";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const name = JSON.parse(JSON.parse(String(init?.body)).messages[1].content).project.name as string;
      seen.push(name);
      if (name === "UIC專案") return new Response("overloaded", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ level: "low", summary: `${name}摘要`, suggestions: ["x"] }) } }] }), { status: 200 });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await refreshStaleProjectRisks(env);
    expect(result).toMatchObject({ analyzed: 1, failed: true });
    expect(seen).toContain("B專案");
    expect(seen).not.toContain("C專案");
    expect(await one("SELECT risk_level FROM projects WHERE id='p_b'")).toEqual({ risk_level: "low" });
    expect(await one("SELECT risk_level FROM projects WHERE id='p_uic'")).toEqual({ risk_level: null });
  });
});

describe("migration 0032", () => {
  it("既有的法規動態、墓碑與報表都歸給 UIC，唯一索引改成每家公司各自一份", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const dir = new URL("../migrations/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files.filter((name) => name < "0032")) applyMigration(db, file, readFileSync(new URL(file, dir), "utf8"));
    db.exec(`INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref) VALUES ('r1','2026-10-30','藥品','舊公告','draft','tfda_rss','555');
      INSERT INTO tfda_rejected (source_ref,title,rejected_by) VALUES ('777','駁回過','usr_admin');
      INSERT INTO ai_reports (id,period_start,period_end,scope,content_md) VALUES ('ar1','2026-10-01','2026-10-07','all','x'),('ar2','2026-10-01','2026-10-07','grp_bd','y');`);
    for (const file of files.filter((name) => name >= "0032")) applyMigration(db, file, readFileSync(new URL(file, dir), "utf8"));
    expect(db.prepare("SELECT company_id FROM reg_entries").all()).toEqual([{ company_id: "co_uic" }]);
    expect(db.prepare("SELECT company_id,source_ref,title,rejected_by FROM tfda_rejected").all()).toEqual([{ company_id: "co_uic", source_ref: "777", title: "駁回過", rejected_by: "usr_admin" }]);
    expect(db.prepare("SELECT id,company_id FROM ai_reports ORDER BY id").all()).toEqual([{ id: "ar1", company_id: "co_uic" }, { id: "ar2", company_id: "co_uic" }]);
    db.exec("INSERT INTO companies (id,name,status) VALUES ('co_z','Z','active')");
    // 另一家公司可以有同日期同標題、同來源編號；同公司內仍不行。
    db.exec("INSERT INTO reg_entries (id,company_id,entry_date,product_line,title,status,source,source_ref) VALUES ('r2','co_z','2026-10-30','藥品','舊公告','draft','tfda_rss','555')");
    expect(() => db.exec("INSERT INTO reg_entries (id,company_id,entry_date,product_line,title,status,source,source_ref) VALUES ('r3','co_z','2026-10-30','藥品','舊公告','draft','manual',NULL)")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO reg_entries (id,company_id,entry_date,product_line,title,status,source,source_ref) VALUES ('r4','co_uic','2026-10-31','藥品','別的','draft','tfda_rss','555')")).toThrow(/UNIQUE/);
    // 沒帶 company_id 的新增，依建立者補上公司。
    db.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,created_by) VALUES ('r5','2026-11-01','藥品','沒帶公司','usr_admin')");
    expect(db.prepare("SELECT company_id FROM reg_entries WHERE id='r5'").get()).toEqual({ company_id: "co_uic" });
  });
});
