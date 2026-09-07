import { closestCorners, DndContext, DragOverlay, MeasuringStrategy, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, patchBody } from "../api";
import { changedTasks, isNoop, placeTask, stageOfDragId } from "../kanban-dnd";
import type { Stage, Task } from "../types";
import { useT } from "../i18n/LangContext";

export function Kanban({ projectId, initialStages, initialTasks, canEdit, onReload, onTaskOpen }: { projectId: string; initialStages: Stage[]; initialTasks: Task[]; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const t = useT();
  const [stages, setStages] = useState([...initialStages].sort((a, b) => a.position - b.position)); const [tasks, setTasks] = useState(initialTasks); const [stageName, setStageName] = useState(""); const [stageSubmitting, setStageSubmitting] = useState(false); const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // 拖曳中被舉起來的那張卡（畫在 DragOverlay 裡），以及拖曳開始前的快照——存檔失敗要退回去。
  const [dragging, setDragging] = useState<string | null>(null);
  const snapshot = useRef<Task[] | null>(null);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { setStages([...initialStages].sort((a, b) => a.position - b.position)); setTasks(initialTasks); }, [initialStages, initialTasks]);

  const onDragStart = (event: DragStartEvent) => { setDragging(String(event.active.id)); snapshot.current = tasks; setSaveError(""); };
  const onDragCancel = () => { if (snapshot.current) setTasks(snapshot.current); setDragging(null); snapshot.current = null; };

  // 跨欄時就地把卡片搬過去，讓目標欄「當場讓出空位」。原本只在放手時才重算，
  // 於是拖曳全程三欄都紋風不動，看不出會掉到哪裡。同欄內的位移 dnd-kit 自己會做。
  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !canEdit || active.data.current?.type !== "task") return;
    const taskId = String(active.id).slice("task:".length);
    const from = tasks.find((task) => task.id === taskId)?.stage_id;
    const to = stageOfDragId(tasks, String(over.id));
    if (!from || !to || from === to) return;
    const overTaskId = String(over.id).startsWith("task:") ? String(over.id).slice("task:".length) : "";
    setTasks((current) => placeTask(current, taskId, to, overTaskId, isBelow(event)));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event; setDragging(null);
    const before = snapshot.current; snapshot.current = null;
    if (!over || !canEdit) { if (before) setTasks(before); return; }
    const activeType = active.data.current?.type as string | undefined;
    if (activeType === "stage" && over.data.current?.type === "stage") {
      if (active.id === over.id) return;
      const oldIndex = stages.findIndex((item) => `stage:${item.id}` === active.id); const newIndex = stages.findIndex((item) => `stage:${item.id}` === over.id);
      const previous = stages; const next = arrayMove(stages, oldIndex, newIndex).map((item, position) => ({ ...item, position })); setStages(next);
      void save(next.map((item) => api(`/stages/${item.id}`, patchBody({ position: item.position }))), () => setStages(previous)); return;
    }
    if (activeType !== "task" || !before) return;
    const taskId = String(active.id).slice("task:".length);
    const to = stageOfDragId(tasks, String(over.id)) ?? tasks.find((task) => task.id === taskId)?.stage_id;
    if (!to) return;
    const overTaskId = String(over.id).startsWith("task:") ? String(over.id).slice("task:".length) : "";
    const next = placeTask(tasks, taskId, to, overTaskId, isBelow(event));
    if (isNoop(before, next)) { setTasks(before); return; }
    setTasks(next);
    // 只送真的動過的卡片。原本無論如何都把整欄重送一遍。
    void save(changedTasks(before, next).map((item) => api(`/tasks/${item.id}`, patchBody({ stage_id: item.stage_id, position: item.position }))), () => setTasks(before));
  };

  const save = async (requests: Array<Promise<unknown>>, rollback: () => void) => {
    try { await Promise.all(requests); }
    catch (cause) { rollback(); setSaveError(cause instanceof Error ? cause.message : t("error.operation")); }
  };

  const addStage = async (event: FormEvent) => {
    event.preventDefault(); if (!stageName.trim()) return; setStageSubmitting(true);
    try { await api(`/projects/${projectId}/stages`, { method: "POST", body: JSON.stringify({ name: stageName }) }); setStageName(""); onReload(); }
    finally { setStageSubmitting(false); }
  };

  const draggedTask = dragging?.startsWith("task:") ? tasks.find((task) => `task:${task.id}` === dragging) : undefined;
  const draggedStage = dragging?.startsWith("stage:") ? stages.find((stage) => `stage:${stage.id}` === dragging) : undefined;
  return <div><DndContext sensors={sensors} collisionDetection={closestCorners} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}><SortableContext items={stages.map((stage) => `stage:${stage.id}`)} strategy={horizontalListSortingStrategy}><div className={`flex min-h-80 gap-4 overflow-x-auto pb-4 ${dragging ? "kanban-board-dragging" : ""}`}>{stages.map((stage) => <StageColumn key={stage.id} stage={stage} tasks={tasks.filter((task) => task.stage_id === stage.id).sort((a, b) => a.position - b.position)} canEdit={canEdit} onReload={onReload} onTaskOpen={onTaskOpen} />)}</div></SortableContext>
    {/* 卡片舉起來後畫在 overlay 裡：它是 fixed 定位，不會被欄位的橫向捲動裁掉，也不必等 CSS 過場就能跟上游標。 */}
    <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.9,.3,1)" }}>
      {draggedTask ? <TaskCardBody task={draggedTask} lifted /> : draggedStage ? <div className="panel w-72 p-3 opacity-90 shadow-lg"><span className="font-semibold">{draggedStage.name}</span></div> : null}
    </DragOverlay></DndContext>
    {saveError && <p className="mt-3 text-sm text-danger" role="alert">{saveError}</p>}
    {canEdit && <form className="mt-3 flex max-w-md gap-2" onSubmit={addStage}><input className="flex-1" placeholder={t("kanban.newStagePlaceholder")} value={stageName} onChange={(e) => setStageName(e.target.value)} /><button className="btn" disabled={stageSubmitting}>{t(stageSubmitting ? "common.processing" : "kanban.addStage")}</button></form>}</div>;
}

