import { describe, expect, it } from "vitest";
import { changedTasks, isNoop, placeTask, stageOfDragId } from "../src/kanban-dnd";
import type { Task } from "../src/types";

const task = (id: string, stage_id: string, position: number): Task => ({
  id, project_id: "p1", stage_id, title: id, description: "", assignee_id: null, start_date: null,
  due_date: null, position, done: 0, done_at: null, created_at: "2026-09-01", dependency_ids: [],
  comment_count: 0, attachment_count: 0,
});

// 待辦 a,b,c ／ 進行中 d,e ／ 已完成 f
const board = () => [task("a", "todo", 0), task("b", "todo", 1), task("c", "todo", 2), task("d", "doing", 0), task("e", "doing", 1), task("f", "done", 0)];
const column = (tasks: Task[], stage: string) => tasks.filter((item) => item.stage_id === stage).sort((l, r) => l.position - r.position).map((item) => item.id);

describe("stageOfDragId", () => {
  it("認得欄位與卡片兩種 id", () => {
    expect(stageOfDragId(board(), "stage:doing")).toBe("doing");
    expect(stageOfDragId(board(), "task:e")).toBe("doing");
    expect(stageOfDragId(board(), "task:missing")).toBeUndefined();
  });
});

describe("placeTask", () => {
  it("跨欄插到指定卡片之前", () => {
    const next = placeTask(board(), "a", "doing", "e");
    expect(column(next, "doing")).toEqual(["d", "a", "e"]);
    expect(column(next, "todo")).toEqual(["b", "c"]);
  });

  it("游標越過目標卡中線時插在它後面", () => {
    // 往下拖時若永遠插在前面，就會發生「放在最底下卻跳到上面一格」。
    expect(column(placeTask(board(), "a", "doing", "e", true), "doing")).toEqual(["d", "e", "a"]);
  });

  it("拖到欄位空白處（沒有目標卡）放最後，不是放最前面", () => {
    expect(column(placeTask(board(), "a", "doing", ""), "doing")).toEqual(["d", "e", "a"]);
  });

  it("目標卡不在該欄時也放最後，而不是彈回第 0 位", () => {
    // 原本用 Math.max(0, findIndex) ——findIndex 回 -1 就變成 0，卡片會跳到最上面。
    expect(column(placeTask(board(), "a", "doing", "f"), "doing")).toEqual(["d", "e", "a"]);
  });

  it("同欄內重排", () => {
    expect(column(placeTask(board(), "c", "todo", "a"), "todo")).toEqual(["c", "a", "b"]);
  });

  it("同欄往下拖到最後一張卡上，就是落在最後", () => {
    // 瀏覽器實測抓到的：同欄不能再自己算中線。SortableContext 拖曳中已經把兄弟卡片挪開，
    // over 回報的就是「你佔住的那一格」，再加一次位移會停在倒數第二個位置。
    expect(column(placeTask(board(), "a", "todo", "c"), "todo")).toEqual(["b", "c", "a"]);
    // 中線判斷傳進來也不該改變同欄的結果。
    expect(column(placeTask(board(), "a", "todo", "c", true), "todo")).toEqual(["b", "c", "a"]);
  });

  it("同欄拖到欄位空白處也是落在最後", () => {
    expect(column(placeTask(board(), "a", "todo", ""), "todo")).toEqual(["b", "c", "a"]);
  });

  it("位置重新編號後沒有跳號", () => {
    const next = placeTask(board(), "a", "doing", "d");
    expect(next.filter((item) => item.stage_id === "doing").map((item) => item.position).sort()).toEqual([0, 1, 2]);
  });

  it("找不到要搬的卡片就原樣回傳", () => {
    const before = board();
    expect(placeTask(before, "nope", "doing", "d")).toBe(before);
  });
});

describe("changedTasks", () => {
  it("只回傳真的換了欄或換了位置的卡片", () => {
    const before = board();
    const after = placeTask(before, "a", "doing", "d");
    // a 換欄，d 與 e 被往後推；b、c、f 不該被送出。
    expect(changedTasks(before, after).map((item) => item.id).sort()).toEqual(["a", "d", "e"]);
  });

  it("整欄無差別送出是浪費——同欄原地放下時一個請求都不該發", () => {
    const before = board();
    expect(changedTasks(before, placeTask(before, "b", "todo", "b"))).toEqual([]);
  });
});

describe("isNoop", () => {
  it("原地放下視為沒有變動", () => {
    const before = board();
    expect(isNoop(before, placeTask(before, "b", "todo", "b"))).toBe(true);
    expect(isNoop(before, placeTask(before, "b", "doing", "d"))).toBe(false);
  });
});
