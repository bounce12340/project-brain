import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 進度紀錄上標示的日期時間可以調整（例如補記上週的會議），存成資料庫原本的 UTC 格式。 */

const BASE = "http://127.0.0.1:8787";
let env: Env;
const sessions: Record<string, string> = {};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const patch = (userId: string, id: string, body: unknown) => worker.fetch(new Request(`${BASE}/api/progress-updates/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
const stored = (id: string) => env.DB.prepare("SELECT content, created_at, edited_by FROM progress_updates WHERE id=?").bind(id).first<{ content: string; created_at: string; edited_by: string | null }>();

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare(`INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES
    ('elvis','elvis@example.com','Elvis','x','member','grp_qa',0),('other','other@example.com','別組','x','member','grp_general',0)`).run();
  for (const id of ["elvis", "other"]) {
    const token = `session-${id}-${Math.random()}`;
    await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()).run();
    sessions[id] = `sid=${token}`;
  }
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility) VALUES ('p1','QA：一般事務','grp_qa','elvis','group')").run();
  await db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,created_at) VALUES ('u1','p1','elvis','5/19 訪廠-雲林永洺機械','2026-09-29 06:00:00'),('u2','p1','elvis','匯入的舊紀錄','2026-05-11T04:00:00.000Z')").run();
});

describe("調整進度紀錄的時間", () => {
  it("只改時間：以台北時間輸入，存成 UTC；內容不變，標示已編輯並記稽核", async () => {
    const response = await patch("elvis", "u1", { created_at: "2026-05-19T14:30:00+08:00" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, created_at: "2026-05-19 06:30:00" });
    expect(await stored("u1")).toEqual({ content: "5/19 訪廠-雲林永洺機械", created_at: "2026-05-19 06:30:00", edited_by: "elvis" });
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_id='u1'").first()).toEqual({ summary: "時間改為 2026-05-19 14:30：「5/19 訪廠-雲林永洺機械」" });
  });

  it("內容與時間一起改", async () => {
    await patch("elvis", "u1", { content: "5/19 訪廠-雲林永洺機械（AJT 包裝機）", created_at: "2026-05-19T09:00:00+08:00" });
    expect(await stored("u1")).toMatchObject({ content: "5/19 訪廠-雲林永洺機械（AJT 包裝機）", created_at: "2026-05-19 01:00:00" });
    expect(await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_id='u1'").first()).toEqual({ summary: "編輯進度紀錄，時間改為 2026-05-19 09:00：「5/19 訪廠-雲林永洺機械（AJT 包裝機）」" });
  });

  it("只改內容時時間不動（沿用舊行為）", async () => {
    await patch("elvis", "u2", { content: "匯入的舊紀錄（補充）" });
    expect(await stored("u2")).toMatchObject({ content: "匯入的舊紀錄（補充）", created_at: "2026-05-11T04:00:00.000Z" });
  });

  it("時間沒變就不寫任何東西", async () => {
    expect((await patch("elvis", "u2", { created_at: "2026-05-11T12:00:00+08:00" })).status).toBe(200);
    expect(await stored("u2")).toMatchObject({ created_at: "2026-05-11T04:00:00.000Z", edited_by: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({ n: 0 });
  });

  it("未來的時間、看不懂的時間、太久以前的時間都不收", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    for (const created_at of [future, "昨天", "", 20260519, "1999-12-31T00:00:00Z"]) {
      expect((await patch("elvis", "u1", { created_at })).status).toBe(422);
    }
    expect(await stored("u1")).toMatchObject({ created_at: "2026-09-29 06:00:00" });
  });

  it("沒有編輯權限的人不能改", async () => {
    expect((await patch("other", "u1", { created_at: "2026-05-19T14:30:00+08:00" })).status).toBe(403);
  });

  it("改完之後專案頁依新時間排序", async () => {
    await patch("elvis", "u1", { created_at: "2026-05-01T09:00:00+08:00" });
    const response = await worker.fetch(new Request(`${BASE}/api/projects/p1`, { headers: { Cookie: sessions.elvis } }), env, ctx);
    const { progress_updates: updates } = await response.json() as { progress_updates: Array<{ id: string }> };
    expect(updates.map((update) => update.id)).toEqual(["u2", "u1"]);
  });
});
