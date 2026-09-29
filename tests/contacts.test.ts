import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 聯絡人資料庫：大家都能查看、新增、修改；刪除限建立的人與管理員；全部記稽核。 */

const BASE = "http://127.0.0.1:8787";
let env: Env;
const sessions: Record<string, string> = {};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const as = (userId: string, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}/api${path}`, { ...init, headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
const create = (userId: string, body: unknown) => as(userId, "/contacts", { method: "POST", body: JSON.stringify(body) });
const list = async (userId = "elvis") => (await (await as(userId, "/contacts")).json() as { contacts: Array<Record<string, string | null>> }).contacts;

const NTUH = { organization: "臺大醫院", department: "藥劑部", name: "王小明", title: "主任", phone: "02-2312-3456 #1234", mobile: "0912-345-678", email: "Ming.Wang@NTUH.gov.tw", address: "台北市中正區中山南路 7 號", notes: "負責新藥進用\n週三下午較好聯絡" };

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('elvis','elvis@example.com','Elvis','x','member','grp_general',0),('intern','intern@example.com','實習生','x','intern','grp_general',0),('boss','boss@example.com','管理者','x','admin','grp_general',0)").run();
  for (const id of ["elvis", "intern", "boss"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
});

describe("新增與查看", () => {
  it("所有欄位都存得進去，Email 轉小寫、多餘空白收掉；每個人都看得到，並顯示是誰建立的", async () => {
    const response = await create("elvis", { ...NTUH, name: "  王小明  ", organization: "臺大醫院 " });
    expect(response.status).toBe(201);
    const [contact] = await list("intern");
    expect(contact).toMatchObject({ ...NTUH, email: "ming.wang@ntuh.gov.tw", created_by: "elvis", created_by_name: "Elvis", updated_by_name: "Elvis" });
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_type='contact'").first()).toEqual({ summary: "新增聯絡人「臺大醫院／王小明」" });
  });

  it("醫院／公司與姓名必填，其他可以留空", async () => {
    expect((await create("elvis", { name: "王小明" })).status).toBe(422);
    expect((await create("elvis", { organization: "臺大醫院", name: "   " })).status).toBe(422);
    expect((await create("elvis", { organization: "臺大醫院", name: "王小明" })).status).toBe(201);
  });

  it("Email 格式不對、欄位太長、型別不對都不收", async () => {
    expect((await create("elvis", { ...NTUH, email: "not-an-email" })).status).toBe(422);
    expect((await create("elvis", { ...NTUH, name: "字".repeat(61) })).status).toBe(422);
    expect((await create("elvis", { ...NTUH, phone: 912345678 })).status).toBe(422);
    expect(await list()).toEqual([]);
  });

  it("同一個機構的同一個人不重複建立（不分大小寫）", async () => {
    await create("elvis", { organization: "Novartis", name: "Amy Chen" });
    const again = await create("intern", { organization: "novartis", name: "amy chen" });
    expect(again.status).toBe(409);
    expect((await again.json() as { error: string }).error).toContain("已經有");
    expect((await create("intern", { organization: "Novartis", name: "Bob Lin" })).status).toBe(201);
  });

  it("依機構、姓名排序", async () => {
    await create("elvis", { organization: "榮總", name: "乙" });
    await create("elvis", { organization: "Abbott", name: "B" });
    await create("elvis", { organization: "Abbott", name: "a" });
    expect((await list()).map((contact) => `${contact.organization}/${contact.name}`)).toEqual(["Abbott/a", "Abbott/B", "榮總/乙"]);
  });
});

describe("修改", () => {
  it("誰都能改，只改送來的欄位，記下是誰改的", async () => {
    await create("elvis", NTUH);
    const [contact] = await list();
    const response = await as("intern", `/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ title: "副主任", mobile: "" }) });
    expect(response.status).toBe(200);
    const [updated] = await list();
    expect(updated).toMatchObject({ title: "副主任", mobile: "", phone: NTUH.phone, updated_by_name: "實習生", created_by_name: "Elvis" });
    expect(await env.DB.prepare("SELECT user_id, summary FROM audit_log WHERE action='update'").first()).toEqual({ user_id: "intern", summary: "更新聯絡人「臺大醫院／王小明」：職稱、手機" });
  });

  it("改名撞到同機構的另一個人時擋下；必填欄位不能改成空白", async () => {
    await create("elvis", { organization: "臺大醫院", name: "王小明" });
    await create("elvis", { organization: "臺大醫院", name: "李大華" });
    const contacts = await list();
    const li = contacts.find((contact) => contact.name === "李大華")!;
    expect((await as("elvis", `/contacts/${li.id}`, { method: "PATCH", body: JSON.stringify({ name: "王小明" }) })).status).toBe(409);
    expect((await as("elvis", `/contacts/${li.id}`, { method: "PATCH", body: JSON.stringify({ organization: "" }) })).status).toBe(422);
    expect((await as("elvis", "/contacts/nope", { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status).toBe(404);
  });
});

describe("刪除", () => {
  it("建立的人可以刪，別人不行，管理員可以", async () => {
    await create("elvis", { organization: "A", name: "一" });
    await create("elvis", { organization: "B", name: "二" });
    const [first, second] = await list();
    const refused = await as("intern", `/contacts/${first.id}`, { method: "DELETE" });
    expect(refused.status).toBe(403);
    expect((await as("elvis", `/contacts/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as("boss", `/contacts/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await list()).toEqual([]);
    expect((await env.DB.prepare("SELECT user_id, summary FROM audit_log WHERE action='delete' ORDER BY summary").all()).results).toEqual([
      { user_id: "elvis", summary: "刪除聯絡人「A／一」" },
      { user_id: "boss", summary: "刪除聯絡人「B／二」" },
    ]);
  });
});

describe("沒登入", () => {
  it("看不到也改不了", async () => {
    expect((await worker.fetch(new Request(`${BASE}/api/contacts`), env, ctx)).status).toBe(401);
  });
});
