import { describe, expect, it } from "vitest";
import { buildGlance, isNarrative, limitHistory, localDay, type GlanceSource } from "../src/project-glance";
import type { Milestone, ProgressUpdate, Task } from "../src/types";

const TODAY = "2026-09-24";
const stages = [
  { id: "s_todo", project_id: "p", name: "待辦", color: "#888", position: 0 },
  { id: "s_doing", project_id: "p", name: "進行中", color: "#3b82f6", position: 1 },
];
const task = (patch: Partial<Task>): Task => ({
  id: "t", project_id: "p", stage_id: "s_todo", title: "任務", description: "", assignee_id: null, start_date: null,
  due_date: null, position: 0, done: 0, done_at: null, created_at: "2026-08-01 00:00:00", dependency_ids: [],
  comment_count: 0, attachment_count: 0, ...patch,
});
const mark = (patch: Partial<Milestone & { done_at: string | null }>): Milestone & { done_at: string | null } => ({
  id: "m", title: "里程碑", due_date: null, end_date: null, done: 0, position: 0, kind: "milestone", done_at: null, ...patch,
});
const update = (patch: Partial<ProgressUpdate>): ProgressUpdate => ({
  id: "u", author_id: "usr", content: "", progress_snapshot: null, author_name: "管理者", is_support: 0,
  created_at: "2026-08-01 00:00:00", edited_at: null, edited_by: null, can_edit: true, ...patch,
});
const source = (patch: Partial<GlanceSource>): GlanceSource => ({
  project: { last_activity_at: "2026-09-21 07:57:19" }, stages, tasks: [], milestones: [], progress_updates: [], ...patch,
});
const flat = (glance: ReturnType<typeof buildGlance>) => glance.history.flatMap((month) => month.items);

describe("哪些進度紀錄算「有人寫的進度」", () => {
  it("系統自動寫的完成紀錄與進度數字變化都不算", () => {
    expect(isNarrative("✔ 完成任務「9/4 與健亞招開會議」（進度 56%）")).toBe(false);
    expect(isNarrative("✔ 完成里程碑「遞交賦形劑變更申請案」（進度 100%）")).toBe(false);
    expect(isNarrative("專案進度更新為 30%")).toBe(false);
    expect(isNarrative("   ")).toBe(false);
  });

  it("人寫的內容才算，即使裡面提到進度", () => {
    expect(isNarrative("• 8/31 進行中：收到TFDA發布的補件項目，共有6點")).toBe(true);
    expect(isNarrative("專案進度更新為 30%，另外 CDE 已回覆")).toBe(true);
  });
});

describe("目前進度取最新一則人寫的紀錄", () => {
  it("跳過後來的自動紀錄", () => {
    const glance = buildGlance(source({ progress_updates: [
      update({ id: "echo", content: "✔ 完成任務「延期補件」（進度 58%）", created_at: "2026-09-21 07:54:40" }),
      update({ id: "note", content: "• 8/31 進行中：收到TFDA發布的補件項目", created_at: "2026-08-31 01:15:17" }),
      update({ id: "old", content: "5/28 提交矯味劑變更", created_at: "2026-05-25T04:00:00.000Z" }),
    ] }), TODAY);
    expect(glance.latest?.id).toBe("note");
  });

  it("不依賴後端排序", () => {
    const glance = buildGlance(source({ progress_updates: [
      update({ id: "old", content: "舊的", created_at: "2026-05-25T04:00:00.000Z" }),
      update({ id: "new", content: "新的", created_at: "2026-08-31 01:15:17" }),
    ] }), TODAY);
    expect(glance.latest?.id).toBe("new");
  });

  it("只有自動紀錄時是 null，不拿自動紀錄充數", () => {
    const glance = buildGlance(source({ progress_updates: [update({ content: "✔ 完成任務「送件」（進度 50%）" })] }), TODAY);
    expect(glance.latest).toBeNull();
  });

  it("尚未載入進度紀錄時不會出錯", () => {
    expect(buildGlance(source({ progress_updates: undefined }), TODAY).latest).toBeNull();
  });
});

