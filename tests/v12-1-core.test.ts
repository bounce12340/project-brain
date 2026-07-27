import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { resourcesRoutes } from "../worker/routes/resources";
import { canEditProgressUpdate } from "../worker/services/permissions";
import { progressAuditExcerpt } from "../worker/services/progress-updates";
import type { AppContext, AuthUser, ProjectAccess, Role } from "../worker/types";

function user(id: string, role: Role = "member"): AuthUser {
  return {
    id,
    role,
    group_id: "group-demo",
    email: `${id}@demo.local`,
    name: id,
    group_name: "Demo",
    group_type: "general",
    must_change_password: 0,
    email_notifications: 0,
    onboarding_done: 1,
    approval_status: "approved",
  };
}

const project: ProjectAccess = {
  id: "project-demo",
  owner_id: "owner",
  group_id: "group-demo",
  visibility: "private",
  member_ids: ["author", "other", "intern-author", "intern-other"],
};

describe("SPEC-V12-1 進度修改權限矩陣", () => {
  it.each([
    ["作者", user("author"), "author", true],
    ["owner", user("owner"), "author", true],
    ["admin", user("admin", "admin"), "author", true],
    ["同組他人", user("other"), "author", false],
    ["intern 作者", user("intern-author", "intern"), "intern-author", true],
    ["intern 修改他人", user("intern-other", "intern"), "author", false],
  ] as const)("%s", (_label, actor, authorId, expected) => {
    expect(canEditProgressUpdate(actor, project, authorId)).toBe(expected);
  });
});

interface ProgressRow {
  id: string;
  project_id: string;
  author_id: string;
  content: string;
  progress_snapshot: number;
  edited_at: string | null;
  edited_by: string | null;
}

function routeDb(content = "✔ 完成任務「Demo」進度 50%") {
  const state: {
    row: ProgressRow | null;
    audit: Array<{ action: string; entityType: string; entityId: string; summary: string }>;
    projectTouched: boolean;
  } = {
    row: {
      id: "update-demo",
      project_id: project.id,
      author_id: "author",
      content,
      progress_snapshot: 42,
      edited_at: null,
      edited_by: null,
    },
    audit: [],
    projectTouched: false,
  };

  const db = {
    prepare(query: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first(column?: string) {
          if (query.includes("FROM progress_updates")) return state.row;
          if (query.includes("SELECT id, owner_id, group_id, visibility FROM projects")) {
            return { id: project.id, owner_id: project.owner_id, group_id: project.group_id, visibility: project.visibility };
          }
          if (column === "project_id") return state.row?.project_id ?? null;
          return null;
        },
        async all() {
          if (query.includes("FROM project_members")) {
            return { results: project.member_ids.map((user_id) => ({ user_id })), success: true, meta: {} };
          }
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (query.startsWith("UPDATE progress_updates SET content=") && state.row) {
            state.row.content = String(statement.values[0]);
            state.row.edited_at = String(statement.values[1]);
            state.row.edited_by = String(statement.values[2]);
          } else if (query.startsWith("UPDATE projects SET last_activity_at")) {
            state.projectTouched = true;
          } else if (query.startsWith("INSERT INTO audit_log")) {
            state.audit.push({
              action: String(statement.values[2]),
              entityType: String(statement.values[3]),
              entityId: String(statement.values[4]),
              summary: String(statement.values[5]),
            });
          } else if (query.startsWith("DELETE FROM progress_updates")) {
            state.row = null;
          }
          return { success: true, meta: {} };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return await Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return { db, state };
}

async function routeRequest(actor: AuthUser, method: "PATCH" | "DELETE", body?: Record<string, unknown>, content?: string) {
  const fixture = routeDb(content);
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("user", actor);
    await next();
  });
  app.route("/", resourcesRoutes);
  const response = await app.request("/progress-updates/update-demo", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, { DB: fixture.db } as Env);
  return { response, state: fixture.state };
}

describe("SPEC-V12-1 進度修改 API", () => {
  it("作者編輯會保留 snapshot、寫 edited 欄位、touch project 與 audit", async () => {
    const { response, state } = await routeRequest(user("author"), "PATCH", { content: "修正後內容" });
    expect(response.status).toBe(200);
    expect(state.row).toMatchObject({
      content: "修正後內容",
      progress_snapshot: 42,
      edited_by: "author",
    });
    expect(state.row?.edited_at).toBeTruthy();
    expect(state.projectTouched).toBe(true);
    expect(state.audit).toEqual([
      expect.objectContaining({ action: "progress_edited", entityType: "progress_update", entityId: "update-demo" }),
    ]);
  });

  it("同組他人編輯回 403 且不變更資料", async () => {
    const { response, state } = await routeRequest(user("other"), "PATCH", { content: "不應寫入" });
    expect(response.status).toBe(403);
    expect(state.row).toMatchObject({ content: "✔ 完成任務「Demo」進度 50%", edited_at: null, edited_by: null });
    expect(state.audit).toEqual([]);
  });

  it("owner 可刪除 auto 產生紀錄，且 progress_deleted 摘要保留原文", async () => {
    const autoContent = `✔ 完成任務「Demo」${"稽".repeat(50)}`;
    const { response, state } = await routeRequest(user("owner"), "DELETE", undefined, autoContent);
    expect(response.status).toBe(200);
    expect(state.row).toBeNull();
    expect(state.audit).toEqual([
      expect.objectContaining({
        action: "progress_deleted",
        entityType: "progress_update",
        entityId: "update-demo",
        summary: expect.stringContaining(progressAuditExcerpt(autoContent)),
      }),
    ]);
  });

  it("稽核摘要以前 40 個 Unicode 字元截斷", () => {
    const content = `😀${"字".repeat(50)}`;
    expect(Array.from(progressAuditExcerpt(content))).toHaveLength(40);
  });
});