/** 游標已經越過目標卡的中線時要插在它後面，否則往下拖永遠只能插在前面。 */
function isBelow(event: DragOverEvent | DragEndEvent): boolean {
  const moving = event.active.rect.current.translated; const target = event.over?.rect;
  if (!moving || !target || !String(event.over?.id).startsWith("task:")) return false;
  return moving.top > target.top + target.height / 2;
}

function StageColumn({ stage, tasks, canEdit, onReload, onTaskOpen }: { stage: Stage; tasks: Task[]; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `stage:${stage.id}`, data: { type: "stage", stageId: stage.id }, disabled: !canEdit }); const [title, setTitle] = useState(""); const [taskSubmitting, setTaskSubmitting] = useState(false);
  const addTask = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; setTaskSubmitting(true);
    try { await api(`/projects/${stage.project_id}/tasks`, { method: "POST", body: JSON.stringify({ title, stage_id: stage.id }) }); setTitle(""); onReload(); }
    finally { setTaskSubmitting(false); }
  };
  const rename = async () => { const name = window.prompt(t("kanban.stageName"), stage.name); if (name?.trim()) { await api(`/stages/${stage.id}`, patchBody({ name })); onReload(); } };
  const remove = async () => { if (window.confirm(t("kanban.deleteStage"))) { try { await api(`/stages/${stage.id}`, { method: "DELETE" }); onReload(); } catch (error) { window.alert(error instanceof Error ? error.message : t("error.operation")); } } };
  return <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .4 : 1 }} className="panel w-72 shrink-0 p-3"><header className="mb-3 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} /><button type="button" className="flex-1 cursor-grab text-left font-semibold" {...attributes} {...listeners}>{stage.name} <span className="text-xs text-star-dim">{tasks.length}</span></button>{canEdit && <><button className="text-xs text-star-dim" onClick={() => void rename()}>{t("kanban.rename")}</button><button className="text-xs text-danger" onClick={() => void remove()}>{t("kanban.deleteShort")}</button></>}</header><SortableContext items={tasks.map((task) => `task:${task.id}`)} strategy={verticalListSortingStrategy}><div className="min-h-12 space-y-2">{tasks.map((task) => <TaskCard key={task.id} task={task} canEdit={canEdit} onReload={onReload} onTaskOpen={onTaskOpen} />)}</div></SortableContext>{canEdit && <form className="mt-3 flex gap-2" onSubmit={addTask}><input className="min-w-0 flex-1 !px-2 !py-1.5" placeholder={t("kanban.newTask")} value={title} onChange={(e) => setTitle(e.target.value)} /><button className="btn !px-2 !py-1.5" disabled={taskSubmitting}>{taskSubmitting ? t("common.processing") : "＋"}</button></form>}</section>;
}

function TaskCard({ task, canEdit, onReload, onTaskOpen }: { task: Task; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `task:${task.id}`, data: { type: "task", stageId: task.stage_id }, disabled: !canEdit });
  const remove = async () => { if (window.confirm(t("kanban.deleteTask"))) { await api(`/tasks/${task.id}`, { method: "DELETE" }); onReload(); } };
  // 卡片被舉起來後由 overlay 呈現，原位留下一個淡掉的佔位，看得出它是從哪裡拿走的。
  return <TaskCardBody task={task} placeholder={isDragging} nodeRef={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} handle={{ ...attributes, ...listeners }} onOpen={() => onTaskOpen(task)} onRemove={canEdit ? remove : undefined} />;
}

function TaskCardBody({ task, placeholder, lifted, nodeRef, style, handle, onOpen, onRemove }: { task: Task; placeholder?: boolean; lifted?: boolean; nodeRef?: (node: HTMLElement | null) => void; style?: React.CSSProperties; handle?: Record<string, unknown>; onOpen?: () => void; onRemove?: () => Promise<void> }) {
  const t = useT();
  return <article ref={nodeRef} style={style} className={`kanban-task border border-nexus-line bg-nexus-raised p-3 shadow-sm ${onOpen ? "cursor-pointer" : ""} ${placeholder ? "is-placeholder" : ""} ${lifted ? "is-lifted" : ""} ${task.done ? "opacity-60" : ""}`} onClick={onOpen} {...handle}><div className="flex justify-between gap-2"><p className={`text-sm font-medium ${task.done ? "line-through" : ""}`}>{task.done ? "✓ " : ""}{task.title}</p>{onRemove && <button aria-label={t("a11y.deleteNamed", { title: task.title })} className="text-xs text-danger" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void onRemove(); }}>×</button>}</div>{task.assignee_name && <p className="mt-2 text-xs text-star-dim">{task.assignee_name}</p>}{task.due_date && <p className="mt-1 text-xs text-star-dim">{t("kanban.due", { date: task.due_date })}</p>}<p className="mt-2 text-xs text-star-dim">{t("kanban.counts", { comments: task.comment_count ?? 0, attachments: task.attachment_count ?? 0 })}</p></article>;
}
