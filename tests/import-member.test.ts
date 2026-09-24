import { beforeEach, describe, expect, it } from "vitest";
import { ImportValidationError, runImport, type ImportMode } from "../worker/services/import-data";
import type { AuthUser } from "../worker/types";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 批次匯入開放給所有人之後，一般使用者只能做他在畫面上自己動手能做的事。
 * 這些規則全在匯入程式裡，所以直接在套好 migrations 的 SQLite 上真的匯入一次來驗。
 */

let db: D1Database;

const person = (id: string, role: AuthUser["role"], group: string) =>
  ({ id, email: `${id}@example.com`, name: id, role, group_id: group, group_name: group, group_type: "general" }) as AuthUser;
const admin = person("boss", "admin", "grp_general");
const ra = person("ra", "member", "grp_general");
const raMate = person("ra2", "member", "grp_general");
const bd = person("bd", "member", "grp_bd");
const intern = person("kid", "intern", "grp_general");

const run = (actor: AuthUser, payload: unknown, mode: ImportMode = actor.role === "admin" ? "admin" : "member", dryRun = false) =>
  runImport(db, actor, payload, { mode, dryRun });

async function issuesOf(promise: Promise<unknown>): Promise<string[]> {
  try { await promise; } catch (error) {
    if (error instanceof ImportValidationError) return error.issues;
    throw error;
  }
  throw new Error("預期要被擋下，結果匯入成功了");
}

const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
const count = async (table: string) => (await row<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;

async function project(id: string, name: string, owner: AuthUser, fields: Record<string, unknown> = {}) {
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,external_key,progress_mode) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, name, fields.group_id ?? owner.group_id, owner.id, fields.visibility ?? "group", fields.status ?? "active", fields.external_key ?? null, fields.progress_mode ?? "auto").run();
  await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES (?,?,?,?,0)").bind(`${id}_s`, id, "待辦", "#888").run();
}

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [admin, ra, raMate, bd, intern]) {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)")
      .bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
});

describe("一般使用者建立新專案", () => {
  it("擁有者一律是匯入者，表上寫別人也一樣", async () => {
    const stats = await run(ra, { projects: [{ name: "新案", group: "RA/PV組", owner_email: bd.email }] });
    expect(stats.projects.created).toBe(1);
    expect(await row("SELECT owner_id FROM projects WHERE name='新案'")).toEqual({ owner_id: "ra" });
    expect(stats.warnings.join()).toContain("新專案一律由匯入者擔任擁有者");
  });

  it("實習生不能建立專案", async () => {
    const issues = await issuesOf(run(intern, { projects: [{ name: "實習生的案", group: "RA/PV組" }] }));
    expect(issues.join()).toContain("實習生不能建立新專案");
    expect(await count("projects")).toBe(0);
  });

  it("沒有專案代碼、名稱也對不到時，要有組別才能新增", async () => {
    const issues = await issuesOf(run(ra, { projects: [{ name: "不存在的案", tasks: [{ title: "x" }] }] }));
    expect(issues).toEqual(["找不到專案「不存在的案」。要新增專案，請提供組別"]);
  });
});