describe("接下來", () => {
  const glance = buildGlance(source({
    tasks: [
      task({ id: "later", title: "預計回覆補件公文", stage_id: "s_doing", due_date: "2026-11-27" }),
      task({ id: "undated", title: "沒排日期的事" }),
      task({ id: "overdue", title: "送件遞交", due_date: "2026-09-09", assignee_name: "Dennis" }),
      task({ id: "finished", title: "已完成的不列", done: 1, done_at: "2026-09-07T00:52:33.236Z" }),
    ],
    milestones: [
      mark({ id: "ms", title: "回覆補件缺失", due_date: "2026-10-28" }),
      mark({ id: "ev_future", title: "排定的會議", kind: "event", due_date: "2026-10-01" }),
      mark({ id: "ev_past", title: "已發生的會議", kind: "event", due_date: "2026-01-27" }),
    ],
  }), TODAY);

  it("未完成的任務、里程碑與未來的歷程事件依日期排，沒日期的放最後", () => {
    expect(glance.upcoming.map((item) => item.id)).toEqual(["overdue", "ev_future", "ms", "later", "undated"]);
  });

  it("算出距今天數，逾期為負", () => {
    const days = Object.fromEntries(glance.upcoming.map((item) => [item.id, item.days]));
    expect(days).toMatchObject({ overdue: -15, ev_future: 7, ms: 34, undated: null });
  });

  it("任務帶上所在階段與負責人", () => {
    expect(glance.upcoming.find((item) => item.id === "later")?.detail).toBe("進行中");
    expect(glance.upcoming.find((item) => item.id === "overdue")?.detail).toBe("待辦 · Dennis");
  });

  it("同一天的里程碑排在任務前面", () => {
    const same = buildGlance(source({
      tasks: [task({ id: "t", due_date: "2026-10-01" })],
      milestones: [mark({ id: "m", due_date: "2026-10-01" })],
    }), TODAY);
    expect(same.upcoming.map((item) => item.id)).toEqual(["m", "t"]);
  });

  it("有期間的里程碑以結束日為期限", () => {
    const ranged = buildGlance(source({ milestones: [mark({ id: "m", due_date: "2026-09-01", end_date: "2026-10-31" })] }), TODAY);
    expect(ranged.upcoming[0]).toMatchObject({ date: "2026-10-31", days: 37 });
  });
});

