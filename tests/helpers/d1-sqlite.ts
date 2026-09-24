import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * 用 Node 內建的 SQLite 模擬 D1，讓測試能真的執行 worker 裡的 SQL。
 *
 * 只掃原始碼的測試看得到「有沒有寫某個條件」，看不到條件寫錯。提醒的篩選條件
 * 全在 SQL 裡，要知道某個專案會不會收到提醒，只能真的跑一次。
 * 結構用 migrations/ 全部依序套用，與正式環境同一份定義。
 */
export function createTestD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  // D1 預設開啟外鍵檢查（含 ON DELETE CASCADE），SQLite 預設關閉，不打開的話行為會不一樣。
  raw.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  return { db: shim(raw), raw };
}

const value = (input: unknown): SQLInputValue => {
  if (typeof input === "boolean") return input ? 1 : 0;
  if (input === undefined) throw new Error("D1 不接受 undefined 參數");
  return input as SQLInputValue;
};

function statement(raw: DatabaseSync, sql: string, params: unknown[] = []): D1PreparedStatement {
  const run = () => raw.prepare(sql);
  const bound = params.map(value);
  const self = {
    bind: (...args: unknown[]) => statement(raw, sql, args),
    all: async () => ({ results: run().all(...bound), success: true, meta: {} }),
    first: async (column?: string) => {
      const row = run().get(...bound) as Record<string, unknown> | undefined;
      if (!row) return null;
      return column ? row[column] ?? null : row;
    },
    run: async () => {
      const result = run().run(...bound);
      return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    raw: async () => run().all(...bound).map((row) => Object.values(row as Record<string, unknown>)),
  };
  return self as unknown as D1PreparedStatement;
}

function shim(raw: DatabaseSync): D1Database {
  const db = {
    prepare: (sql: string) => statement(raw, sql),
    batch: async (statements: D1PreparedStatement[]) => {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql: string) => { raw.exec(sql); return { count: 0, duration: 0 }; },
  };
  return db as unknown as D1Database;
}
