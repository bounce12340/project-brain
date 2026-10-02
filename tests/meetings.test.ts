import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { isMeetingDateTime } from "../worker/routes/meetings";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 會議記錄與公司外訓：大家都看得到；掛在專案底下的跟著專案的權限；改與刪限建立的人與管理員。 */

const BASE = "http://127.0.0.1:8787";
let env: Env;
const sessions: Record<string, string> = {};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const as = (userId: string, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}/api${path}`, { ...init, headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
const create = (userId: string, body: unknown) => as(userId, "/meetings", { method: "POST", body: JSON.stringify(body) });
type Listed = Record<string, unknown> & { id: string; title: string };
const list = async (userId: string, query = "") => (await (await as(userId, `/meetings${query}`)).json() as { meetings: Listed[] }).meetings;

const KICKOFF = { kind: "meeting", title: "  Q4 啟動會議 ", starts_at: "2026-10-01T14:00", ends_at: "2026-10-01T15:30", location: "3F   會議室", attendees: "Elvis、王小明（臺大）", summary: "決議：\n1. 月底送件\n2. 下週再開", project_id: "prj_general" };

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('elvis','elvis@example.com','Elvis','x','member','grp_general',0),('intern','intern@example.com','實習生','x','intern','grp_general',0),('boss','boss@example.com','管理者','x','admin','grp_general',0)").run();
  await db.prepare("INSERT INTO projects (id,name,description,group_id,owner_id,visibility,status,progress,last_activity_at) VALUES ('secret','保密案','','grp_general','boss','private','active',0,datetime('now'))").run();
  for (const id of ["elvis", "intern", "boss"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
});

describe("新增與查看", () => {
  it("欄位都存得進去，單行欄位的空白收掉、摘要保留換行；列出專案名稱與建立者，只有建立者能改", async () => {
    const response = await create("elvis", KICKOFF);
    expect(response.status).toBe(201);
    const [meeting] = await list("boss");
    expect(meeting).toMatchObject({
      kind: "meeting", title: "Q4 啟動會議", starts_at: "2026-10-01T14:00", ends_at: "2026-10-01T15:30", location: "3F 會議室",
      attendees: "Elvis、王小明（臺大）", summary: "決議：\n1. 月底送件\n2. 下週再開", project_id: "prj_general", project_name: "RA/PV 月度例行作業",
      created_by: "elvis", created_by_name: "Elvis", can_edit: true,
    });
    expect(Object.keys(meeting).some((key) => key.startsWith("p_"))).toBe(false);
    const [seenByElvis] = await list("elvis");
    expect(seenByElvis.can_edit).toBe(true);
    expect(await env.DB.prepare("SELECT action, entity_type, summary FROM audit_log WHERE entity_type='meeting'").first()).toEqual({ action: "create", entity_type: "meeting", summary: "新增會議記錄「Q4 啟動會議」（2026-10-01 14:00）" });
  });

  it("外訓紀錄與會議分開列；主辦單位存得進去", async () => {
    await create("elvis", { ...KICKOFF, project_id: null });
    await create("elvis", { kind: "course", title: "GDP 實務課程", starts_at: "2026-09-20T09:00", location: "臺大醫院國際會議中心", organizer: "TFDA", summary: "溫控運輸的稽核重點" });
    const courses = await list("intern", "?kind=course");
    expect(courses.map((item) => item.title)).toEqual(["GDP 實務課程"]);
    expect(courses[0]).toMatchObject({ organizer: "TFDA", project_id: null, can_edit: false });
    expect((await list("intern", "?kind=meeting")).map((item) => item.title)).toEqual(["Q4 啟動會議"]);
    expect((await list("intern")).map((item) => item.title)).toEqual(["Q4 啟動會議", "GDP 實務課程"]);
    expect((await as("intern", "/meetings?kind=party")).status).toBe(422);
  });
});

describe("外訓分類", () => {
  const GDP = { kind: "course", title: "GDP 實務研習", starts_at: "2026-09-20T09:00", organizer: "TFDA", category: "drug" };
  it("分類存得進去；沒選就是空字串；可以改，也記在稽核紀錄", async () => {
    expect((await create("elvis", GDP)).status).toBe(201);
    expect((await create("elvis", { ...GDP, title: "還沒分類的課", category: undefined })).status).toBe(201);
    const byTitle = Object.fromEntries((await list("elvis", "?kind=course")).map((item) => [item.title, item.category]));
    expect(byTitle).toEqual({ "GDP 實務研習": "drug", "還沒分類的課": "" });
    const course = (await list("elvis", "?kind=course")).find((item) => item.title === "GDP 實務研習")!;
    expect((await as("elvis", `/meetings/${course.id}`, { method: "PATCH", body: JSON.stringify({ category: "regenerative" }) })).status).toBe(200);
    expect((await as("elvis", `/meetings/${course.id}`, { method: "PATCH", body: JSON.stringify({ category: "" }) })).status).toBe(200);
    expect((await env.DB.prepare("SELECT summary FROM audit_log WHERE action='update' ORDER BY created_at, rowid").all()).results).toEqual([
      { summary: "更新外訓紀錄「GDP 實務研習」（2026-09-20 09:00）：分類" },
      { summary: "更新外訓紀錄「GDP 實務研習」（2026-09-20 09:00）：分類" },
    ]);
    expect((await list("elvis", "?kind=course")).find((item) => item.id === course.id)?.category).toBe("");
  });

  it("只收認得的分類；會議沒有分類", async () => {
    for (const category of ["藥品", "DRUG", 3]) {
      const refused = await create("elvis", { ...GDP, category });
      expect(refused.status, String(category)).toBe(422);
      expect(await refused.json()).toEqual({ error: "分類不正確" });
    }
    const meeting = await create("elvis", { ...KICKOFF, category: "food" });
    expect(meeting.status).toBe(422);
    expect(await meeting.json()).toEqual({ error: "只有外訓紀錄有分類" });
    await create("elvis", KICKOFF);
    const [saved] = await list("elvis", "?kind=meeting");
    expect(saved.category).toBe("");
    expect((await as("elvis", `/meetings/${saved.id}`, { method: "PATCH", body: JSON.stringify({ category: "food" }) })).status).toBe(422);
    expect(await list("elvis", "?kind=course")).toEqual([]);
  });
});

describe("欄位檢查", () => {
  it("名稱與開始時間必填；時間要是真的時間；結束不能早於開始", async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...KICKOFF, title: "   " }, "請填寫名稱"],
      [{ ...KICKOFF, starts_at: undefined }, "請填寫開始時間"],
      [{ ...KICKOFF, starts_at: "2026-02-30T10:00", ends_at: null }, "請填寫開始時間"],
      [{ ...KICKOFF, ends_at: "2026-10-01T13:00" }, "結束時間不能早於開始時間"],
      [{ ...KICKOFF, ends_at: "明天" }, "結束時間格式不正確"],
      [{ ...KICKOFF, title: "會".repeat(121) }, "名稱不能超過 120 字"],
      [{ ...KICKOFF, kind: "party" }, "種類不正確"],
      [{ ...KICKOFF, location: 3 }, "地點格式不正確"],
    ];
    for (const [body, error] of cases) {
      const response = await create("elvis", body);
      expect(response.status, error).toBe(422);
      expect(await response.json(), error).toEqual({ error });
    }
    expect(await list("boss")).toEqual([]);
  });

  it("isMeetingDateTime 只認 YYYY-MM-DDTHH:MM 的真實時間", () => {
    expect(isMeetingDateTime("2026-10-01T14:00")).toBe(true);
    expect(isMeetingDateTime("2026-10-01 14:00")).toBe(false);
    expect(isMeetingDateTime("2026-10-01T24:00")).toBe(false);
    expect(isMeetingDateTime("2026-02-29T10:00")).toBe(false);
    expect(isMeetingDateTime("2028-02-29T10:00")).toBe(true);
  });
});

describe("專案權限", () => {
  it("掛在看不到的專案底下的會議，其他人看不到；也不能把會議掛到自己看不到的專案", async () => {
    expect((await create("boss", { ...KICKOFF, title: "保密會議", project_id: "secret" })).status).toBe(201);
    await create("boss", { ...KICKOFF, title: "公開會議", project_id: null });
    expect((await list("elvis")).map((item) => item.title)).toEqual(["公開會議"]);
    expect((await list("boss")).map((item) => item.title).sort()).toEqual(["保密會議", "公開會議"]);
    const refused = await create("elvis", { ...KICKOFF, project_id: "secret" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "找不到這個專案，或你沒有檢視權限" });
  });

  it("實習生看不到沒被指派的專案底下的會議，一般會議照樣看得到", async () => {
    await create("elvis", KICKOFF);
    await create("elvis", { ...KICKOFF, title: "全公司會議", project_id: null });
    expect((await list("intern")).map((item) => item.title)).toEqual(["全公司會議"]);
  });
});

describe("修改與刪除", () => {
  it("只有建立的人與管理員能改；只更新送來的欄位，並記稽核", async () => {
    await create("elvis", KICKOFF);
    const [meeting] = await list("elvis");
    expect((await as("intern", `/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify({ title: "改掉" }) })).status).toBe(403);
    expect((await as("elvis", `/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify({ location: "線上", ends_at: "" }) })).status).toBe(200);
    expect((await as("boss", `/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify({ summary: "管理者補充" }) })).status).toBe(200);
    const [after] = await list("elvis");
    expect(after).toMatchObject({ title: "Q4 啟動會議", location: "線上", ends_at: null, summary: "管理者補充", updated_by_name: "管理者" });
    const badEnd = await as("elvis", `/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify({ ends_at: "2026-09-30T10:00" }) });
    expect(badEnd.status).toBe(422);
    expect((await env.DB.prepare("SELECT summary FROM audit_log WHERE action='update' AND entity_type='meeting' ORDER BY created_at, rowid").all()).results).toEqual([
      { summary: "更新會議記錄「Q4 啟動會議」（2026-10-01 14:00）：地點、結束時間" },
      { summary: "更新會議記錄「Q4 啟動會議」（2026-10-01 14:00）：摘要" },
    ]);
  });

  it("刪除限建立的人與管理員", async () => {
    await create("elvis", KICKOFF);
    await create("elvis", { ...KICKOFF, title: "第二場" });
    const [first, second] = await list("elvis");
    expect((await as("intern", `/meetings/${first.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as("elvis", `/meetings/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as("boss", `/meetings/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await list("elvis")).toEqual([]);
    expect((await as("elvis", `/meetings/${first.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("首頁的近期會議與外訓", () => {
  it("接下來的由近到遠、剛結束的由新到舊，各最多 5 筆，並依專案權限篩", async () => {
    for (let day = 1; day <= 6; day += 1) await create("elvis", { ...KICKOFF, project_id: null, title: `未來${day}`, starts_at: `2099-01-0${day}T09:00`, ends_at: null });
    await create("elvis", { kind: "course", title: "過去的課", starts_at: "2020-01-01T09:00" });
    await create("boss", { ...KICKOFF, title: "保密的過去會議", project_id: "secret", starts_at: "2020-06-01T09:00", ends_at: null });
    const overview = await (await as("elvis", "/meetings/overview")).json() as { upcoming: Listed[]; recent: Listed[] };
    expect(overview.upcoming.map((item) => item.title)).toEqual(["未來1", "未來2", "未來3", "未來4", "未來5"]);
    expect(overview.recent.map((item) => item.title)).toEqual(["過去的課"]);
    const forBoss = await (await as("boss", "/meetings/overview")).json() as { recent: Listed[] };
    expect(forBoss.recent.map((item) => item.title)).toEqual(["保密的過去會議", "過去的課"]);
  });
});

describe("沒登入", () => {
  it("看不到也改不了", async () => {
    expect((await worker.fetch(new Request(`${BASE}/api/meetings`), env, ctx)).status).toBe(401);
  });
});
