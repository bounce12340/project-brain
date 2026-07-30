import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { projectRow, projectRows, projectsRoutes } from "../worker/routes/projects";
import type { AppContext, AuthUser } from "../worker/types";

const admin: AuthUser = {
  id: "usr_admin", email: "admin@example.com", name: "Admin", role: "admin", group_id: "grp", group_name: "Group",
  group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1, approval_status: "approved",
};

const row = (id: string, name: string, groupId = "grp") => ({
  id, name, description: "說明文字", group_id: groupId, group_name: "Group", group_type: "general",
  owner_id: "usr_admin", owner_name: "Admin", visibility: "all", status: "active", progress: 10,
  progress_mode: "manual", goal_summary: "目標摘要", start_date: null, target_date: null, auto_archive: 0,
  last_activity_at: "2026-07-30T00:00:00Z", risk_level: null, risk_summary: "風險摘要",
  risk_suggestions: '[{"note":"很長的 JSON 建議"}]', risk_updated_at: null, member_ids_csv: "usr_admin",
  updated_at: "2026-07-30T00:00:00Z",
});

/** 記錄每一條送進 D1 的 SQL 與繫結參數，用來斷言查詢形狀而不是猜測。 */
function recordingDb(rows: Array<ReturnType<typeof row>>) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const entry = { sql, bindings: [] as unknown[] };
      statements.push(entry);
      const single = /WHERE p\.id = \?/.test(sql);
      return {
        bind(...bindings: unknown[]) { entry.bindings = bindings; return this; },
        async all() { return { results: rows }; },
        async first() { return rows.find((item) => item.id === entry.bindings[0]) ?? (single ? null : rows[0]); },
      };
    },
  };
  return { db, statements };
}

function listApp(rows: Array<ReturnType<typeof row>>) {
  const { db, statements } = recordingDb(rows);
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("user", admin); c.env = { DB: db } as never; return next(); });
  app.route("/api/projects", projectsRoutes);
  return { app, statements };
}

describe("single project lookup", () => {
  it("filters by id in SQL instead of listing every project", async () => {
    const { db, statements } = recordingDb([row("prj_a", "甲案"), row("prj_b", "乙案")]);

    const found = await projectRow(db as never, "prj_b");

    expect(found?.id).toBe("prj_b");
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("WHERE p.id = ?");
    expect(statements[0].bindings).toEqual(["prj_b"]);
  });

  it("does not sort, because a single row needs no ORDER BY temp b-tree", async () => {
    const { db, statements } = recordingDb([row("prj_a", "甲案")]);

    await projectRow(db as never, "prj_a");

    expect(statements[0].sql).not.toContain("ORDER BY");
    expect(statements[0].sql).toContain("GROUP BY p.id");
  });

  it("still aggregates member ids so permission checks keep working", async () => {
    const { db } = recordingDb([row("prj_a", "甲案")]);

    const found = await projectRow(db as never, "prj_a");

    expect(found?.member_ids_csv).toBe("usr_admin");
  });

  it("keeps the list query sorted for the projects page", async () => {
    const { db, statements } = recordingDb([row("prj_a", "甲案")]);

    await projectRows(db as never);

    expect(statements[0].sql).toContain("ORDER BY p.updated_at DESC");
    expect(statements[0].sql).not.toContain("WHERE p.id = ?");
  });
});

describe("project list summary mode", () => {
  it("returns only the fields the switcher needs", async () => {
    const { app } = listApp([row("prj_a", "甲案"), row("prj_b", "乙案", "grp2")]);

    const response = await app.request("/api/projects?summary=1");
    const body = await response.json() as { projects: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.projects).toHaveLength(2);
    expect(Object.keys(body.projects[0]).sort()).toEqual(["group_id", "group_name", "id", "name", "status"]);
  });

  it("drops the payload the switcher never reads", async () => {
    const { app } = listApp([row("prj_a", "甲案")]);

    const body = await (await app.request("/api/projects?summary=1")).json() as { projects: Array<Record<string, unknown>> };

    for (const field of ["description", "goal_summary", "risk_summary", "risk_suggestions", "member_ids"]) {
      expect(body.projects[0]).not.toHaveProperty(field);
    }
  });

  it("leaves the default response shape untouched", async () => {
    const { app } = listApp([row("prj_a", "甲案")]);

    const body = await (await app.request("/api/projects")).json() as { projects: Array<Record<string, unknown>> };

    expect(body.projects[0]).toHaveProperty("description");
    expect(body.projects[0]).toHaveProperty("risk_suggestions");
    expect(body.projects[0].member_ids).toEqual(["usr_admin"]);
    expect(body.projects[0]).not.toHaveProperty("member_ids_csv");
  });
});
