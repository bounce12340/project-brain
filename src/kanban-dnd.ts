import type { Task } from "./types";

/**
 * 看板拖曳的純計算。抽出來是因為拖放的手感問題有一半在「算錯要插到哪」，
 * 而那件事不需要瀏覽器就能驗。
 */

/** 從 dnd-kit 的 id（`task:xxx`／`stage:xxx`）反查它屬於哪一欄。 */
export function stageOfDragId(tasks: Task[], id: string): string | undefined {
  if (id.startsWith("stage:")) return id.slice("stage:".length);
  return tasks.find((task) => `task:${task.id}` === id)?.stage_id;
}

/** 陣列內搬移，不改原陣列。 */
function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  next.splice(to < 0 ? next.length - 1 : to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * 把一張卡片放到目標欄的指定位置，回傳新的完整清單。
 * `overTaskId` 為空代表放在該欄最後（拖到欄位空白處）。
 * `after` 只用於跨欄：游標已越過目標卡中線時要插在它後面。
 */
export function placeTask(tasks: Task[], taskId: string, targetStage: string, overTaskId: string, after = false): Task[] {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return tasks;
  // 放在自己身上就是沒動。dnd-kit 在還沒越過鄰居時經常把 over 回報成拖曳中的那張卡本身，
  // 少了這道判斷會把它算成「找不到目標卡」而丟到欄位最後面。
  if (overTaskId === taskId) return tasks;
  const byPosition = (left: Task, right: Task) => left.position - right.position;

  // 同一欄內：dnd-kit 的 SortableContext 拖曳中就已經把兄弟卡片挪開了，
  // over 回報的是「你現在佔住的那一格」，直接搬過去即可。若再自己算中線會多跳一格——
  // 往下拖到最底會停在倒數第二個位置。
  if (moving.stage_id === targetStage) {
    const column = tasks.filter((task) => task.stage_id === targetStage).sort(byPosition);
    const from = column.findIndex((task) => task.id === taskId);
    const to = overTaskId ? column.findIndex((task) => task.id === overTaskId) : column.length - 1;
    if (from < 0 || to < 0) return tasks;
    const normalized = move(column, from, to).map((task, position) => ({ ...task, position }));
    const touched = new Set(normalized.map((task) => task.id));
    return [...tasks.filter((task) => !touched.has(task.id)), ...normalized];
  }

  // 跨欄：卡片還不在目標欄裡，得自己決定插在目標卡的前面還是後面。
  const without = tasks.filter((task) => task.id !== taskId);
  const column = without.filter((task) => task.stage_id === targetStage).sort(byPosition);
  const overIndex = overTaskId ? column.findIndex((task) => task.id === overTaskId) : -1;
  // 找不到目標卡（例如拖到欄位下方的空白）就放最後，不要退回第 0 位——
  // 原本用 Math.max(0, -1) 會把卡片彈到最上面，跟放手的位置對不上。
  const insertAt = overIndex < 0 ? column.length : overIndex + (after ? 1 : 0);
  column.splice(insertAt, 0, { ...moving, stage_id: targetStage });
  const normalized = column.map((task, position) => ({ ...task, position }));
  const touched = new Set(normalized.map((task) => task.id));
  return [...without.filter((task) => !touched.has(task.id)), ...normalized];
}

/** 只挑出真的換了欄或換了位置的卡片。整欄無差別送出等於每次拖曳都打一整排請求。 */
export function changedTasks(before: Task[], after: Task[]): Task[] {
  const previous = new Map(before.map((task) => [task.id, task]));
  return after.filter((task) => {
    const old = previous.get(task.id);
    return !old || old.stage_id !== task.stage_id || old.position !== task.position;
  });
}

/** 同一欄內、位置也沒動，就什麼都不必做。 */
export function isNoop(before: Task[], after: Task[]): boolean {
  return changedTasks(before, after).length === 0;
}
