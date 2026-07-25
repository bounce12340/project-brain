import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { v7Routes } from "../worker/routes/v7";
import { parseRegwatchDraftBatchInput } from "../worker/services/regwatch";
import type { AppContext, AuthUser } from "../worker/types";

const manager: AuthUser = {
  id: "usr_manager", email: "manager@example.com", name: "Manager", role: "member", group_id: "grp_general",
  group_name: "RA/PV", group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1,
  approval_status: "approved",
};

class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE reg_entries (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
        file_id TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE files (
        id TEXT PRIMARY KEY, project_id TEXT, storage_key TEXT NOT NULL
      );
      CREATE TABLE reg_entry_files (
        entry_id TEXT NOT NULL REFERENCES reg_entries(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL, summary TEXT NOT NULL
      );
    `);
  }

  prepare(sql: string) {
    const statement = this.sqlite.prepare(sql);
    let values: SQLInputValue[] = [];
    return {
      bind(...bound: SQLInputValue[]) { values = bound; return this; },
      async first<T>(column?: string): Promise<T | null> {
        const row = statement.get(...values) as Record<string, unknown> | undefined;
        if (!row) return null;
        return (column ? row[column] : row) as T;
      },
      async all<T>() {
        return { results: statement.all(...values) as T[] };
      },
      async run() {
        const result = statement.run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function testApp(user: AuthUser, db = new TestD1()) {
  const deletedObjects: string[] = [];
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("user", user); c.set("sessionToken", "test"); return next(); });
  app.route("/api", v7Routes);
  const env = { DB: db, FILES: { async delete(key: string) { deletedObjects.push(key); } } } as unknown as Env;
  return { app, db, env, deletedObjects };
}

const apps: TestD1[] = [];
function setup(user = manager) {
  const result = testApp(user);
  apps.push(result.db);
  return result;
}

afterEach(() => {
  while (apps.length) apps.pop()?.sqlite.close();
});

async function batchRequest(
  app: Hono<AppContext>,
  env: Env,
  body: unknown,
) {
  return app.request("/api/regwatch/drafts/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, env);
}

describe("SPEC-V11-1 TFDA 草稿批次端點", () => {
  it("只允許 admin 與 RA/PV member 使用", async () => {
    const user = { ...manager, group_id: "grp_bd" };
    const { app, env } = setup(user);
    const response = await batchRequest(app, env, { action: "approve", ids: ["draft-1"] });
    expect(response.status).toBe(403);
  });

  it("拒絕空 ids、未知 action 與超過 100 個 ids", async () => {
    expect(parseRegwatchDraftBatchInput({ action: "approve", ids: [] })).toBeNull();
    expect(parseRegwatchDraftBatchInput({ action: "archive", ids: ["draft-1"] })).toBeNull();
    expect(parseRegwatchDraftBatchInput({ action: "delete", ids: Array.from({ length: 101 }, (_, index) => `draft-${index}`) })).toBeNull();
    expect(parseRegwatchDraftBatchInput({ action: "delete", ids: Array.from({ length: 100 }, (_, index) => `draft-${index}`) })?.ids).toHaveLength(100);
  });

  it("approve 只核准 draft，published 與不存在 id 計入 skipped", async () => {
    const { app, db, env } = setup();
    db.sqlite.exec("INSERT INTO reg_entries(id,title,status) VALUES ('draft-1','Draft','draft'),('published-1','Published','published')");
    const response = await batchRequest(app, env, { action: "approve", ids: ["draft-1", "published-1", "missing-1"] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, skipped: 2 });
    expect(db.sqlite.prepare("SELECT status FROM reg_entries WHERE id='draft-1'").get()).toEqual({ status: "published" });
    expect(db.sqlite.prepare("SELECT status FROM reg_entries WHERE id='published-1'").get()).toEqual({ status: "published" });
  });

  it("重複 id 只處理一次，其餘請求項計入 skipped", async () => {
    const { app, db, env } = setup();
    db.sqlite.exec("INSERT INTO reg_entries(id,title,status) VALUES ('draft-1','Draft','draft')");
    const response = await batchRequest(app, env, { action: "approve", ids: ["draft-1", "draft-1"] });
    await expect(response.json()).resolves.toEqual({ processed: 1, skipped: 1 });
  });

  it("delete 只刪 draft，並清除其孤兒附件", async () => {
    const { app, db, env, deletedObjects } = setup();
    db.sqlite.exec(`
      INSERT INTO files(id,storage_key) VALUES ('file-orphan','regwatch/file-orphan/source.txt');
      INSERT INTO reg_entries(id,title,status,file_id) VALUES
        ('draft-1','Draft','draft','file-orphan'),
        ('published-1','Published','published',NULL);
      INSERT INTO reg_entry_files(entry_id,file_id) VALUES ('draft-1','file-orphan');
    `);
    const response = await batchRequest(app, env, { action: "delete", ids: ["draft-1", "published-1"] });
    await expect(response.json()).resolves.toEqual({ processed: 1, skipped: 1 });
    expect(db.sqlite.prepare("SELECT id FROM reg_entries ORDER BY id").all()).toEqual([{ id: "published-1" }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM files").get()).toEqual({ count: 0 });
    expect(deletedObjects).toEqual(["regwatch/file-orphan/source.txt"]);
  });

  it("delete 保留仍由 published 引用的共用附件", async () => {
    const { app, db, env, deletedObjects } = setup();
    db.sqlite.exec(`
      INSERT INTO files(id,storage_key) VALUES ('file-shared','regwatch/file-shared/source.txt');
      INSERT INTO reg_entries(id,title,status,file_id) VALUES
        ('draft-1','Draft','draft','file-shared'),
        ('published-1','Published','published','file-shared');
      INSERT INTO reg_entry_files(entry_id,file_id) VALUES ('draft-1','file-shared'),('published-1','file-shared');
    `);
    const response = await batchRequest(app, env, { action: "delete", ids: ["draft-1"] });
    await expect(response.json()).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(db.sqlite.prepare("SELECT id FROM files").all()).toEqual([{ id: "file-shared" }]);
    expect(deletedObjects).toEqual([]);
  });

  it("每次有效批次只寫一筆含 action 與筆數的 audit", async () => {
    const { app, db, env } = setup();
    db.sqlite.exec("INSERT INTO reg_entries(id,title,status) VALUES ('draft-1','Draft','draft')");
    await batchRequest(app, env, { action: "approve", ids: ["draft-1", "missing-1"] });
    const rows = db.sqlite.prepare("SELECT action,summary FROM audit_log").all() as Array<{ action: string; summary: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("regwatch_draft_batch");
    expect(rows[0].summary).toContain("action=approve, requested=2, processed=1, skipped=1");
  });
});