describe("歷程", () => {
  // 取自正式資料「RA：申請矯味劑變更來源」的形狀。
  const glance = buildGlance(source({
    tasks: [
      task({ id: "t_meeting", title: "9/4 與健亞招開會議", done: 1, done_at: "2026-09-07T00:52:33.236Z", due_date: "2026-09-04" }),
      task({ id: "t_extend", title: "已於9/21申請延期補件", done: 1, done_at: "2026-09-21T07:54:39.375Z" }),
    ],
    milestones: [
      mark({ id: "m_submit", title: "遞交賦形劑變更申請案", due_date: "2026-05-25", done: 1, done_at: "2026-07-28T09:06:11.000Z" }),
      mark({ id: "e_start", title: "啟動討論針對檸檬香料廠停產", kind: "event", due_date: "2025-11-14", done: 1 }),
    ],
    progress_updates: [
      update({ id: "u_echo", content: "✔ 完成任務「9/4 與健亞招開會議」（進度 56%）", created_at: "2026-09-07 00:52:34" }),
      update({ id: "u_ms_echo", content: "✔ 完成里程碑「遞交賦形劑變更申請案」（進度 100%）", created_at: "2026-07-28 09:06:11" }),
      update({ id: "u_pct", content: "專案進度更新為 30%", created_at: "2026-07-28 09:10:29" }),
      update({ id: "u_note", content: "• 8/31 進行中：收到TFDA發布的補件項目", created_at: "2026-08-31 01:15:17" }),
    ],
  }), TODAY);

  it("新的在上面，依月份分組", () => {
    expect(glance.history.map((month) => month.month)).toEqual(["2026-09", "2026-08", "2026-07", "2026-05", "2025-11"]);
    expect(flat(glance).map((item) => item.id)).toEqual(["t_extend", "t_meeting", "u_note", "u_pct", "m_submit", "e_start"]);
  });

  it("系統自動寫的完成紀錄不重複列出——任務與里程碑本身已經在裡面", () => {
    const ids = flat(glance).map((item) => item.id);
    expect(ids).not.toContain("u_echo");
    expect(ids).not.toContain("u_ms_echo");
    expect(glance.historyCount).toBe(6);
  });

  it("完成的任務不帶看板階段——勾完成不會把卡片移出「待辦」欄", () => {
    const done = buildGlance(source({ tasks: [task({ id: "d", stage_id: "s_todo", done: 1, done_at: "2026-09-21T07:54:39Z", assignee_name: "Dennis" })] }), TODAY);
    expect(flat(done)[0].detail).toBe("Dennis");
    const alone = buildGlance(source({ tasks: [task({ id: "d", stage_id: "s_todo", done: 1, done_at: "2026-09-21T07:54:39Z" })] }), TODAY);
    expect(flat(alone)[0].detail).toBeUndefined();
  });

  it("完成的任務以完成當天（台北時間）入列，不是期限", () => {
    expect(flat(glance).find((item) => item.id === "t_meeting")?.date).toBe("2026-09-07");
    // UTC 8/31 晚上 8 點是台北 9/1 清晨；直接截 UTC 字串前 10 碼會錯放到 8 月。
    const lateNight = buildGlance(source({ tasks: [task({ id: "n", done: 1, done_at: "2026-08-31T20:10:00.000Z" })] }), TODAY);
    expect(lateNight.history).toEqual([{ month: "2026-09", items: [expect.objectContaining({ id: "n", date: "2026-09-01" })] }]);
  });

  it("完成的里程碑以它自己的日期入列，不是事後勾選的那天", () => {
    // 5/25 遞交，7/28 才有人去勾。這件事是 5 月發生的。
    expect(flat(glance).find((item) => item.id === "m_submit")?.date).toBe("2026-05-25");
  });

  it("提早完成、日期還在未來的里程碑改用實際完成日", () => {
    const early = buildGlance(source({ milestones: [mark({ id: "m", due_date: "2026-12-31", done: 1, done_at: "2026-09-20T02:00:00Z" })] }), TODAY);
    expect(flat(early)[0]).toMatchObject({ id: "m", date: "2026-09-20" });
    expect(early.upcoming).toEqual([]);
  });

  it("進度紀錄分成人寫的與數字變化兩種", () => {
    const kinds = Object.fromEntries(flat(glance).map((item) => [item.id, item.kind]));
    expect(kinds).toMatchObject({ u_note: "note", u_pct: "progress", t_meeting: "task", m_submit: "milestone", e_start: "event" });
  });

  it("排不出日期的完成任務不硬塞進歷程", () => {
    const undated = buildGlance(source({ tasks: [task({ id: "x", done: 1, done_at: null, due_date: null })] }), TODAY);
    expect(undated.history).toEqual([]);
  });

  it("只顯示最近幾筆時保留月份分組", () => {
    const limited = limitHistory(glance.history, 3);
    expect(limited.map((month) => [month.month, month.items.map((item) => item.id)])).toEqual([
      ["2026-09", ["t_extend", "t_meeting"]], ["2026-08", ["u_note"]],
    ]);
    expect(limitHistory(glance.history, 0)).toEqual([]);
    expect(limitHistory(glance.history, 99).flatMap((month) => month.items)).toHaveLength(6);
  });
});

describe("台北日期", () => {
  it("UTC 晚上是台北隔天", () => {
    expect(localDay("2026-08-31T20:10:00Z")).toBe("2026-09-01");
    expect(localDay("2026-08-31 20:10:00")).toBe("2026-09-01");
  });

  it("純日期原樣保留，不做時區換算", () => {
    expect(localDay("2026-08-31")).toBe("2026-08-31");
  });

  it("空值與壞值回 null", () => {
    for (const value of [null, undefined, "", "not a date"]) expect(localDay(value)).toBeNull();
  });
});

describe("統計與閒置天數", () => {
  it("任務與里程碑的完成數，歷程事件不算里程碑", () => {
    const glance = buildGlance(source({
      tasks: [task({ id: "a", done: 1, done_at: "2026-09-01T00:00:00Z" }), task({ id: "b" })],
      milestones: [mark({ id: "m1", done: 1, due_date: "2026-05-01" }), mark({ id: "m2" }), mark({ id: "e", kind: "event", due_date: "2026-01-01" })],
    }), TODAY);
    expect(glance.counts).toEqual({ tasksDone: 1, tasks: 2, milestonesDone: 1, milestones: 2 });
  });

  it("閒置天數以台北日期計", () => {
    expect(buildGlance(source({ project: { last_activity_at: "2026-09-02 04:30:22" } }), TODAY).idleDays).toBe(22);
    expect(buildGlance(source({ project: { last_activity_at: "" } }), TODAY).idleDays).toBeNull();
  });
});
