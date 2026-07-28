import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { aiRoutes } from "../worker/routes/reports";
import {
  buildProgressLinksPrompt,
  progressLinksFallback,
  sanitizeProgressLinks,
  type ProgressLinkTask,
} from "../worker/services/progress-links";
import type { AppContext, AuthUser } from "../worker/types";
import { en, zh } from "../src/i18n/translations";
import { progressLinkDrafts, readProgressLinksPreference } from "../src/progress-links";
import type { Stage, Task } from "../src/types";

const today = "2026-07-27";
const tasks: ProgressLinkTask[] = [
  { id: "task-stability", title: "安定性數據收集", stage_name: "進行中" },
  { id: "task-label", title: "標籤校稿", stage_name: "待處理" },
];
const stages = ["進行中", "待處理"];

function clean(value: unknown, content = "已完成安定性數據收集") {
  return sanitizeProgressLinks(value, tasks, stages, content, today);
}

describe("SPEC-V12 progress-links 清洗", () => {
  it("只保留傳入未完成任務白名單內的 task_id", () => {
    expect(clean({ complete: [
      { task_id: "task-stability", reason: "已完成安定性數據收集" },
      { task_id: "task-other-project", reason: "已完成其他任務" },
    ], create: [] }).complete).toEqual([{ task_id: "task-stability", reason: "已完成安定性數據收集" }]);
  });

  it("同一 task_id 最多保留一次", () => {
    expect(clean({ complete: [
      { task_id: "task-stability", reason: "已完成安定性數據收集" },
      { task_id: "task-stability", reason: "已完成資料收集" },
    ], create: [] }).complete).toHaveLength(1);
  });

  it("create 最多保留 5 筆", () => {
    const create = Array.from({ length: 8 }, (_, index) => ({ title: `新任務 ${index}` }));
    expect(clean({ complete: [], create }).create).toHaveLength(5);
  });

  it("create title 以 Unicode 字元截到 80 字", () => {
    const [item] = clean({ complete: [], create: [{ title: `😀${"字".repeat(100)}` }] }).create;
    expect(Array.from(item.title)).toHaveLength(80);
  });

  it.each(["not-a-date", "2026-02-30", "2026-07-27", "2026-07-01"])("非法、今日或過去日期 %s 會清空", (dueDate) => {
    expect(clean({ complete: [], create: [{ title: "補件", due_date: dueDate }] }).create[0]).toEqual({ title: "補件" });
  });

  it("合法未來日期與白名單階段會保留", () => {
    expect(clean({ complete: [], create: [{ title: "補件", stage_name: "待處理", due_date: "2026-07-28" }] }).create[0])
      .toEqual({ title: "補件", stage_name: "待處理", due_date: "2026-07-28" });
  });

  it("不存在的 stage_name 會清空", () => {
    expect(clean({ complete: [], create: [{ title: "補件", stage_name: "別的專案階段" }] }).create[0]).toEqual({ title: "補件" });
  });

  it("混合進度只完成有明確完成句的對應任務", () => {
    const result = clean({ complete: [
      { task_id: "task-stability", reason: "已完成安定性數據收集" },
      { task_id: "task-label", reason: "已完成標籤校稿" },
    ], create: [] }, "已完成安定性數據收集，下週進行標籤校稿");
    expect(result.complete.map((item) => item.task_id)).toEqual(["task-stability"]);
  });

  it("原文只有預計語氣時，即使模型誤稱已完成仍丟棄", () => {
    expect(clean({ complete: [{ task_id: "task-stability", reason: "已完成安定性數據收集" }], create: [] }, "預計下週完成安定性數據收集").complete).toEqual([]);
  });

  it("模型理由含將要或預計時不得列入 complete", () => {
    expect(clean({ complete: [{ task_id: "task-stability", reason: "預計下週已完成安定性數據收集" }], create: [] }).complete).toEqual([]);
  });

  it("原文明確完成且對應任務時，允許不重複完成字眼的簡短理由", () => {
    expect(clean({ complete: [{ task_id: "task-stability", reason: "進度已提供成果證據" }], create: [] }).complete)
      .toEqual([{ task_id: "task-stability", reason: "進度已提供成果證據" }]);
  });

  it("complete 理由限制為 30 字", () => {
    const reason = `已完成安定性數據收集${"，證據".repeat(20)}`;
    expect(Array.from(clean({ complete: [{ task_id: "task-stability", reason }], create: [] }).complete[0].reason)).toHaveLength(30);
  });

  it("prompt 明訂只有已完成、已送出、已取得可完成，未來語氣禁止", () => {
    const prompt = buildProgressLinksPrompt("zh");
    expect(prompt).toContain("completed, submitted/sent, or obtained/received");
    expect(prompt).toContain("MUST NEVER appear in complete");
    expect(prompt).toContain("預計");
    expect(prompt).toContain("下週");
  });

  it("fallback 固定回 HTTP 可用的空陣列 shape", () => {
    expect(progressLinksFallback()).toEqual({ complete: [], create: [], milestones: [], events: [], dates: [], fallback: true });
  });
});