describe("一般使用者動既有專案", () => {
  it("可以把任務加進同組、有編輯權的專案，並用名稱對到它", async () => {
    await project("p1", "Salagen準備展延", raMate);
    const stats = await run(ra, { projects: [{ name: "Salagen準備展延", tasks: [{ title: "送件", due_date: "2026-10-01" }] }] });
    expect(stats.projects).toEqual({ created: 0, updated: 1 });
    expect(await row("SELECT title FROM tasks WHERE project_id='p1'")).toEqual({ title: "送件" });
    expect(await row("SELECT owner_id FROM projects WHERE id='p1'")).toEqual({ owner_id: "ra2" });
  });

  it("用專案代碼改寫別組的專案會被擋下，而且什麼都沒寫進去", async () => {
    // 這正是直接開放 admin 匯入會出的事：知道代碼就能改掉別人的專案。
    // 全公司看得到，但只有 BD 組能編輯。
    await project("pb", "BD 的案", bd, { external_key: "BD-001", visibility: "all" });
    const issues = await issuesOf(run(ra, { projects: [{ external_key: "BD-001", name: "被我改掉了", status: "archived", tasks: [{ title: "偷塞的任務" }] }] }));
    expect(issues).toEqual(["你沒有權限修改專案「BD 的案」"]);
    expect(await row("SELECT name,status FROM projects WHERE id='pb'")).toEqual({ name: "BD 的案", status: "active" });
    expect(await count("tasks")).toBe(0);
  });

  it("猜中看不到的私人專案代碼時，錯誤訊息不透露它的名稱", async () => {
    await project("secret", "機密案", bd, { visibility: "private", external_key: "BD-SECRET" });
    const issues = await issuesOf(run(ra, { projects: [{ external_key: "BD-SECRET", name: "我的案" }] }));
    expect(issues).toEqual(["專案代碼「BD-SECRET」已被你沒有權限的專案使用，請換一個代碼"]);
    expect(issues.join()).not.toContain("機密案");
  });

  it("看不到的專案不會被名稱「猜中」", async () => {
    await project("secret", "機密案", bd, { visibility: "private" });
    const stats = await run(ra, { projects: [{ name: "機密案", group: "RA/PV組", tasks: [{ title: "我的任務" }] }] });
    expect(stats.projects.created).toBe(1);
    expect(await count("tasks")).toBe(1);
    expect(await row("SELECT COUNT(*) AS n FROM tasks WHERE project_id='secret'")).toEqual({ n: 0 });
  });

  it("擁有者與組別只有管理員能改；一般使用者填了只會得到警告", async () => {
    await project("p1", "案", ra);
    const stats = await run(ra, { projects: [{ name: "案", group: "BD組", owner_email: bd.email }] });
    expect(await row("SELECT owner_id,group_id FROM projects WHERE id='p1'")).toEqual({ owner_id: "ra", group_id: "grp_general" });
    expect(stats.warnings.join()).toContain("組別只有管理員能改");
    expect(stats.warnings.join()).toContain("擁有者只有管理員能改");
  });

  it("名稱對到兩個看得到的專案時要求填代碼", async () => {
    await project("a", "重複", ra);
    await project("b", "重複", raMate);
    const issues = await issuesOf(run(ra, { projects: [{ name: "重複" }] }));
    expect(issues).toEqual(["有 2 個專案都叫「重複」，請填專案代碼區分"]);
  });
});

describe("一般使用者不能匯入的內容", () => {
  it("法規動態、KR、證照一律擋下，並一次列出", async () => {
    await project("p1", "案", ra);
    const issues = await issuesOf(run(ra, {
      projects: [{ name: "案", key_results: [{ title: "KR" }], licenses: [{ name: "許可", expires_at: "2027-01-01" }] }],
      reg_entries: [{ entry_date: "2026-09-01", title: "公告", product_line: "藥品" }],
    }));
    expect(issues).toEqual(["法規動態僅限管理員匯入", "「案」含有僅限管理員匯入的內容：KR、證照效期"]);
    expect(await count("key_results")).toBe(0);
    expect(await count("reg_entries")).toBe(0);
  });

  it("進度紀錄一律記在自己名下，原作者寫在內文開頭", async () => {
    await project("p1", "案", ra);
    const stats = await run(ra, { projects: [{ name: "案", progress_updates: [
      { date: "2026-09-01", content: "我寫的" },
      { date: "2026-09-02", content: "同事寫的", author_email: bd.email },
    ] }] });
    const rows = await db.prepare("SELECT author_id,content FROM progress_updates ORDER BY created_at").all();
    expect(rows.results).toEqual([
      { author_id: "ra", content: "我寫的" },
      { author_id: "ra", content: "【原作者：bd@example.com】 同事寫的" },
    ]);
    expect(stats.warnings.join()).toContain("進度紀錄一律記在匯入者名下");
  });
});

