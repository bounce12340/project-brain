import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { v6Routes } from "../worker/routes/v6";
import type { AppContext, AuthUser } from "../worker/types";
import { en, zh } from "../src/i18n/translations";
import { regwatchMonths, regwatchYears } from "../src/pages/RegwatchPage";

const user: AuthUser = {
  id: "usr_v11_3",
  email: "v11-3@example.com",
  name: "V11.3",
  role: "member",
  group_id: "grp_general",
  group_name: "RA/PV",
  group_type: "general",
  must_change_password: 0,
  email_notifications: 1,
  onboarding_done: 1,
  approval_status: "approved",
};

class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE files (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL, size INTEGER NOT NULL,
        content_type TEXT NOT NULL
      );
      CREATE TABLE reg_entries (
        id TEXT PRIMARY KEY, entry_date TEXT NOT NULL, entry_type TEXT NOT NULL,
        product_line TEXT NOT NULL, category TEXT, title TEXT NOT NULL,
        key_points TEXT, link TEXT, file_id TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        status TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT
      );
      CREATE TABLE reg_entry_files (
        entry_id TEXT NOT NULL, file_id TEXT NOT NULL, position INTEGER NOT NULL
      );
      INSERT INTO users(id,name) VALUES ('usr_v11_3','V11.3');
    `);
  }

  prepare(sql: string) {
    const statement = this.sqlite.prepare(sql);
    let values: SQLInputValue[] = [];
    return {
      bind(...bound: SQLInputValue[]) { values = bound; return this; },
      async first<T>(column?: string): Promise<T | null> {
        const row = statement.get(...values) as Record<string, T> | undefined;
        return row ? (column ? row[column] : row as T) : null;
      },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return statement.run(...values); },
    };
  }

  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

const databases: TestD1[] = [];

function setup() {
  const db = new TestD1();
  databases.push(db);
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("sessionToken", "test");
    await next();
  });
  app.route("/api", v6Routes);
  const env = { DB: db, FILES: { async delete() {} } } as unknown as Env;
  return { app, db, env };
}

function insertEntry(db: TestD1, id: string, entryDate: string) {
  db.sqlite.prepare(`INSERT INTO reg_entries
    (id,entry_date,entry_type,product_line,title,key_points,created_by,created_at,updated_at,status,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, entryDate, "announcement", "藥品", id, "", user.id,
    `${entryDate} 00:00:00`, `${entryDate} 00:00:00`, "published", "manual",
  );
}

async function list(app: Hono<AppContext>, env: Env, query = "") {
  const response = await app.request(`/api/regwatch${query}`, {}, env);
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    entries: Array<{ id: string }>;
    total: number;
    total_pages: number;
  }>;
}

afterEach(() => {
  while (databases.length) databases.pop()?.sqlite.close();
});

describe("SPEC-V11-3 regwatch year and month filters", () => {
  it("year+month 只回傳該年月，跨年資料不混入且分頁計數同步", async () => {
    const { app, db, env } = setup();
    for (let index = 1; index <= 51; index += 1) {
      insertEntry(db, `jul-${index.toString().padStart(2, "0")}`, `2026-07-${((index - 1) % 28 + 1).toString().padStart(2, "0")}`);
    }
    insertEntry(db, "other-month", "2026-08-01");
    insertEntry(db, "other-year", "2025-07-01");

    const firstPage = await list(app, env, "?year=2026&month=7");
    expect(firstPage.entries).toHaveLength(50);
    expect(firstPage.total).toBe(51);
    expect(firstPage.total_pages).toBe(2);

    const secondPage = await list(app, env, "?year=2026&month=7&page=2");
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.total).toBe(51);
  });

  it("month 無 year 時完全忽略，結果與無年月參數一致", async () => {
    const { app, db, env } = setup();
    insertEntry(db, "jul-2026", "2026-07-01");
    insertEntry(db, "aug-2026", "2026-08-01");
    insertEntry(db, "jul-2025", "2025-07-01");

    expect(await list(app, env, "?month=7")).toEqual(await list(app, env));
  });

  it.each(["0", "13", "abc"])("非法 month=%s 在有 year 時忽略", async (month) => {
    const { app, db, env } = setup();
    insertEntry(db, "jul-2026", "2026-07-01");
    insertEntry(db, "aug-2026", "2026-08-01");
    insertEntry(db, "jul-2025", "2025-07-01");

    expect(await list(app, env, `?year=2026&month=${month}`)).toEqual(await list(app, env, "?year=2026"));
  });

  it("UI 年份範圍、月份選項與中英 i18n key 完整", () => {
    const pageSource = readFileSync(new URL("../src/pages/RegwatchPage.tsx", import.meta.url), "utf8");
    const currentTaipeiYear = Number(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
    }).format(new Date()));
    expect(regwatchYears[0]).toBe(String(currentTaipeiYear));
    expect(regwatchYears.at(-1)).toBe("2018");
    expect(regwatchYears).toHaveLength(currentTaipeiYear - 2018 + 1);
    expect(regwatchMonths.map(({ value }) => value)).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1)),
    );
    expect(zh["regwatch.allYears"]).toBe("全部年份");
    expect(zh["regwatch.allMonths"]).toBe("全部月份");
    expect(zh["regwatch.month.1"]).toBe("1月");
    expect(en["regwatch.month.1"]).toBe("Jan");
    expect(en["regwatch.month.12"]).toBe("Dec");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(pageSource).toContain('disabled={!filters.year}');
    expect(pageSource).toContain('month: value ? current.month : ""');
    expect(pageSource).toContain('changeFilter("month", event.target.value)');
  });
});
