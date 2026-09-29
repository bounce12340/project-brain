import { beforeEach, describe, expect, it } from "vitest";
import { chooseStageTemplate, ImportValidationError, runImport } from "../worker/services/import-data";
import type { AuthUser } from "../worker/types";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 匯入怎麼寫進資料庫：新專案用哪一套看板欄位、一次請求呼叫 D1 幾次、一個專案是不是整批寫入。
 *
 * 起因是 QA 組同仁一份 12 個專案、300 多列的表：預演要查 373 次，核准時預演兩次再寫一次，
 * 一個請求呼叫 D1 將近 1,450 次，超過 Workers 免費方案單次請求 1,000 次的上限；
 * 而且每個新專案都被套上「CAPA 矯正預防措施」的看板欄位。
 */

let db: D1Database;
const qa = { id: "elvis", email: "elvis@example.com", name: "陳冠宇", role: "member", group_id: "grp_qa", group_name: "QA組", group_type: "qa" } as AuthUser;

const QA_TEMPLATES: Array<[string, string, string[]]> = [
  ["tpl_capa", "CAPA 矯正預防措施", ["開立", "根因調查", "措施擬定", "執行中", "效期確認", "結案"]],
  ["tpl_sop", "QA 文件管制（SOP 制修訂）", ["起草", "部門審核", "品質核准", "生效發行", "歸檔"]],
  ["tpl_audit", "內部稽核（自我查核）", ["稽核計畫", "執行查核", "缺失開立", "改善追蹤", "結案"]],
];

/** 數呼叫 D1 的次數：一個 batch 算一次，和 Workers 計算子請求的方式一樣。 */
function counting(target: D1Database): { db: D1Database; calls: () => number; reset: () => void } {
  let calls = 0;
  let inBatch = false;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(inner, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(inner.bind(...values));
      if (key === "all" || key === "first" || key === "run" || key === "raw") return (...args: unknown[]) => {
        if (!inBatch) calls += 1;
        return (inner[key] as (...a: unknown[]) => unknown)(...args);
      };
      return Reflect.get(inner, key);
    },
  });
  const proxy = new Proxy(target, {
    get(inner, key) {
      if (key === "prepare") return (sql: string) => wrap(inner.prepare(sql));
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        calls += 1; inBatch = true;
        try { return await inner.batch(statements); } finally { inBatch = false; }
      };
      return Reflect.get(inner, key);
    },
  });
  return { db: proxy, calls: () => calls, reset: () => { calls = 0; } };
}

/** 形狀像那份表：每個專案有任務、里程碑、歷程事件、進度紀錄。 */
function bigPayload(projects: number, perKind: number) {
  return {
    projects: Array.from({ length: projects }, (_, p) => ({
      name: `QA 專案 ${p + 1}`, group: "QA組",
      tasks: Array.from({ length: perKind }, (_, i) => ({ title: `任務 ${i + 1}`, stage: i % 2 ? "進行中" : "完成", done: i % 2 === 0, due_date: "2026-10-01" })),
      milestones: Array.from({ length: perKind }, (_, i) => ({ title: `里程碑 ${i + 1}`, due_date: `2026-0${(i % 9) + 1}-15`, done: true })),
      events: Array.from({ length: perKind }, (_, i) => ({ title: `會議 ${i + 1}`, due_date: `2026-0${(i % 9) + 1}-10` })),
      progress_updates: Array.from({ length: perKind }, (_, i) => ({ date: `2026-0${(i % 9) + 1}-${String(i + 1).padStart(2, "0")}`, content: `第 ${i + 1} 週進度` })),
    })),
  };
}

const row = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
const all = async <T>(sql: string, ...params: unknown[]) => (await db.prepare(sql).bind(...params).all<T>()).results;

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)").bind(qa.id, qa.email, qa.name, "x", "member", "grp_qa").run();
  for (const [id, name, stages] of QA_TEMPLATES) {
    await db.prepare("INSERT INTO stage_templates (id,name,group_id,stages_json) VALUES (?,?,?,?)").bind(id, name, "grp_qa", JSON.stringify(stages)).run();
  }
});

