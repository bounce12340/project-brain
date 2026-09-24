import { beforeEach, describe, expect, it } from "vitest";
import { runDailyReminders } from "../worker/services/cron";
import { taipeiDate } from "../worker/services/time";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 真的跑一次每日提醒，看誰收到什麼。
 *
 * 起因：「RA：Apply the PMF for Pathone」勾完最後一項後進度是 100%，狀態卻還掛在
 * 「進行中」，於是超過 21 天沒動靜就每天被催「專案停滯」，一次發給整組三個人。
 * 自動進度模式下勾完最後一項就是 100%，沒有人會記得再去把狀態改成已完成。
 */

let db: D1Database;
const env = () => ({ DB: db, APP_BASE_URL: "https://example.test" }) as unknown as Env;

const shift = (days: number) => {
  const value = new Date(`${taipeiDate()}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const longAgo = `${shift(-30)} 04:30:22`;

async function project(id: string, fields: { status?: string; progress?: number; last_activity_at?: string } = {}) {
  await db.prepare(`INSERT INTO projects (id,name,group_id,owner_id,status,progress,last_activity_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, `專案 ${id}`, "grp_general", "usr_admin", fields.status ?? "active", fields.progress ?? 40, fields.last_activity_at ?? longAgo).run();
}
async function milestone(projectId: string, dueDate: string, done = 0) {
  await db.prepare("INSERT INTO milestones (id,project_id,title,due_date,done,kind) VALUES (?,?,?,?,?,'milestone')")
    .bind(`ms_${projectId}_${dueDate}`, projectId, `里程碑 ${projectId}`, dueDate, done).run();
}
async function received() {
  const rows = await db.prepare("SELECT title, body FROM notifications").all<{ title: string; body: string }>();
  return rows.results;
}
const about = <T extends { body: string }>(rows: T[], id: string) => rows.filter((row) => row.body.includes(`專案 ${id}`));

beforeEach(async () => {
  ({ db } = createTestD1());
  // 種子資料裡的示範專案也會產生提醒，清掉才看得出每個案例自己的結果。
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("DELETE FROM todos").run();
});

describe("專案停滯提醒", () => {
  it("進度 100% 的專案不再催，即使狀態還是進行中", async () => {
    await project("pmf", { progress: 100 });
    await runDailyReminders(env());
    expect(about(await received(), "pmf")).toEqual([]);
  });

  it("還沒做完的停滯專案照樣提醒", async () => {
    await project("slow", { progress: 40 });
    await runDailyReminders(env());
    const titles = about(await received(), "slow").map((row) => row.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(new Set(titles)).toEqual(new Set(["專案停滯"]));
  });

  it("最近有動靜的專案不提醒", async () => {
    await project("fresh", { progress: 40, last_activity_at: `${shift(-2)} 09:00:00` });
    await runDailyReminders(env());
    expect(about(await received(), "fresh")).toEqual([]);
  });
});

describe("里程碑到期提醒", () => {
  it("進度 100% 的專案不催逾期里程碑", async () => {
    // 手動進度模式可以直接拉到 100%，這時留著沒勾的里程碑不該繼續每天響。
    await project("full", { progress: 100, last_activity_at: `${shift(-1)} 09:00:00` });
    await milestone("full", shift(-5));
    await runDailyReminders(env());
    expect(about(await received(), "full")).toEqual([]);
  });

  it("狀態已完成的專案不催逾期里程碑", async () => {
    // 先前只排除「已歸檔」，所以已完成但還沒被自動歸檔的那 14 天仍會被催。
    await project("closed", { status: "done", progress: 80, last_activity_at: `${shift(-1)} 09:00:00` });
    await milestone("closed", shift(-5));
    await runDailyReminders(env());
    expect(about(await received(), "closed")).toEqual([]);
  });

  it("進行中且未完成的專案照樣提醒逾期與即將到期", async () => {
    await project("live", { progress: 60, last_activity_at: `${shift(-1)} 09:00:00` });
    await milestone("live", shift(-5));
    await milestone("live", shift(2));
    await runDailyReminders(env());
    const titles = about(await received(), "live").map((row) => row.title);
    expect(titles).toContain("里程碑已逾期");
    expect(titles).toContain("里程碑即將到期");
  });

  it("暫停中的專案維持原本行為，仍提醒里程碑", async () => {
    await project("paused", { status: "paused", progress: 60, last_activity_at: `${shift(-1)} 09:00:00` });
    await milestone("paused", shift(-5));
    await runDailyReminders(env());
    expect(about(await received(), "paused").map((row) => row.title)).toContain("里程碑已逾期");
  });
});

describe("與專案進度無關的提醒不受影響", () => {
  it("證照效期到了一樣通知，即使專案進度 100%", async () => {
    // 證照是否過期與專案做完沒有關係；過期了照樣要換證。
    await project("lic", { progress: 100, last_activity_at: `${shift(-1)} 09:00:00` });
    await db.prepare("INSERT INTO licenses (id,project_id,name,subject,expires_at,created_by) VALUES (?,?,?,?,?,?)")
      .bind("lic1", "lic", "藥商許可執照", "Salagen", shift(30), "usr_admin").run();
    await runDailyReminders(env());
    expect((await received()).map((row) => row.title)).toContain("證照效期剩餘 30 天");
  });
});
