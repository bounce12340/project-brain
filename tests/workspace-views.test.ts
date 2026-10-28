import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../worker/types";
import { internalApi } from "../worker/mcp/internal-api";
import { endOfWeek, groupMyTasks, myTaskGroup, type MyTaskItem } from "../src/my-tasks";
import { projectDashboard, weekStart } from "../src/project-dashboard";
import { healthBucket, portfolioCsv, sortPortfolio, type PortfolioRow } from "../src/portfolio";
import type { Milestone, Stage, Task } from "../src/types";
import { createTestD1 } from "./helpers/d1-sqlite";

/** 我的任務、專案儀表板、專案總覽。 */

describe("我的任務的分組", () => {
  const today = "2026-10-28"; // 星期三
  it("逾期／今天／本週（到週日）／之後／未排日期", () => {
    expect(endOfWeek(today)).toBe("2026-11-01");
    expect(endOfWeek("2026-11-01")).toBe("2026-11-01");
    expect(["2026-10-27", today, "2026-11-01", "2026-11-02", null].map((due_date) => myTaskGroup({ due_date }, today))).toEqual(["overdue", "today", "week", "later", "undated"]);
  });
  it("每組依到期日、專案、名稱排序", () => {
    const item = (id: string, due_date: string | null, project_name = "A"): MyTaskItem => ({ kind: "task", id, title: id, due_date, project_id: "p", project_name });
    const groups = groupMyTasks([item("b", "2026-12-01"), item("a", "2026-11-20"), item("z", "2026-10-01", "B"), item("y", "2026-10-01", "A")], today);
    expect(groups.later.map((row) => row.id)).toEqual(["a", "b"]);
    expect(groups.overdue.map((row) => row.id)).toEqual(["y", "z"]);
  });
});