describe("問題一次列齊", () => {
  it("好幾個專案各有問題時，全部一起回報", async () => {
    await project("pb", "BD 的案", bd, { external_key: "BD-001" });
    const issues = await issuesOf(run(ra, { projects: [
      { external_key: "BD-001", name: "x" },
      { name: "沒組別的新案" },
      { name: "壞日期", group: "RA/PV組", start_date: "2026/9/1" },
      { name: "壞組別", group: "不存在組" },
    ] }));
    expect(issues).toHaveLength(4);
  });

  it("同一個專案寫了兩筆會被擋下", async () => {
    const issues = await issuesOf(run(ra, { projects: [{ name: "A", group: "RA/PV組" }, { name: "A", group: "RA/PV組" }] }));
    expect(issues[0]).toContain("出現了不只一次");
  });
});

describe("預演（dryRun）", () => {
  it("回傳的統計與實際匯入相同，但什麼都沒寫", async () => {
    await project("p1", "舊案", ra);
    const payload = { projects: [
      { name: "新案", group: "RA/PV組", tasks: [{ title: "t1" }, { title: "t2", done: true }], milestones: [{ title: "m", due_date: "2026-10-01" }] },
      { name: "舊案", progress_updates: [{ date: "2026-09-01", content: "進度" }] },
    ] };
    const before = await Promise.all(["projects", "tasks", "milestones", "progress_updates", "stages"].map(count));
    const preview = await run(ra, payload, "member", true);
    expect(await Promise.all(["projects", "tasks", "milestones", "progress_updates", "stages"].map(count))).toEqual(before);
    const real = await run(ra, payload);
    expect(preview).toEqual(real);
  });
});

describe("既有專案只改有填的欄位（管理員也一樣）", () => {
  it("重匯時沒寫狀態不會被改回進行中，沒寫擁有者也不會換成管理員", async () => {
    await project("p1", "案", ra, { external_key: "K1", status: "paused" });
    await run(admin, { projects: [{ external_key: "K1", name: "案", group: "RA/PV組" }] });
    expect(await row("SELECT status,owner_id FROM projects WHERE id='p1'")).toEqual({ status: "paused", owner_id: "ra" });
  });

  it("管理員打錯擁有者 Email 時維持原擁有者", async () => {
    await project("p1", "案", ra, { external_key: "K1" });
    const stats = await run(admin, { projects: [{ external_key: "K1", name: "案", group: "RA/PV組", owner_email: "typo@example.com" }] });
    expect(await row("SELECT owner_id FROM projects WHERE id='p1'")).toEqual({ owner_id: "ra" });
    expect(stats.warnings).toEqual(["K1: 找不到使用者 typo@example.com，維持原擁有者"]);
  });

  it("管理員可以改擁有者與組別", async () => {
    await project("p1", "案", ra, { external_key: "K1" });
    await run(admin, { projects: [{ external_key: "K1", name: "案", group: "BD組", owner_email: bd.email }] });
    expect(await row("SELECT owner_id,group_id FROM projects WHERE id='p1'")).toEqual({ owner_id: "bd", group_id: "grp_bd" });
  });
});

describe("新欄位", () => {
  it("產品、廠區、任務開始日寫得進去", async () => {
    await run(ra, { projects: [{ name: "新案", group: "RA/PV組", product: "Salagen", site: "Pathone", tasks: [{ title: "t", start_date: "2026-09-01", due_date: "2026-09-30" }] }] });
    expect(await row("SELECT product,site FROM projects WHERE name='新案'")).toEqual({ product: "Salagen", site: "Pathone" });
    expect(await row("SELECT start_date,due_date FROM tasks")).toEqual({ start_date: "2026-09-01", due_date: "2026-09-30" });
  });

  it("任務開始日晚於到期日會被擋下", async () => {
    await expect(run(ra, { projects: [{ name: "新案", group: "RA/PV組", tasks: [{ title: "t", start_date: "2026-10-01", due_date: "2026-09-01" }] }] }))
      .rejects.toThrow("開始日不能晚於到期日");
  });

  it("匯入後重算自動進度，已完成的任務不會讓專案停在 0%", async () => {
    await run(ra, { projects: [{ name: "新案", group: "RA/PV組", tasks: [{ title: "a", done: true }, { title: "b" }] }] });
    expect(await row("SELECT progress FROM projects WHERE name='新案'")).toEqual({ progress: 50 });
  });
});