describe("新專案的看板欄位", () => {
  const templates = [
    ...QA_TEMPLATES.map(([, name, stages]) => ({ name, group_id: "grp_qa", stages_json: JSON.stringify(stages) })),
    { name: "BD 查驗登記流程", group_id: "grp_bd", stages_json: JSON.stringify(["準備文件", "送件", "審查中"]) },
    { name: "一般專案", group_id: null, stages_json: JSON.stringify(["待辦", "進行中", "完成"]) },
  ];
  const qaGroup = { id: "grp_qa", type: "qa" };

  it("表上寫的是「進行中」「完成」時用一般專案，不是依名稱排第一的 CAPA", () => {
    expect(chooseStageTemplate(templates, qaGroup, ["進行中", "完成", "進行中"])?.name).toBe("一般專案");
  });

  it("組別有好幾套範本、表上又沒寫階段時，用一般專案", () => {
    expect(chooseStageTemplate(templates, qaGroup, [])?.name).toBe("一般專案");
  });

  it("表上的階段對得到哪一套，就用哪一套", () => {
    expect(chooseStageTemplate(templates, qaGroup, ["開立", "根因調查"])?.name).toBe("CAPA 矯正預防措施");
    expect(chooseStageTemplate(templates, qaGroup, ["稽核計畫", "結案"])?.name).toBe("內部稽核（自我查核）");
  });

  it("組別只有一套範本時沿用它", () => {
    expect(chooseStageTemplate(templates, { id: "grp_bd", type: "bd" }, [])?.name).toBe("BD 查驗登記流程");
    expect(chooseStageTemplate(templates, { id: "grp_bd", type: "bd" }, ["沒有這一欄"])?.name).toBe("BD 查驗登記流程");
  });

  it("實際匯入時，QA 組的新專案看板是 待辦／進行中／完成，沒有多接一串 CAPA 欄位", async () => {
    await runImport(db, qa, { projects: [{ name: "GMP 自我查核", group: "QA組", tasks: [{ title: "盤點", stage: "進行中" }, { title: "送簽", stage: "完成", done: true }] }] }, { mode: "member" });
    const stages = await all<{ name: string }>("SELECT s.name FROM stages s JOIN projects p ON p.id=s.project_id WHERE p.name='GMP 自我查核' ORDER BY s.position");
    expect(stages.map((stage) => stage.name)).toEqual(["待辦", "進行中", "完成"]);
  });
});

