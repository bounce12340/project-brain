import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppContext, AuthUser } from "../worker/types";
import { adminImportRoutes, importRoutes } from "../worker/routes/import";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 一般使用者匯入的完整流程：送出 → 待審核（什麼都還沒寫）→ 管理員核准才寫入。
 * 直接對 API 發請求，資料庫是套好 migrations 的 SQLite。
 */

let db: D1Database;
const users: Record<string, AuthUser> = {};
const person = (id: string, role: AuthUser["role"], group: string) =>
  ({ id, email: `${id}@example.com`, name: `名字${id}`, role, group_id: group, group_name: group, group_type: "general" }) as AuthUser;

function app() {
  const server = new Hono<AppContext>();
  server.use("*", async (c, next) => { c.set("user", users[c.req.header("x-user") ?? ""]); await next(); });
  server.route("/api", importRoutes);
  server.route("/api/admin", adminImportRoutes);
  return server;
}

async function call(as: string, method: string, path: string, body?: unknown) {
  const response = await app().request(path, {
    method, headers: { "x-user": as, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const count = async (sql: string, ...params: unknown[]) => (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n ?? 0;
const payload = { projects: [{ name: "Salagen 包材變更", group: "RA/PV組", tasks: [{ title: "送件", due_date: "2026-10-01" }], progress_updates: [{ date: "2026-09-20", content: "資料收齊" }] }] };

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("DELETE FROM notifications").run();
  // 種子資料裡的管理員也會收到通知；這裡只看自己建立的帳號。
  await db.prepare("UPDATE users SET is_active=0").run();
  for (const user of [person("boss", "admin", "grp_general"), person("boss2", "admin", "grp_general"), person("ra", "member", "grp_general"), person("bd", "member", "grp_bd")]) {
    users[user.id] = user;
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
});

describe("送出前的檢查", () => {
  it("有問題時一次列出所有問題，且不建立申請", async () => {
    const result = await call("ra", "POST", "/api/import/validate", { payload: { projects: [{ name: "沒組別" }, { name: "壞日期", group: "RA/PV組", start_date: "2026/9/1" }] } });
    expect(result.status).toBe(422);
    expect(result.body.issues).toHaveLength(2);
    expect(await count("SELECT COUNT(*) AS n FROM import_requests")).toBe(0);
  });

  it("沒問題時回傳「會發生什麼」", async () => {
    const result = await call("ra", "POST", "/api/import/validate", { payload });
    expect(result.status).toBe(200);
    expect(result.body.summary.projects).toEqual({ created: 1, updated: 0 });
    expect(result.body.summary.tasks.created).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(0);
  });
});

describe("一般使用者送出", () => {
  it("變成待審核，還沒寫進任何專案資料，管理員都收到通知", async () => {
    const result = await call("ra", "POST", "/api/import", { source_name: "我的進度表.xlsx", payload });
    expect(result.status).toBe(201);
    expect(result.body.status).toBe("pending");
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tasks")).toBe(0);
    const notices = await db.prepare("SELECT user_id,title,body,link FROM notifications ORDER BY user_id").all();
    expect(notices.results).toEqual([
      { user_id: "boss", title: "批次匯入待審核：名字ra", body: "我的進度表.xlsx：新增專案 1、任務 1、進度紀錄 1", link: `/import?request=${result.body.id}` },
      { user_id: "boss2", title: "批次匯入待審核：名字ra", body: "我的進度表.xlsx：新增專案 1、任務 1、進度紀錄 1", link: `/import?request=${result.body.id}` },
    ]);
  });

  it("格式有問題的根本送不出去", async () => {
    const result = await call("ra", "POST", "/api/import", { payload: { projects: [{ name: "沒組別" }] } });
    expect(result.status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM import_requests")).toBe(0);
  });

  it("每人最多同時 5 筆待審核", async () => {
    for (let index = 0; index < 5; index += 1) expect((await call("ra", "POST", "/api/import", { payload })).status).toBe(201);
    expect((await call("ra", "POST", "/api/import", { payload })).status).toBe(429);
  });
});

describe("誰看得到申請", () => {
  it("一般使用者只看得到自己的，管理員看得到全部", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    expect((await call("ra", "GET", "/api/import/requests")).body.requests).toHaveLength(1);
    expect((await call("bd", "GET", "/api/import/requests")).body.requests).toHaveLength(0);
    expect((await call("boss", "GET", "/api/import/requests?status=pending")).body.requests).toHaveLength(1);
    expect((await call("bd", "GET", `/api/import/requests/${body.id}`)).status).toBe(404);
  });

  it("打開待審核申請時附上內容與重新檢查的結果", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    const detail = await call("boss", "GET", `/api/import/requests/${body.id}`);
    expect(detail.body.request.payload).toEqual(payload);
    expect(detail.body.check.ok).toBe(true);
    expect(detail.body.request.submitter_name).toBe("名字ra");
  });
});

describe("核准", () => {
  it("以提交者的身分寫入：專案與進度紀錄都在他名下，並通知他", async () => {
    const { body } = await call("ra", "POST", "/api/import", { source_name: "表.xlsx", payload });
    const approved = await call("boss", "POST", `/api/import/requests/${body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(await db.prepare("SELECT owner_id FROM projects").first()).toEqual({ owner_id: "ra" });
    expect(await db.prepare("SELECT author_id FROM progress_updates").first()).toEqual({ author_id: "ra" });
    expect(await db.prepare("SELECT status,reviewed_by FROM import_requests").first()).toEqual({ status: "approved", reviewed_by: "boss" });
    expect(await db.prepare("SELECT title,body FROM notifications WHERE user_id='ra'").first()).toEqual({ title: "批次匯入已核准", body: "表.xlsx：新增專案 1、任務 1、進度紀錄 1" });
  });

  it("只有管理員能核准", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    expect((await call("ra", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(403);
    expect((await call("bd", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(0);
  });

  it("重複核准不會重複寫入", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    expect((await call("boss", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(200);
    expect((await call("boss2", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(1);
  });

  it("送出後才失去權限的，核准時重新檢查會擋下，申請退回待審核", async () => {
    await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility) VALUES ('p1','共同案','grp_general','boss','group')").run();
    const { body } = await call("ra", "POST", "/api/import", { payload: { projects: [{ name: "共同案", tasks: [{ title: "我的任務" }] }] } });
    expect(body.status).toBe("pending");
    // 專案被移到別組，也不再是 ra 看得到的範圍。
    await db.prepare("UPDATE projects SET group_id='grp_bd' WHERE id='p1'").run();
    const approved = await call("boss", "POST", `/api/import/requests/${body.id}/approve`);
    expect(approved.status).toBe(422);
    expect(await db.prepare("SELECT status FROM import_requests").first()).toEqual({ status: "pending" });
    expect(await count("SELECT COUNT(*) AS n FROM tasks")).toBe(0);
  });
});

describe("退回與撤回", () => {
  it("退回時附上理由通知提交者，之後不能再核准", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    const rejected = await call("boss", "POST", `/api/import/requests/${body.id}/reject`, { note: "日期請用西元" });
    expect(rejected.status).toBe(200);
    expect(await db.prepare("SELECT title,body FROM notifications WHERE user_id='ra'").first()).toEqual({ title: "批次匯入被退回", body: "日期請用西元" });
    expect((await call("boss", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(0);
  });

  it("提交者可以撤回自己待審核的申請，別人不行", async () => {
    const { body } = await call("ra", "POST", "/api/import", { payload });
    expect((await call("bd", "POST", `/api/import/requests/${body.id}/withdraw`)).status).toBe(409);
    expect((await call("ra", "POST", `/api/import/requests/${body.id}/withdraw`)).status).toBe(200);
    expect((await call("boss", "POST", `/api/import/requests/${body.id}/approve`)).status).toBe(409);
  });
});

describe("管理員", () => {
  it("在新入口匯入時直接寫入，不必審核", async () => {
    const result = await call("boss", "POST", "/api/import", { payload });
    expect(result.body.status).toBe("applied");
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM import_requests")).toBe(0);
  });

  it("原本的 /api/admin/import 照舊只給管理員", async () => {
    expect((await call("ra", "POST", "/api/admin/import", payload)).status).toBe(403);
    expect((await call("boss", "POST", "/api/admin/import", payload)).status).toBe(200);
  });

  it("格式錯誤時一筆都不寫——先預演過才動手", async () => {
    const bad = { projects: [{ name: "好的案", group: "RA/PV組" }, { name: "壞的案", group: "RA/PV組", tasks: [{ title: "t", due_date: "2026-13-01" }] }] };
    expect((await call("boss", "POST", "/api/admin/import", bad)).status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM projects")).toBe(0);
  });
});