function actor(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "actor",
    email: "actor@demo.local",
    name: "Demo Actor",
    role: "member",
    group_id: "group-other",
    group_name: "Other",
    group_type: "general",
    must_change_password: 0,
    email_notifications: 0,
    onboarding_done: 1,
    approval_status: "approved",
    ...overrides,
  };
}

function routeDb(): D1Database {
  return {
    prepare(query: string) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (query.includes("SELECT id, owner_id, group_id, visibility FROM projects")) {
            return { id: "project-demo", owner_id: "owner", group_id: "group-project", visibility: "all" };
          }
          return null;
        },
        async all() {
          if (query.includes("FROM project_members")) return { results: [], success: true, meta: {} };
          if (query.includes("FROM tasks t JOIN stages")) return { results: tasks, success: true, meta: {} };
          if (query.includes("SELECT name FROM stages")) return { results: stages.map((name) => ({ name })), success: true, meta: {} };
          return { results: [], success: true, meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

async function routeRequest(user: AuthUser, aiResponse?: string) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("user", user); await next(); });
  app.route("/ai", aiRoutes);
  const env = {
    DB: routeDb(),
    AI: { run: async () => {
      if (aiResponse) return { response: aiResponse };
      throw new Error("offline");
    } },
  } as unknown as Env;
  return app.request("/ai/progress-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: "project-demo", content: "已完成安定性數據收集" }),
  }, env);
}

describe("SPEC-V12 progress-links route", () => {
  it("無 canEditProgress 權限時回 403，且不呼叫 AI", async () => {
    const response = await routeRequest(actor());
    expect(response.status).toBe(403);
  });

  it("AI 失敗時回 200、fallback:true 與空陣列", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await routeRequest(actor({ id: "owner" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete: [], create: [], milestones: [], events: [], dates: [], fallback: true });
    consoleSpy.mockRestore();
  });

  it("成功回應含 milestones/dates，並清除歷史日期與未知 task_id", async () => {
    const response = await routeRequest(actor({ id: "owner" }), JSON.stringify({
      complete: [],
      create: [],
      milestones: [
        { title: "收到 X 文件", due_date: "2026-12-01" },
        { title: "歷史會議", due_date: "2025-12-09" },
      ],
      dates: [
        { task_id: "task-stability", due_date: "2026-12-31", reason: "收到文件後審查" },
        { task_id: "other-project", due_date: "2026-12-31", reason: "未知任務" },
      ],
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      complete: [],
      create: [],
      milestones: [{ title: "收到 X 文件", due_date: "2026-12-01" }],
      events: [],
      dates: [{ task_id: "task-stability", due_date: "2026-12-31", reason: "收到文件後審查" }],
      fallback: false,
    });
  });
});

describe("SPEC-V12 人工確認 UI 契約", () => {
  const uiStages = [
    { id: "stage-done", project_id: "project-demo", name: "完成", color: "", position: 2 },
    { id: "stage-doing", project_id: "project-demo", name: "進行中", color: "", position: 1 },
  ] as Stage[];
  const uiTasks = [
    { id: "task-stability", stage_id: "stage-doing", title: "安定性數據收集", done: 0 },
  ] as Task[];

  it("complete 與 create 建議全部預設不勾選，缺階段時選第一個有未完成任務的階段", () => {
    const drafts = progressLinkDrafts({
      complete: [{ task_id: "task-stability", reason: "已完成安定性數據收集" }],
      create: [{ title: "補件資料" }],
      milestones: [],
      events: [],
      dates: [],
      fallback: false,
    }, uiStages, uiTasks);
    expect([...drafts.complete, ...drafts.create].every((item) => item.selected === false)).toBe(true);
    expect(drafts.create[0].stage_id).toBe("stage-doing");
  });

  it("設定開關預設開，只有明確儲存 false 才關閉", () => {
    expect(readProgressLinksPreference({ getItem: () => null })).toBe(true);
    expect(readProgressLinksPreference({ getItem: () => "invalid" })).toBe(true);
    expect(readProgressLinksPreference({ getItem: () => "false" })).toBe(false);
  });

  it("個人設定以 AIUR_PROGRESS_LINKS 儲存開關，發布前先讀取偏好", () => {
    const profile = readFileSync(new URL("../src/pages/ProfilePage.tsx", import.meta.url), "utf8");
    const project = readFileSync(new URL("../src/pages/ProjectDetailPage.tsx", import.meta.url), "utf8");
    expect(profile).toContain("writeProgressLinksPreference(value)");
    expect(project).toContain("if (!readProgressLinksPreference()) return");
  });

  it("dialog 具 aria modal、Esc、逐項既有寫入端點與中英 key parity", () => {
    const dialog = readFileSync(new URL("../src/components/ProgressLinkDialog.tsx", import.meta.url), "utf8");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain("closeRef.current?.focus()");
    expect(dialog).toContain("previous?.focus()");
    expect(dialog).toContain("disabled={busy || selectedCount === 0}");
    expect(dialog).toContain("patchBody({ done: true })");
    expect(dialog).toContain("`/projects/${projectId}/tasks`");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