describe("一次請求呼叫資料庫的次數", () => {
  it("12 個新專案、每個 40 列：預演只查固定幾次，實際寫入一個專案一批", async () => {
    const counter = counting(db);
    const payload = bigPayload(12, 10);
    const preview = await runImport(counter.db, qa, payload, { mode: "member", dryRun: true });
    expect(preview.tasks.created).toBe(120);
    expect(counter.calls()).toBeLessThanOrEqual(6);

    counter.reset();
    const stats = await runImport(counter.db, qa, payload, { mode: "member" });
    expect(stats).toMatchObject({ projects: { created: 12 }, tasks: { created: 120 }, milestones: { created: 120 }, events: { created: 120 }, progress_updates: { created: 120 } });
    // 以前是每一列一次、再加查重複與排序：這份資料要一千多次。
    expect(counter.calls()).toBeLessThanOrEqual(12 * 6);
    expect(await row("SELECT COUNT(*) AS n FROM tasks")).toEqual({ n: 120 });
  });

  it("併入既有專案時，已經有的略過，新的接在原有項目後面排序", async () => {
    await runImport(db, qa, bigPayload(1, 3), { mode: "member" });
    const stats = await runImport(db, qa, bigPayload(1, 6), { mode: "member" });
    expect(stats.tasks).toEqual({ created: 3, skipped: 3 });
    const positions = await all<{ title: string; position: number }>("SELECT t.title, t.position FROM tasks t JOIN stages s ON s.id=t.stage_id WHERE s.name='完成' ORDER BY t.position");
    expect(positions.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(positions.map((item) => item.title)).toEqual(["任務 1", "任務 3", "任務 5"]);
  });
});

describe("寫入", () => {
  it("同一份表裡重複的列只寫一次，預演算出來的數字和實際寫入一致", async () => {
    const payload = { projects: [{ name: "重複列", group: "QA組",
      tasks: [{ title: "送簽" }, { title: "送簽" }],
      events: [{ title: "開會", due_date: "2026-09-01" }, { title: "開會", due_date: "2026-09-01" }],
      progress_updates: [{ date: "2026-09-01", content: "同一句話" }, { date: "2026-09-01", content: "同一句話" }] }] };
    const preview = await runImport(db, qa, payload, { mode: "member", dryRun: true });
    const stats = await runImport(db, qa, payload, { mode: "member" });
    for (const result of [preview, stats]) {
      expect(result.tasks).toEqual({ created: 1, skipped: 1 });
      expect(result.events).toEqual({ created: 1, skipped: 1 });
      expect(result.progress_updates).toEqual({ created: 1, skipped: 1 });
    }
    expect(await row("SELECT COUNT(*) AS n FROM tasks")).toEqual({ n: 1 });
  });

  it("新專案裡項目的排序位置從 0 依序排下去", async () => {
    await runImport(db, qa, { projects: [{ name: "排序", group: "QA組", tasks: [{ title: "a" }, { title: "b" }, { title: "c" }], milestones: [{ title: "m1", due_date: "2026-10-01" }], events: [{ title: "e1", due_date: "2026-09-01" }] }] }, { mode: "member" });
    expect((await all<{ position: number }>("SELECT position FROM tasks ORDER BY position")).map((item) => item.position)).toEqual([0, 1, 2]);
    expect((await all<{ position: number }>("SELECT position FROM milestones ORDER BY position")).map((item) => item.position)).toEqual([0, 1]);
  });

  it("一個專案寫到一半出錯，那個專案什麼都不留；前面做完的專案照常寫入", async () => {
    // 正常流程會先預演擋下；這裡直接跑，確認即使漏了預演也不會留下半個專案。
    const payload = { projects: [
      { name: "好的專案", group: "QA組", tasks: [{ title: "a" }] },
      { name: "壞的專案", group: "QA組", tasks: [{ title: "ok" }, { title: "日期顛倒", start_date: "2026-10-02", due_date: "2026-10-01" }] },
    ] };
    await expect(runImport(db, qa, payload, { mode: "member" })).rejects.toBeInstanceOf(ImportValidationError);
    expect(await all("SELECT name FROM projects ORDER BY name")).toEqual([{ name: "好的專案" }]);
    expect(await row("SELECT COUNT(*) AS n FROM tasks")).toEqual({ n: 1 });
  });

  it("匯入後自動進度依已完成的任務重算", async () => {
    await runImport(db, qa, { projects: [{ name: "進度", group: "QA組", tasks: [{ title: "a", done: true }, { title: "b" }] }] }, { mode: "member" });
    expect(await row("SELECT progress FROM projects WHERE name='進度'")).toEqual({ progress: 50 });
  });
});

describe("名稱很像既有專案時提醒", () => {
  beforeEach(async () => {
    await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,external_key) VALUES ('p_qa','QA：GDP/GMP','grp_qa','elvis','group','active','qa-okr-r6')").run();
  });

  it("「GDP/GMP」會建成新專案，但提醒系統上已經有「QA：GDP/GMP」", async () => {
    const stats = await runImport(db, qa, { projects: [{ name: "GDP/GMP", group: "QA組" }] }, { mode: "member", dryRun: true });
    expect(stats.projects.created).toBe(1);
    expect(stats.warnings).toEqual(["「GDP/GMP」會建立成新專案，但系統上已經有「QA：GDP/GMP」；如果是同一個專案，請把名稱改成一樣"]);
  });

  it("對到既有專案、或名稱差很多時不提醒", async () => {
    const stats = await runImport(db, qa, { projects: [{ name: "QA:GDP/GMP", tasks: [{ title: "x" }] }, { name: "ESG 環境、社會與公司治理", group: "QA組" }] }, { mode: "member", dryRun: true });
    expect(stats.projects).toEqual({ created: 1, updated: 1 });
    expect(stats.warnings).toEqual([]);
  });

  it("提示只從看得到的專案裡找，不會說出別人私人專案的名稱", async () => {
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES ('other','o@example.com','o','x','member','grp_bd')").run();
    await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status) VALUES ('p_secret','機密併購案','grp_bd','other','private','active')").run();
    const stats = await runImport(db, qa, { projects: [{ name: "機密併購", group: "QA組" }] }, { mode: "member", dryRun: true });
    expect(stats.warnings.join()).not.toContain("機密併購案");
  });
});

describe("專案背景", () => {
  it("新專案寫進背景；既有專案有填才改，沒填不動", async () => {
    await runImport(db, qa, { projects: [{ name: "代餐包", group: "QA組", description: "# 背景\n取代味噌湯米粉" }] }, { mode: "member" });
    expect(await row("SELECT description FROM projects WHERE name='代餐包'")).toEqual({ description: "# 背景\n取代味噌湯米粉" });
    await runImport(db, qa, { projects: [{ name: "代餐包", tasks: [{ title: "打樣" }] }] }, { mode: "member" });
    expect(await row("SELECT description FROM projects WHERE name='代餐包'")).toEqual({ description: "# 背景\n取代味噌湯米粉" });
    await runImport(db, qa, { projects: [{ name: "代餐包", description: "改過的背景" }] }, { mode: "member" });
    expect(await row("SELECT description FROM projects WHERE name='代餐包'")).toEqual({ description: "改過的背景" });
  });

  it("背景超過上限時在預演就擋下", async () => {
    await expect(runImport(db, qa, { projects: [{ name: "太長", group: "QA組", description: "字".repeat(10_001) }] }, { mode: "member", dryRun: true }))
      .rejects.toThrow("「太長」的專案背景超過 10,000 字");
  });
});
