import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGE_COLORS, STAGE_ROLE_BY_NAME, stageColorFor } from "../worker/services/stage-colors";

const migration = readFileSync(new URL("../migrations/0015_stage_colors.sql", import.meta.url), "utf8");
const projects = readFileSync(new URL("../worker/routes/projects.ts", import.meta.url), "utf8");
const importData = readFileSync(new URL("../worker/services/import-data.ts", import.meta.url), "utf8");

describe("stage colour palette", () => {
  it("is the five validated hues", () => {
    expect(Object.values(STAGE_COLORS)).toEqual(["#0284c7", "#d97706", "#7c3aed", "#e11d48", "#15803d"]);
  });

  it("never falls back to the indistinguishable default indigo", () => {
    expect(Object.values(STAGE_COLORS)).not.toContain("#6366f1");
    expect(stageColorFor("完全沒看過的自訂階段")).not.toBe("#6366f1");
  });

  it("maps a stage name to its workflow meaning", () => {
    expect(stageColorFor("待辦")).toBe(STAGE_COLORS.notStarted);
    expect(stageColorFor("進行中")).toBe(STAGE_COLORS.active);
    expect(stageColorFor("審查中")).toBe(STAGE_COLORS.waiting);
    expect(stageColorFor("補件")).toBe(STAGE_COLORS.attention);
    expect(stageColorFor("完成")).toBe(STAGE_COLORS.done);
  });

  it("treats an unknown stage as not started, and tolerates padding", () => {
    expect(stageColorFor("客戶驗收")).toBe(STAGE_COLORS.notStarted);
    expect(stageColorFor("  進行中  ")).toBe(STAGE_COLORS.active);
  });

  it("covers every stage name observed in the live database", () => {
    const live = [
      "待辦", "啟動準備", "準備文件", "開立",
      "進行中", "執行中", "收案中", "根因調查", "措施擬定",
      "送件", "審查中", "IRB 送審", "效期確認",
      "補件", "收到補件並進行回覆",
      "完成", "結案", "核准領證", "報告",
    ];

    expect(live.every((name) => name in STAGE_ROLE_BY_NAME)).toBe(true);
    expect(Object.keys(STAGE_ROLE_BY_NAME).sort()).toEqual([...live].sort());
  });
});

describe("migration 0015", () => {
  it("assigns exactly the palette hues and nothing else", () => {
    const used = [...migration.matchAll(/color = '(#[0-9a-f]{6})'/g)].map((m) => m[1]);

    expect(new Set(used)).toEqual(new Set(Object.values(STAGE_COLORS)));
  });

  it("agrees with the runtime mapping for every name it touches", () => {
    for (const [, colour, list] of migration.matchAll(/color = '(#[0-9a-f]{6})' WHERE name IN \(([^)]*)\)/g)) {
      for (const raw of list.split(",")) {
        const name = raw.trim().replace(/^'|'$/g, "");
        expect(stageColorFor(name), name).toBe(colour);
      }
    }
  });

  it("matches on name only, leaving ids and ordering alone", () => {
    // 只看實際的 SQL；註解裡本來就會提到 INSERT 之類的字眼。
    const sql = migration.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

    expect(sql.trim()).not.toBe("");
    expect(sql).not.toMatch(/\bposition\s*=/);
    expect(sql).not.toMatch(/\bid\s*=/);
    expect(sql).not.toMatch(/DELETE|DROP|INSERT/i);
    // 每一條都必須是依名稱比對的 UPDATE
    const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(5);
    expect(statements.every((s) => /^UPDATE stages SET color = '#[0-9a-f]{6}' WHERE name IN \(/.test(s))).toBe(true);
  });
});

describe("stage creation paths", () => {
  it("writes a colour when a project is created from a template", () => {
    expect(projects).toContain("INSERT INTO stages (id, project_id, name, color, position)");
    expect(projects).toContain("stageColorFor(stageName)");
  });

  it("writes a colour on both import paths", () => {
    const inserts = [...importData.matchAll(/INSERT INTO stages \([^)]*\)/g)].map((m) => m[0]);

    expect(inserts).toHaveLength(2);
    expect(inserts.every((sql) => sql.includes("color"))).toBe(true);
    expect([...importData.matchAll(/stageColorFor\(/g)]).toHaveLength(2);
  });
});