describe("專案儀表板的數字", () => {
  const stages: Stage[] = [{ id: "s2", project_id: "p", name: "進行中", color: "", position: 1 }, { id: "s1", project_id: "p", name: "待辦", color: "", position: 0 }];
  const task = (id: string, fields: Partial<Task>): Task => ({ id, project_id: "p", stage_id: "s1", title: id, description: "", assignee_id: null, start_date: null, due_date: null, position: 0, done: 0, done_at: null, created_at: "", dependency_ids: [], comment_count: 0, attachment_count: 0, ...fields });
  const tasks = [
    task("late", { assignee_id: "u1", assignee_name: "Josh", due_date: "2026-10-20", subtask_total: 4, subtask_done: 2 }),
    task("soon", { assignee_id: "u1", assignee_name: "Josh", due_date: "2026-11-05", stage_id: "s2" }),
    task("far", { due_date: "2027-01-01" }),
    task("done", { done: 1, done_at: "2026-10-26T03:00:00.000Z", stage_id: "s2" }),
  ];
  const milestones: Milestone[] = [{ id: "m1", title: "送件", due_date: "2026-11-10", end_date: null, done: 0, position: 0, kind: "milestone" }, { id: "e1", title: "會議", due_date: "2026-10-01", end_date: null, done: 0, position: 0, kind: "event" }];
  it("計數、各欄、各人、每週完成、接下來到期", () => {
    const stats = projectDashboard(tasks, stages, milestones, "2026-10-28", "未指派");
    expect(stats).toMatchObject({ total: 4, done: 1, open: 3, overdue: 1, dueSoon: 1, unassigned: 1, subtaskTotal: 4, subtaskDone: 2 });
    expect(stats.byStage).toEqual([{ stage: "待辦", open: 2, done: 0 }, { stage: "進行中", open: 1, done: 1 }]);
    expect(stats.byAssignee).toEqual([{ name: "Josh", open: 2, overdue: 1 }, { name: "未指派", open: 1, overdue: 0 }]);
    expect(stats.completedByWeek).toHaveLength(8);
    expect(stats.completedByWeek.at(-1)).toEqual({ week: "2026-10-26", done: 1 });
    expect(stats.upcoming.map((item) => [item.kind, item.id, item.overdue])).toEqual([["task", "late", true], ["task", "soon", false], ["milestone", "m1", false]]);
    expect(stats.nextMilestone?.id).toBe("m1");
  });
  it("週一開始一週", () => {
    expect(weekStart("2026-10-28")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });
});

describe("專案總覽的排序與燈號分類", () => {
  const now = Date.parse("2026-10-28T00:00:00Z");
  const row = (id: string, fields: Partial<PortfolioRow>): PortfolioRow => ({ id, name: id, parent_id: null, group_id: "g", group_name: "G", status: "active", progress: 0, health: null, health_at: null, risk_level: null, owner_id: "o", owner_name: "O", product: "", start_date: null, target_date: null, last_activity_at: "", visibility: "all", task_total: 0, task_done: 0, task_overdue: 0, last_update_at: null, ...fields });
  const rows = [
    row("ok", { health: "on_track", health_at: "2026-10-27 00:00:00", target_date: "2026-12-01" }),
    row("bad", { health: "off_track", health_at: "2026-10-27 00:00:00", task_overdue: 3 }),
    row("old", { health: "on_track", health_at: "2026-09-01 00:00:00", target_date: "2026-11-01" }),
    row("none", {}),
  ];
  it("燈號：過期的算待更新，沒標示的算未標示", () => {
    expect(rows.map((item) => healthBucket(item, now))).toEqual(["on_track", "off_track", "stale", "none"]);
  });
  it("依燈號由壞到好、依目標日（沒填放最後）、依逾期數", () => {
    expect(sortPortfolio(rows, "health", false, now).map((item) => item.id)).toEqual(["bad", "old", "none", "ok"]);
    expect(sortPortfolio(rows, "target_date", false, now).map((item) => item.id)).toEqual(["old", "ok", "bad", "none"]);
    expect(sortPortfolio(rows, "overdue", false, now)[0].id).toBe("bad");
  });
  it("CSV 有 BOM、引號跳脫", () => {
    const csv = portfolioCsv([row('a"b', { task_total: 2, task_done: 1 })], ["專案"], { health: () => "未標示", status: () => "進行中" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"a""b"');
  });
});

describe("/api/my-tasks 與 /api/portfolio", () => {
  let db: D1Database;
  const person = (id: string, group: string) => ({ id, email: `${id}@example.com`, name: id, role: "member", group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
  const me = person("me", "grp_general");
  const other = person("other", "grp_bd");
  const as = (user: AuthUser) => internalApi({ DB: db, APP_BASE_URL: "http://127.0.0.1:8787" } as unknown as Env, undefined, user);
  beforeEach(async () => {
    ({ db } = createTestD1());
    await db.prepare("DELETE FROM projects").run();
    for (const user of [me, other]) await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
    await db.prepare(`INSERT INTO projects (id,name,group_id,owner_id,visibility,status,progress_mode,health,health_at) VALUES
      ('p1','我的專案','grp_general','me','group','active','auto','at_risk','2026-10-27 00:00:00'),
      ('p_done','已完成','grp_general','me','group','done','auto',NULL,NULL),
      ('p_secret','別人的機密','grp_bd','other','private','active','auto',NULL,NULL)`).run();
    await db.prepare("INSERT INTO stages (id,project_id,name,color,position) VALUES ('s1','p1','待辦','#888',0),('s2','p_done','待辦','#888',0),('s3','p_secret','待辦','#888',0)").run();
    await db.prepare(`INSERT INTO tasks (id,project_id,stage_id,title,assignee_id,due_date,done,position) VALUES
      ('t1','p1','s1','我的任務','me','2020-01-01',0,0),('t_done','p1','s1','做完的','me',NULL,1,1),('t_other','p1','s1','別人的','other',NULL,0,2),
      ('t_old','p_done','s2','結案專案的任務','me',NULL,0,0),('t_secret','p_secret','s3','機密','me',NULL,0,0)`).run();
    await db.prepare("INSERT INTO subtasks (id,task_id,title,assignee_id,done) VALUES ('x1','t_other','幫忙看 CPP','me',0),('x2','t_other','已勾','me',1)").run();
  });

  it("我的任務：只列進行中／暫停、看得到的專案裡指派給我、未完成的任務與子任務", async () => {
    const { items } = await as(me).get<{ items: Array<{ kind: string; id: string; project_name: string; task_title?: string }> }>("/api/my-tasks");
    expect(items.map((item) => [item.kind, item.id]).sort()).toEqual([["subtask", "x1"], ["task", "t1"]]);
    expect(items.find((item) => item.id === "x1")).toMatchObject({ task_title: "別人的", project_name: "我的專案" });
  });

  it("專案總覽：只列看得到的專案，帶燈號、任務數、逾期數與最近進度", async () => {
    await db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,created_at) VALUES ('u1','p1','me','x','2026-10-27 01:00:00')").run();
    const { projects } = await as(me).get<{ projects: PortfolioRow[] }>("/api/portfolio");
    expect(projects.map((item) => item.id).sort()).toEqual(["p1", "p_done"]);
    expect(projects.find((item) => item.id === "p1")).toMatchObject({ health: "at_risk", task_total: 3, task_done: 1, task_overdue: 1, last_update_at: "2026-10-27 01:00:00" });
    expect((await as(other).get<{ projects: PortfolioRow[] }>("/api/portfolio")).projects.map((item) => item.id)).toContain("p_secret");
  });
});
