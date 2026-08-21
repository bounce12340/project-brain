import type { Stage, Task } from "./types";

/**
 * 逐條進度輸入。使用者直接指定日期、類型與對應任務，因此不需要從自由文字裡猜——
 * 先前的作法要求「已完成」「2026/8/14」這種寫法，而報告體的「8/14 完成 XX」一行都認不出來。
 */
export type EntryKind = "done" | "doing" | "todo" | "note";

export const ENTRY_KINDS: readonly EntryKind[] = ["done", "doing", "todo", "note"];

export interface ProgressEntry {
  key: string;
  date: string;
  kind: EntryKind;
  text: string;
  /** 空字串代表不對應既有任務。 */
  taskId: string;
  /** 需要新建或搬動任務時的目標階段。 */
  stageId: string;
}

export type EntryAction =
  | { type: "complete"; entryKey: string; taskId: string; title: string }
  | { type: "createDone"; entryKey: string; title: string; stageId: string; dueDate: string }
  | { type: "move"; entryKey: string; taskId: string; title: string; stageId: string }
  | { type: "create"; entryKey: string; title: string; stageId: string; dueDate: string }
  | { type: "setDate"; entryKey: string; taskId: string; title: string; dueDate: string }
  | { type: "event"; entryKey: string; title: string; date: string }
  | { type: "milestone"; entryKey: string; title: string; date: string };

export function isValidEntryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 一條進度必須有合法日期與內容；需要動到任務的類型還必須指定既有任務或目標階段。 */
export function isCompleteEntry(entry: ProgressEntry): boolean {
  if (!entry.text.trim() || !isValidEntryDate(entry.date)) return false;
  return entry.kind === "note" || !!entry.taskId || !!entry.stageId;
}

/** 顯示用日期：同一年只寫月／日，跨年才補上年份，貼近使用者原本的寫法又不會有歧義。 */
export function entryDateLabel(date: string, today: string): string {
  const [year, month, day] = date.split("-");
  const short = `${Number(month)}/${Number(day)}`;
  return year === today.slice(0, 4) ? short : `${year}/${short}`;
}

/**
 * 組出人看的進度內文。結構化資料另外直接寫進任務與里程碑，
 * 因此這段文字不再需要被機器重新解析，純粹給人讀。
 */
export function composeProgressContent(entries: ProgressEntry[], today: string, label: (kind: EntryKind) => string): string {
  return entries
    .filter(isCompleteEntry)
    .map((entry) => `• ${entryDateLabel(entry.date, today)} ${label(entry.kind)}：${entry.text.trim()}`)
    .join("\n");
}

/** 把每一條進度換算成要對系統做的事。使用者已指定日期與類型，這裡不做任何推測。 */
export function planEntryActions(
  entries: ProgressEntry[],
  tasks: Array<Pick<Task, "id" | "title">>,
  today: string,
): EntryAction[] {
  const titleOf = new Map(tasks.map((task) => [task.id, task.title]));
  const actions: EntryAction[] = [];
  for (const entry of entries) {
    if (!isCompleteEntry(entry)) continue;
    const text = entry.text.trim();
    const linked = entry.taskId && titleOf.has(entry.taskId) ? entry.taskId : "";
    const base = { entryKey: entry.key };
    if (entry.kind === "note") {
      // 過去的事是既成事實，未來的事是還沒到的檢查點。
      actions.push(entry.date <= today
        ? { ...base, type: "event", title: text, date: entry.date }
        : { ...base, type: "milestone", title: text, date: entry.date });
      continue;
    }
    if (entry.kind === "done") {
      actions.push(linked
        ? { ...base, type: "complete", taskId: linked, title: titleOf.get(linked) as string }
        : { ...base, type: "createDone", title: text, stageId: entry.stageId, dueDate: entry.date });
      continue;
    }
    if (entry.kind === "doing") {
      actions.push(linked
        ? { ...base, type: "move", taskId: linked, title: titleOf.get(linked) as string, stageId: entry.stageId }
        : { ...base, type: "create", title: text, stageId: entry.stageId, dueDate: entry.date });
      continue;
    }
    actions.push(linked
      ? { ...base, type: "setDate", taskId: linked, title: titleOf.get(linked) as string, dueDate: entry.date }
      : { ...base, type: "create", title: text, stageId: entry.stageId, dueDate: entry.date });
  }
  return actions;
}

/** 套用後會不會影響自動進度——只有新增或完成任務會。用來決定要不要事先警告使用者。 */
export function actionsAffectProgress(actions: EntryAction[]): boolean {
  return actions.some((action) => action.type === "complete" || action.type === "createDone" || action.type === "create");
}

/** 需要指定階段的類型：會建立新任務，或要把既有任務搬到某一階段。 */
export function entryNeedsStage(kind: EntryKind, taskId: string): boolean {
  if (kind === "note") return false;
  return kind === "doing" || !taskId;
}

/** 預設階段：優先挑還有未完成任務的那一階段，否則用第一個。 */
export function defaultStageId(stages: Stage[]): string {
  return [...stages].sort((left, right) => left.position - right.position)[0]?.id ?? "";
}
