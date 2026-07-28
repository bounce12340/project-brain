import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";
import { resourcesRoutes } from "../worker/routes/resources";
import type { AppContext, AuthUser } from "../worker/types";

const actor: AuthUser = {
  id: "owner-demo",
  role: "member",
  group_id: "group-demo",
  email: "owner@demo.local",
  name: "Demo Owner",
  group_name: "Demo",
  group_type: "general",
  must_change_password: 0,
  email_notifications: 0,
  onboarding_done: 1,
  approval_status: "approved",
};

function milestoneDb() {
  const milestones: Array<{ title: string; due_date: string | null }> = [];
  const db = {
    prepare(query: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first(column?: string) {
          if (query.includes("SELECT id, owner_id, group_id, visibility FROM projects")) {
            return { id: "project-demo", owner_id: actor.id, group_id: actor.group_id, visibility: "private" };
          }
          if (query.includes("SELECT id FROM milestones WHERE project_id=")) {
            const title = String(statement.values[1]);
            const dueDate = statement.values[2] === null ? null : String(statement.values[2]);
            return milestones.find((item) => item.title === title && item.due_date === dueDate)?.title
              ? { id: "existing" }
              : null;
          }
          if (query.includes("MAX(position)")) return column === "value" ? milestones.length : { value: milestones.length };
          if (query.includes("SELECT progress,progress_mode FROM projects")) return { progress: 0, progress_mode: "manual" };
          return null;
        },
        async all() {
          if (query.includes("FROM project_members")) return { results: [], success: true, meta: {} };
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (query.startsWith("INSERT INTO milestones")) {
            milestones.push({
              title: String(statement.values[2]),
              due_date: statement.values[3] === null ? null : String(statement.values[3]),
            });
          }
          return { success: true, meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, milestones };
}

async function postMilestone(db: D1Database, body: { title: string; due_date?: string }) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("user", actor);
    await next();
  });
  app.route("/", resourcesRoutes);
  return await app.request("/projects/project-demo/milestones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: db } as Env);
}

describe("SPEC-V12-2 milestone duplicate guard", () => {
  it.each([
    ["相同日期", { title: "收到 CTD", due_date: "2026-12-01" }],
    ["due_date NULL", { title: "收到 CTD" }],
  ])("%s returns the documented 409 response", async (_label, body) => {
    const { db, milestones } = milestoneDb();
    expect((await postMilestone(db, body)).status).toBe(201);
    const duplicate = await postMilestone(db, body);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "相同里程碑已存在" });
    expect(milestones).toHaveLength(1);
  });
});

describe("SPEC-V12-2 quick-create UI contracts", () => {
  it("keeps zh/en keys in parity and maps the duplicate response", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(zh["error.duplicateMilestone"]).toBe("相同里程碑已存在。");
    expect(en["error.duplicateMilestone"]).toBe("An identical milestone already exists.");
  });

  it.each([
    ["milestone, enrollment, and fee", "../src/pages/ProjectDetailPage.tsx", ["milestoneSubmitting", "enrollmentSubmitting", "feeSubmitting"]],
    ["task and stage", "../src/components/Kanban.tsx", ["taskSubmitting", "stageSubmitting"]],
    ["KR", "../src/components/OkrPanel.tsx", ["krSubmitting"]],
    ["todo", "../src/pages/TodosPage.tsx", ["todoSubmitting"]],
    ["CCR and license", "../src/components/QaPanel.tsx", ["ccrSubmitting", "licenseSubmitting"]],
  ])("%s forms expose disabled processing states", (_label, path, submittingStates) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain('"common.processing"');
    for (const state of submittingStates) expect(source).toContain(`disabled={${state}}`);
  });
});
