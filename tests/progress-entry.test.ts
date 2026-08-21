import { describe, expect, it } from "vitest";
import {
  actionsAffectProgress, composeProgressContent, defaultStageId, entryDateLabel,
  entryNeedsStage, isCompleteEntry, isValidEntryDate, planEntryActions,
  type EntryKind, type ProgressEntry,
} from "../src/progress-entry";

const today = "2026-08-21";
const label = (kind: EntryKind) => ({ done: "已完成", doing: "進行中", todo: "待辦", note: "紀錄" }[kind]);
const entry = (patch: Partial<ProgressEntry> = {}): ProgressEntry =>
  ({ key: "k1", date: "2026-08-14", kind: "done", text: "更新後的台灣 PIF 檔案", taskId: "", stageId: "s1", ...patch });
const tasks = [{ id: "t1", title: "PIF 檔案更新" }, { id: "t2", title: "送 TFDA" }];

describe("日期驗證", () => {
  it.each(["2026-08-14", "2024-02-29"])("接受合法日期 %s", (value) => expect(isValidEntryDate(value)).toBe(true));
  it.each(["8/14", "2026-8-14", "2026-13-01", "2025-02-29", ""])("擋掉 %s", (value) => expect(isValidEntryDate(value)).toBe(false));
});

describe("entryDateLabel", () => {
  it("同年只顯示月/日，貼近使用者原本的寫法", () => expect(entryDateLabel("2026-08-14", today)).toBe("8/14"));
  it("跨年補上年份，避免歧義", () => expect(entryDateLabel("2025-12-30", today)).toBe("2025/12/30"));
});

describe("isCompleteEntry", () => {
  it("純紀錄不需要任務或階段", () => expect(isCompleteEntry(entry({ kind: "note", stageId: "", taskId: "" }))).toBe(true));
  it("要動到任務就必須有既有任務或目標階段", () => {
    expect(isCompleteEntry(entry({ stageId: "", taskId: "" }))).toBe(false);
    expect(isCompleteEntry(entry({ stageId: "", taskId: "t1" }))).toBe(true);
  });
  it("沒有文字或日期不合法都不算完整", () => {
    expect(isCompleteEntry(entry({ text: "   " }))).toBe(false);
    expect(isCompleteEntry(entry({ date: "8/14" }))).toBe(false);
  });
});

describe("planEntryActions 依使用者指定的類型換算，不做推測", () => {
  const plan = (patch: Partial<ProgressEntry>) => planEntryActions([entry(patch)], tasks, today)[0];

  it("已完成 + 對應任務 → 標記該任務完成", () => {
    expect(plan({ kind: "done", taskId: "t1" })).toMatchObject({ type: "complete", taskId: "t1", title: "PIF 檔案更新" });
  });

  it("已完成 + 沒有對應任務 → 建立已完成的任務", () => {
    expect(plan({ kind: "done", taskId: "" })).toMatchObject({ type: "createDone", stageId: "s1", dueDate: "2026-08-14" });
  });

  it("進行中 + 對應任務 → 搬到指定階段", () => {
    expect(plan({ kind: "doing", taskId: "t1", stageId: "s2" })).toMatchObject({ type: "move", taskId: "t1", stageId: "s2" });
  });

  it("待辦 + 對應任務 → 只設定到期日，不新建", () => {
    expect(plan({ kind: "todo", taskId: "t2", date: "2026-09-01" })).toMatchObject({ type: "setDate", taskId: "t2", dueDate: "2026-09-01" });
  });

  it("純紀錄且日期在過去 → 歷程事件", () => {
    expect(plan({ kind: "note", date: "2026-07-31" })).toMatchObject({ type: "event", date: "2026-07-31" });
  });

  it("純紀錄且日期在未來 → 里程碑", () => {
    expect(plan({ kind: "note", date: "2026-09-30" })).toMatchObject({ type: "milestone", date: "2026-09-30" });
  });

  it("今天的純紀錄算既成事實", () => expect(plan({ kind: "note", date: today })).toMatchObject({ type: "event" }));

  it("對應到已不存在的任務時退回新建，不會送出打不到的 id", () => {
    expect(plan({ kind: "done", taskId: "gone" })).toMatchObject({ type: "createDone" });
  });

  it("跳過不完整的條目", () => {
    expect(planEntryActions([entry({ text: "" }), entry({ key: "k2", taskId: "t1" })], tasks, today)).toHaveLength(1);
  });

  it("每條進度剛好對應一個動作", () => {
    const rows = ["done", "doing", "todo", "note"].map((kind, index) =>
      entry({ key: `k${index}`, kind: kind as EntryKind, taskId: "t1" }));
    expect(planEntryActions(rows, tasks, today).map((action) => action.entryKey)).toEqual(["k0", "k1", "k2", "k3"]);
  });
});

describe("composeProgressContent", () => {
  it("組成人看得懂的條列，不再需要被機器重新解析", () => {
    const rows = [entry({ key: "a", date: "2026-07-31", kind: "note", text: "收到 Jelly 結果", stageId: "" }),
      entry({ key: "b", date: "2026-08-14", kind: "done", taskId: "t1" })];
    expect(composeProgressContent(rows, today, label)).toBe("• 7/31 紀錄：收到 Jelly 結果\n• 8/14 已完成：更新後的台灣 PIF 檔案");
  });

  it("不完整的條目不會出現在內文", () => {
    expect(composeProgressContent([entry({ text: "" })], today, label)).toBe("");
  });
});

describe("actionsAffectProgress", () => {
  it("新增或完成任務會動到自動進度，要事先警告", () => {
    for (const kind of ["done", "doing", "todo"] as const) {
      expect(actionsAffectProgress(planEntryActions([entry({ kind, taskId: "" })], tasks, today))).toBe(true);
    }
  });

  it("只記歷程事件或里程碑不影響進度", () => {
    const rows = [entry({ kind: "note", date: "2026-07-31" }), entry({ key: "k2", kind: "note", date: "2026-09-30" })];
    expect(actionsAffectProgress(planEntryActions(rows, tasks, today))).toBe(false);
  });

  it("只搬動既有任務不影響進度", () => {
    expect(actionsAffectProgress(planEntryActions([entry({ kind: "doing", taskId: "t1" })], tasks, today))).toBe(false);
  });
});

describe("entryNeedsStage", () => {
  it("純紀錄永遠不需要階段", () => expect(entryNeedsStage("note", "")).toBe(false));
  it("要新建任務時需要階段", () => expect(entryNeedsStage("done", "")).toBe(true));
  it("已對應任務的完成與待辦不需要階段", () => {
    expect(entryNeedsStage("done", "t1")).toBe(false);
    expect(entryNeedsStage("todo", "t1")).toBe(false);
  });
  it("進行中即使有對應任務也需要階段——要知道搬去哪裡", () => expect(entryNeedsStage("doing", "t1")).toBe(true));
});

describe("defaultStageId", () => {
  it("取 position 最小的階段", () => {
    expect(defaultStageId([
      { id: "b", project_id: "p", name: "進行中", color: "#fff", position: 1 },
      { id: "a", project_id: "p", name: "待辦", color: "#fff", position: 0 },
    ])).toBe("a");
  });
  it("沒有階段時回空字串", () => expect(defaultStageId([])).toBe(""));
});
