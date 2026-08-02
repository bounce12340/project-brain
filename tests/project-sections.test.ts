import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PROJECT_SECTIONS, projectsRoutes, requestedSections } from "../worker/routes/projects";
import type { AppContext, AuthUser } from "../worker/types";

const admin: AuthUser = {
  id: "usr_admin", email: "admin@example.com", name: "Admin", role: "admin", group_id: "grp", group_name: "Group",
  group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1, approval_status: "approved",
};

const projectRow = {
  id: "prj_1", name: "案件", description: "", group_id: "grp", group_name: "Group", group_type: "general",
  owner_id: "usr_admin", owner_name: "Admin", visibility: "all", status: "active", progress: 10,
  progress_mode: "manual", goal_summary: "", start_date: null, target_date: null, auto_archive: 0,
  last_activity_at: "2026-08-02T00:00:00Z", risk_level: null, risk_summary: null, risk_suggestions: null,
  risk_updated_at: null, member_ids_csv: "usr_admin", updated_at: "2026-08-02T00:00:00Z",
};

/** 記錄實際送出的 SQL，用來斷言「沒被請求的區段完全不查資料庫」。 */
function app() {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
        async first() { return sql.includes("WHERE p.id = ?") ? projectRow : null; },
      };
    },
  };
  const instance = new Hono<AppContext>();
  instance.use("*", async (c, next) => { c.set("user", admin); c.env = { DB: db } as never; return next(); });
  instance.route("/api/projects", projectsRoutes);
  return { instance, statements };
}

const touched = (statements: string[], table: string) => statements.some((sql) => sql.includes(table));

describe("requestedSections", () => {
  it("returns every section when the caller does not ask, keeping old clients working", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect([...requestedSections(raw)].sort()).toEqual([...PROJECT_SECTIONS].sort());
    }
  });

  it("always includes core, whatever was asked for", () => {
    expect(requestedSections("updates").has("core")).toBe(true);
    expect(requestedSections("bd").has("core")).toBe(true);
  });

  it("keeps only known section names", () => {
    expect([...requestedSections("updates,nonsense,bd")].sort()).toEqual(["bd", "core", "updates"]);
    expect([...requestedSections("nonsense")]).toEqual(["core"]);
  });

  it("tolerates spacing", () => {
    expect([...requestedSections(" updates , bd ")].sort()).toEqual(["bd", "core", "updates"]);
  });
});

describe("GET /projects/:id section loading", () => {
  it("skips the optional tables entirely for a core-only request", async () => {
    const { instance, statements } = app();

    const body = await (await instance.request("/api/projects/prj_1?sections=core")).json() as Record<string, unknown>;

    expect(touched(statements, "progress_updates")).toBe(false);
    expect(touched(statements, "clinical_enrollments")).toBe(false);
    expect(touched(statements, "bd_cases")).toBe(false);
    expect(touched(statements, "bd_fees")).toBe(false);
    // core 仍然完整
    for (const key of ["project", "permissions", "members", "stages", "tasks", "milestones"]) expect(body).toHaveProperty(key);
    // 未載入的區段要「缺席」，而不是空陣列，前端才分得出載入中與真的沒資料
    for (const key of ["progress_updates", "enrollments", "bd_cases", "bd_events"]) expect(body).not.toHaveProperty(key);
  });

  it("queries only the section that was asked for", async () => {
    const { instance, statements } = app();

    const body = await (await instance.request("/api/projects/prj_1?sections=core,updates")).json() as Record<string, unknown>;

    expect(touched(statements, "progress_updates")).toBe(true);
    expect(touched(statements, "bd_cases")).toBe(false);
    expect(touched(statements, "clinical_enrollments")).toBe(false);
    expect(body).toHaveProperty("progress_updates");
    expect(body).not.toHaveProperty("bd_cases");
  });

  it("still returns everything when no sections are given", async () => {
    const { instance, statements } = app();

    const body = await (await instance.request("/api/projects/prj_1")).json() as Record<string, unknown>;

    for (const table of ["progress_updates", "clinical_enrollments", "bd_cases", "bd_case_events", "bd_fees"]) {
      expect(touched(statements, table)).toBe(true);
    }
    for (const key of ["progress_updates", "enrollments", "bd_cases", "bd_events", "bd_fees"]) expect(body).toHaveProperty(key);
  });

  it("does not read fees unless the bd section was requested", async () => {
    const { instance, statements } = app();

    await instance.request("/api/projects/prj_1?sections=core,updates");

    expect(touched(statements, "bd_fees")).toBe(false);
  });
});

describe("project detail page wiring", () => {
  const page = readFileSync(new URL("../src/pages/ProjectDetailPage.tsx", import.meta.url), "utf8");

  it("starts on core only and widens as tabs open", () => {
    expect(page).toContain('const tabSection: Record<string, string | undefined> = { updates: "updates", clinical: "clinical", bd: "bd" };');
    expect(page).toContain("if (need && !sections.includes(need)) void load([...sections, need]);");
    expect(page).toContain("`/projects/${id}?sections=${list.join(\",\")}`");
  });

  it("shows a loading state rather than an empty list for a section still in flight", () => {
    expect(page).toContain("if (!data.progress_updates) return <Loading />;");
    expect(page).toContain("if (!data.enrollments) return <Loading />;");
    expect(page).toContain("if (!bdCases || !bdEvents) return <Loading />;");
  });
});
