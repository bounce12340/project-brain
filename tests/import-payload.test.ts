import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runAdminImport } from "../worker/services/import-data";
import { collectPayloadEmails, d1Params, databaseIdFromWranglerConfig, firstRowValue, parseArgs } from "../scripts/import-remote";

/**
 * `imports/` 底下的 payload 會被 CI 匯進正式資料庫，所以在合併前就要證明它們符合
 * 匯入合約。這裡用 node:sqlite 套上真實 migrations 跑一次真正的 `runAdminImport`，
 * 再跑第二次驗冪等——與 `scripts/import-remote.ts` 對正式站做的事情完全相同，
 * 只是換成用完即丟的記憶體資料庫。
 */
function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  return db;
}

/** 把 node:sqlite 包成 runAdminImport 需要的 D1 介面。 */
function localD1(db: DatabaseSync): D1Database {
  const query = (sql: string, params: readonly unknown[]) =>
    db.prepare(sql).all(...(d1Params(params) as never[])) as Record<string, unknown>[];
  const statement = (sql: string, params: readonly unknown[] = []): D1PreparedStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({ results: query(sql, params) }),
    first: async (column?: string) => firstRowValue(query(sql, params), column),
    run: async () => { db.prepare(sql).run(...(d1Params(params) as never[])); return { success: true }; },
  } as unknown as D1PreparedStatement);
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: D1PreparedStatement[]) => { for (const item of list) await item.run(); return []; },
  } as unknown as D1Database;
}

const actor = { id: "usr_admin", email: "bounceto12340@gmail.com", role: "admin", group_id: "grp_general" } as never;
const payloadFiles = existsSync("imports") ? readdirSync("imports").filter((name) => name.endsWith(".json")).sort() : [];

describe("imports/ 的 payload", () => {
  it("至少有一份待匯入的 payload", () => {
    expect(payloadFiles.length).toBeGreaterThan(0);
  });

  for (const file of payloadFiles) {
    describe(file, () => {
      const payload = JSON.parse(readFileSync(`imports/${file}`, "utf8")) as Record<string, unknown>;

      it("每個 Email 欄位都指向 seed 裡存在的帳號", () => {
        const db = migratedDb();
        const known = new Set((db.prepare("SELECT lower(email) AS email FROM users").all() as { email: string }[]).map((row) => row.email));
        for (const email of collectPayloadEmails(payload)) expect(known.has(email), `${email} 不在資料庫`).toBe(true);
      });

      it("匯入一次成功且沒有 fallback warning", async () => {
        const db = localD1(migratedDb());
        const stats = await runAdminImport(db, actor, payload);
        expect(stats.warnings).toEqual([]);
        expect(stats.projects.created).toBe((payload.projects as unknown[] | undefined)?.length ?? 0);
      });

      it("重送完全冪等：第二次全部計入 skipped", async () => {
        const db = localD1(migratedDb());
        const first = await runAdminImport(db, actor, payload);
        const second = await runAdminImport(db, actor, payload);
        expect(second.projects.created).toBe(0);
        expect(second.projects.updated).toBe(first.projects.created);
        for (const key of ["tasks", "milestones", "events", "progress_updates", "reg_entries"] as const) {
          expect(second[key].created, `${key} 不該重複建立`).toBe(0);
          expect(second[key].skipped, `${key} 應全數 skipped`).toBe(first[key].created);
        }
      });

      it("宣告的 progress 與自動進度算式一致", async () => {
        const project = (payload.projects as Record<string, unknown>[])[0];
        if (project.progress === undefined) return;
        const tasks = (project.tasks ?? []) as { done?: boolean }[];
        const milestones = (project.milestones ?? []) as { done?: boolean }[];
        const keyResults = (project.key_results ?? []) as { status?: string }[];
        const total = tasks.length + milestones.length + keyResults.length;
        const done = tasks.filter((task) => task.done).length
          + milestones.filter((milestone) => milestone.done).length
          + keyResults.filter((kr) => kr.status === "完成").length;
        expect(project.progress).toBe(Math.round(100 * done / total));
      });
    });
  }
});

describe("import-remote CLI", () => {
  it("解析參數", () => {
    expect(parseArgs(["--payload", "imports/a.json", "--actor", "Admin@Example.com"]))
      .toEqual({ payload: "imports/a.json", actorEmail: "admin@example.com", allowOwnerFallback: false });
    expect(parseArgs(["--payload=imports/a.json", "--actor=a@b.c", "--allow-owner-fallback"]).allowOwnerFallback).toBe(true);
    expect(() => parseArgs(["--actor", "a@b.c"])).toThrow("--payload");
    expect(() => parseArgs(["--payload", "x.json"])).toThrow("--actor");
  });

  it("收集所有 Email 欄位並小寫去重", () => {
    expect(collectPayloadEmails({
      projects: [{
        owner_email: "A@x.com",
        tasks: [{ assignee_email: "a@x.com" }, { assignee_email: "b@x.com" }],
        key_results: [{ owner_email: "C@x.com" }],
        progress_updates: [{ author_email: "b@x.com" }],
        clinical: { enrollments: [{ author_email: "d@x.com" }] },
      }],
    })).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
  });

  it("把 D1 REST API 不接受的型別正規化", () => {
    expect(d1Params(["a", 1, null, undefined, true, false])).toEqual(["a", 1, null, null, 1, 0]);
  });

  it("first() 取整列、first(col) 取單欄，沒資料回 null", () => {
    expect(firstRowValue([], "value")).toBeNull();
    expect(firstRowValue([{ value: 0 }], "value")).toBe(0);
    expect(firstRowValue([{ id: "x" }])).toEqual({ id: "x" });
  });

  it("從 wrangler.jsonc 讀出正式資料庫 id", () => {
    expect(databaseIdFromWranglerConfig(readFileSync("wrangler.jsonc", "utf8"))).toBe("31e51358-0ace-4f6f-99fd-ba602d8d4509");
    expect(() => databaseIdFromWranglerConfig("{}")).toThrow("database_id");
  });
});
