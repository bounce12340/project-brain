import { readFileSync } from "node:fs";
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

const NTUH = { organization: "臺大醫院", department: "藥劑部", name: "王小明", title: "主任", phone_area: "02", phone: "2312-3456", phone_ext: "1234", mobile: "0912-345-678", email: "Ming.Wang@NTUH.gov.tw", address: "台北市中正區中山南路 7 號", notes: "負責新藥進用\n週三下午較好聯絡" };

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

describe("電話區碼獨立一格", () => {
  it("區碼的括號與空白拿掉，只收數字（國際碼可帶 +）", async () => {
    expect((await create("elvis", { organization: "A", name: "一", phone_area: " (04) ", phone: "3702-2680" })).status).toBe(201);
    expect((await create("elvis", { organization: "B", name: "二", phone_area: "+886", phone: "2-2312-3456" })).status).toBe(201);
    const [first, second] = await list();
    expect([first.phone_area, first.phone]).toEqual(["04", "3702-2680"]);
    expect(second.phone_area).toBe("+886");
    const refused = await create("elvis", { organization: "C", name: "三", phone_area: "台北" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "區碼只能填數字，例如 02" });
  });

  it("既有資料：看得出區碼的才拆開，手機門號與分機不受影響", async () => {
    const rows = [
      ["a", "04-3702-2680", "04", "3702-2680"],
      ["b", "(02)2312-3456 #12", "02", "2312-3456 #12"],
      ["c", "049-222-3333", "049", "222-3333"],
      ["d", "0912-345-678", "", "0912-345-678"],
      ["e", "23123456", "", "23123456"],
      ["f", "", "", ""],
    ];
    for (const [id, phone] of rows) await env.DB.prepare("INSERT INTO contacts (id,organization,name,phone) VALUES (?,?,?,?)").bind(id, `機構${id}`, `人${id}`, phone).run();
    // 套用 migration 裡拆區碼的那兩段（欄位已經在測試資料庫裡了）
    const migration = readFileSync(new URL("../migrations/0020_contact_phone_area.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter((part) => part.startsWith("UPDATE"))) await env.DB.prepare(statement).run();
    for (const [id, , area, phone] of rows) expect(await env.DB.prepare("SELECT phone_area, phone FROM contacts WHERE id=?").bind(id).first(), id).toEqual({ phone_area: area, phone });
  });
});

describe("電話分機（選填）", () => {
  it("分機的記號與空白拿掉，只收數字；不填也可以", async () => {
    const cases: Array<[string, string]> = [["一", " #35 "], ["二", "分機 1234"], ["三", "ext. 12"], ["四", "EXT:7"], ["五", "轉 88"], ["六", ""]];
    for (const [name, phone_ext] of cases) expect((await create("elvis", { organization: "A", name, phone_area: "02", phone: "2356-7417", phone_ext })).status, name).toBe(201);
    const byName = Object.fromEntries((await list()).map((contact) => [contact.name, contact.phone_ext]));
    expect(byName).toEqual({ 一: "35", 二: "1234", 三: "12", 四: "7", 五: "88", 六: "" });
    expect((await create("elvis", { organization: "B", name: "沒填", phone: "2356-7417" })).status).toBe(201);
    expect((await list()).find((contact) => contact.name === "沒填")?.phone_ext).toBe("");
    for (const phone_ext of ["12a", "1-2", "1".repeat(11)]) {
      const refused = await create("elvis", { organization: "C", name: `錯${phone_ext}`, phone_ext });
      expect(refused.status, phone_ext).toBe(422);
      expect(await refused.json(), phone_ext).toEqual({ error: phone_ext.length > 10 ? "分機不能超過 10 字" : "分機只能填數字，例如 1234" });
    }
  });

  it("修改分機會記在稽核紀錄", async () => {
    await create("elvis", NTUH);
    const [contact] = await list();
    expect((await as("intern", `/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ phone_ext: "#5678" }) })).status).toBe(200);
    expect((await list())[0].phone_ext).toBe("5678");
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE action='update'").first()).toEqual({ summary: "更新聯絡人「臺大醫院／王小明」：分機" });
  });

  it("既有資料：號碼裡的分機拆到分機欄，看不懂的寫法不動", async () => {
    const rows = [
      ["a", "2356-7417#35", "2356-7417", "35"],
      ["b", "2312-3456 #1234", "2312-3456", "1234"],
      ["c", "2312-3456 分機 12", "2312-3456", "12"],
      ["d", "2312-3456 分機：12", "2312-3456", "12"],
      ["e", "2312-3456 ext. 99", "2312-3456", "99"],
      ["f", "2312-3456 Ext 7", "2312-3456", "7"],
      ["g", "2312-3456轉66", "2312-3456", "66"],
      ["h", "2312-3456 #12 或 #13", "2312-3456 #12 或 #13", ""],
      ["i", "#12", "#12", ""],
      ["j", "3702-2680", "3702-2680", ""],
      ["k", "", "", ""],
    ];
    for (const [id, phone] of rows) await env.DB.prepare("INSERT INTO contacts (id,organization,name,phone) VALUES (?,?,?,?)").bind(id, `機構${id}`, `人${id}`, phone).run();
    // 套用 migration 裡拆分機的那幾段（欄位已經在測試資料庫裡了）
    const migration = readFileSync(new URL("../migrations/0022_contact_phone_ext.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter((part) => part.startsWith("UPDATE"))) await env.DB.prepare(statement).run();
    for (const [id, , phone, ext] of rows) expect(await env.DB.prepare("SELECT phone, phone_ext FROM contacts WHERE id=?").bind(id).first(), id).toEqual({ phone, phone_ext: ext });
  });
});

describe("沒登入", () => {
  it("看不到也改不了", async () => {
    expect((await worker.fetch(new Request(`${BASE}/api/contacts`), env, ctx)).status).toBe(401);
  });
});
