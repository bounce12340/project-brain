import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteRegwatchEntry,
  processRegwatchDraftBatch,
} from "../worker/services/regwatch";
import { fetchTfdaDrafts } from "../worker/services/tfda";

class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE reg_entries (
        id TEXT PRIMARY KEY,
        entry_date TEXT NOT NULL,
        entry_type TEXT NOT NULL DEFAULT 'announcement',
        product_line TEXT NOT NULL DEFAULT '其他',
        category TEXT,
        title TEXT NOT NULL,
        key_points TEXT,
        link TEXT,
        created_by TEXT,
        file_id TEXT,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT UNIQUE,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE tfda_rejected (
        source_ref TEXT PRIMARY KEY,
        title TEXT,
        rejected_by TEXT,
        rejected_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        storage_key TEXT NOT NULL
      );
      CREATE TABLE reg_entry_files (
        entry_id TEXT NOT NULL REFERENCES reg_entries(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
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

const databases: TestD1[] = [];

function setup() {
  const db = new TestD1();
  databases.push(db);
  const env = {
    DB: db,
    FILES: { async delete() {} },
  } as unknown as Env;
  return { db, env };
}

function insertEntry(
  db: TestD1,
  values: {
    id: string;
    title: string;
    status?: "draft" | "published";
    source?: "tfda_rss" | "manual";
    sourceRef?: string | null;
    entryDate?: string;
  },
) {
  db.sqlite.prepare(`INSERT INTO reg_entries
    (id,entry_date,title,status,source,source_ref)
    VALUES (?,?,?,?,?,?)`).run(
    values.id,
    values.entryDate ?? "2026-07-26",
    values.title,
    values.status ?? "draft",
    values.source ?? "tfda_rss",
    values.sourceRef ?? null,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length) databases.pop()?.sqlite.close();
});

describe("SPEC-V11-2 TFDA rejection tombstones", () => {
  it("migration 0010 建立規格指定的墓碑欄位", () => {
    const migration = readFileSync(new URL("../migrations/0010_v11_2.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE tfda_rejected");
    expect(migration).toContain("source_ref TEXT PRIMARY KEY");
    expect(migration).toContain("title TEXT");
    expect(migration).toContain("rejected_by TEXT");
    expect(migration).toContain("rejected_at TEXT DEFAULT CURRENT_TIMESTAMP");
  });

  it("刪除 TFDA 草稿前寫入 source_ref、title 與操作者墓碑", async () => {
    const { db, env } = setup();
    insertEntry(db, { id: "draft-tfda", title: "待駁回公告", sourceRef: "991126001" });

    await expect(deleteRegwatchEntry(env, "draft-tfda", "usr_reviewer")).resolves.toMatchObject({
      title: "待駁回公告",
    });

    expect(db.sqlite.prepare("SELECT id FROM reg_entries").all()).toEqual([]);
    expect(db.sqlite.prepare("SELECT source_ref,title,rejected_by,rejected_at FROM tfda_rejected").get()).toMatchObject({
      source_ref: "991126001",
      title: "待駁回公告",
      rejected_by: "usr_reviewer",
    });
  });

  it("批次刪除會為每一筆 TFDA 草稿寫墓碑", async () => {
    const { db, env } = setup();
    insertEntry(db, { id: "draft-a", title: "公告 A", sourceRef: "991126002" });
    insertEntry(db, { id: "draft-b", title: "公告 B", sourceRef: "991126003" });

    await expect(processRegwatchDraftBatch(env, {
      action: "delete",
      ids: ["draft-a", "draft-b"],
    }, "usr_reviewer")).resolves.toEqual({ processed: 2, skipped: 0 });

    expect(db.sqlite.prepare("SELECT source_ref,title,rejected_by FROM tfda_rejected ORDER BY source_ref").all()).toEqual([
      { source_ref: "991126002", title: "公告 A", rejected_by: "usr_reviewer" },
      { source_ref: "991126003", title: "公告 B", rejected_by: "usr_reviewer" },
    ]);
  });

  it("fetch 對墓碑 source_ref 計入 skipped_rejected 且不重建", async () => {
    const { db, env } = setup();
    db.sqlite.prepare("INSERT INTO tfda_rejected(source_ref,title,rejected_by) VALUES (?,?,?)")
      .run("991126004", "已駁回公告", "usr_reviewer");
    const extract = vi.fn();
    const feed = `<rss><channel><item>
      <title>已駁回公告</title>
      <link>https://www.fda.gov.tw/TC/newsContent.aspx?id=991126004</link>
      <pubDate>Sat, 25 Jul 2026 16:00:00 GMT</pubDate>
      <description><![CDATA[<p>不得復活</p>]]></description>
    </item></channel></rss>`;

    const stats = await fetchTfdaDrafts(env, {
      fetcher: async () => new Response(feed),
      extract,
    });

    expect(stats).toMatchObject({
      fetched: 1,
      new_drafts: 0,
      skipped_ref: 0,
      skipped_rejected: 1,
      skipped_dup: 0,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reg_entries").get()).toEqual({ count: 0 });
  });

  it("刪除手動條目不寫 TFDA 墓碑", async () => {
    const { db, env } = setup();
    insertEntry(db, {
      id: "manual-entry",
      title: "手動公告",
      source: "manual",
      sourceRef: null,
    });

    await expect(deleteRegwatchEntry(env, "manual-entry", "usr_reviewer")).resolves.not.toBeNull();

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tfda_rejected").get()).toEqual({ count: 0 });
  });

  it("核准後再刪除的 published TFDA 條目同樣寫墓碑", async () => {
    const { db, env } = setup();
    insertEntry(db, {
      id: "published-tfda",
      title: "已發布公告",
      status: "published",
      sourceRef: "991126005",
    });

    await expect(deleteRegwatchEntry(env, "published-tfda", "usr_reviewer")).resolves.not.toBeNull();

    expect(db.sqlite.prepare("SELECT source_ref,title,rejected_by FROM tfda_rejected").get()).toEqual({
      source_ref: "991126005",
      title: "已發布公告",
      rejected_by: "usr_reviewer",
    });
  });
});
