import { useMemo, useState } from "react";
import { useT } from "../i18n/LangContext";
import {
  ENTRY_KINDS, actionsAffectProgress, composeProgressContent, defaultStageId,
  entryDateLabel, entryNeedsStage, isCompleteEntry, planEntryActions,
  type EntryKind, type ProgressEntry,
} from "../progress-entry";
import type { Stage, Task } from "../types";
import type { TransKey } from "../i18n/translations";

const kindKeys: Record<EntryKind, TransKey> = {
  done: "compose.kind.done", doing: "compose.kind.doing", todo: "compose.kind.todo", note: "compose.kind.note",
};

/**
 * 逐條進度輸入。日期、類型、對應任務都由使用者直接選，因此發布時不必從文字裡猜任何東西——
 * 先前靠正則辨識「已完成」「2026/8/14」，報告體的「8/14 完成 XX」一行都認不出來。
 */
export function ProgressComposer({ tasks, stages, today, busy, onPublish }: {
  tasks: Task[];
  stages: Stage[];
  today: string;
  busy: boolean;
  onPublish(entries: ProgressEntry[], content: string, warnProgress: boolean): void;
}) {
  const t = useT();
  const label = (kind: EntryKind) => t(kindKeys[kind]);
  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const blank = (): Omit<ProgressEntry, "key"> => ({ date: today, kind: "done", text: "", taskId: "", stageId: defaultStageId(stages) });
  const [draft, setDraft] = useState(blank);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);

  const needsStage = entryNeedsStage(draft.kind, draft.taskId);
  const draftReady = isCompleteEntry({ ...draft, key: "draft" });
  const actions = useMemo(() => planEntryActions(entries, openTasks, today), [entries, openTasks, today]);
  const content = composeProgressContent(entries, today, label);
  const warnProgress = actionsAffectProgress(actions);

  const add = () => {
    if (!draftReady) return;
    setEntries((rows) => [...rows, { ...draft, key: `e${rows.length}${Date.now()}`, text: draft.text.trim() }]);
    setDraft((current) => ({ ...blank(), date: current.date, kind: current.kind }));
  };

  const summary = (key: string): string => {
    const action = actions.find((item) => item.entryKey === key);
    if (!action) return "";
    const stageName = (id: string) => stages.find((stage) => stage.id === id)?.name ?? "";
    switch (action.type) {
      case "complete": return t("compose.act.complete", { task: action.title });
      case "createDone": return t("compose.act.createDone", { stage: stageName(action.stageId) });
      case "move": return t("compose.act.move", { task: action.title, stage: stageName(action.stageId) });
      case "create": return t("compose.act.create", { stage: stageName(action.stageId) });
      case "setDate": return t("compose.act.setDate", { task: action.title });
      case "event": return t("compose.act.event");
      default: return t("compose.act.milestone");
    }
  };

  return <div className="space-y-4">
    <div className="grid gap-3 border border-nexus-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">{t("common.date")}</span>
          <input className="w-full" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        <label className="block"><span className="label">{t("compose.kind")}</span>
          <select className="w-full" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as EntryKind })}>
            {ENTRY_KINDS.map((kind) => <option value={kind} key={kind}>{label(kind)}</option>)}
          </select></label>
      </div>
      <label className="block"><span className="label">{t("compose.text")}</span>
        <input className="w-full" maxLength={80} placeholder={t("compose.textPlaceholder")} value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
      {draft.kind !== "note" && <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">{t("compose.task")}</span>
          <select className="w-full" value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}>
            <option value="">{t("compose.noTask")}</option>
            {openTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}
          </select></label>
        {needsStage && <label className="block"><span className="label">{t("compose.stage")}</span>
          <select className="w-full" value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}>
            {stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}
          </select></label>}
      </div>}
      <button className="btn-secondary justify-self-start" type="button" disabled={!draftReady} onClick={add}>{t("compose.add")}</button>
    </div>

    {entries.length > 0 && <div>
      <h3 className="mb-2 font-bold">{t("compose.added", { count: entries.length })}</h3>
      <ul className="space-y-2">{entries.map((item) => <li className="flex items-start gap-3 border border-nexus-line p-3 text-sm" key={item.key}>
        <span className="shrink-0 font-mono text-star-dim">{entryDateLabel(item.date, today)}</span>
        <span className="min-w-0 flex-1"><span className="font-medium">{label(item.kind)}：{item.text}</span>
          <span className="mt-1 block text-xs text-star-dim">{summary(item.key)}</span></span>
        <button className="shrink-0 text-danger" type="button" aria-label={t("compose.remove", { text: item.text })}
          onClick={() => setEntries((rows) => rows.filter((row) => row.key !== item.key))}>✕</button>
      </li>)}</ul>
      {warnProgress && <p className="mt-3 border border-warn bg-void p-3 text-sm text-warn">{t("compose.progressWarning")}</p>}
      <button className="btn mt-4" type="button" disabled={busy || !entries.length}
        onClick={() => onPublish(entries, content, warnProgress)}>{t(busy ? "common.processing" : "compose.publish")}</button>
    </div>}
  </div>;
}
