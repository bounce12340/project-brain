import { closestCorners, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState, type FormEvent } from "react";
import { api, patchBody } from "../api";
import type { Stage, Task } from "../types";

export function Kanban({ projectId, initialStages, initialTasks, canEdit, onReload, onTaskOpen }: { projectId: string; initialStages: Stage[]; initialTasks: Task[]; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const [stages, setStages] = useState([...initialStages].sort((a, b) => a.position - b.position)); const [tasks, setTasks] = useState(initialTasks); const [stageName, setStageName] = useState(""); const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => { setStages([...initialStages].sort((a, b) => a.position - b.position)); setTasks(initialTasks); }, [initialStages, initialTasks]);
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event; if (!over || active.id === over.id || !canEdit) return;
    const activeType = active.data.current?.type as string | undefined;
    if (activeType === "stage" && over.data.current?.type === "stage") {
      const oldIndex = stages.findIndex((item) => `stage:${item.id}` === active.id); const newIndex = stages.findIndex((item) => `stage:${item.id}` === over.id);
      const next = arrayMove(stages, oldIndex, newIndex).map((item, position) => ({ ...item, position })); setStages(next);
      void Promise.all(next.map((item) => api(`/stages/${item.id}`, patchBody({ position: item.position })))); return;
    }
    if (activeType === "task") {
      const activeId = String(active.id).replace("task:", ""); const moving = tasks.find((item) => item.id === activeId); if (!moving) return;
      const overType = over.data.current?.type as string | undefined;
      const targetStage = overType === "stage" ? String(over.id).replace("stage:", "") : String(over.data.current?.stageId ?? moving.stage_id);
      const without = tasks.filter((item) => item.id !== activeId);
      const stageItems = without.filter((item) => item.stage_id === targetStage).sort((a, b) => a.position - b.position);
      const targetTaskId = overType === "task" ? String(over.id).replace("task:", "") : ""; const insertAt = targetTaskId ? Math.max(0, stageItems.findIndex((item) => item.id === targetTaskId)) : stageItems.length;
      stageItems.splice(insertAt, 0, { ...moving, stage_id: targetStage });
      const normalized = stageItems.map((item, position) => ({ ...item, position })); const normalizedIds = new Set(normalized.map((item) => item.id)); const next = [...without.filter((item) => !normalizedIds.has(item.id)), ...normalized]; setTasks(next);
      void Promise.all(normalized.map((item) => api(`/tasks/${item.id}`, patchBody({ stage_id: item.stage_id, position: item.position }))));
    }
  };
  const addStage = async (event: FormEvent) => { event.preventDefault(); if (!stageName.trim()) return; await api(`/projects/${projectId}/stages`, { method: "POST", body: JSON.stringify({ name: stageName }) }); setStageName(""); onReload(); };
  return <div><DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}><SortableContext items={stages.map((stage) => `stage:${stage.id}`)} strategy={horizontalListSortingStrategy}><div className="flex min-h-80 gap-4 overflow-x-auto pb-4">{stages.map((stage) => <StageColumn key={stage.id} stage={stage} tasks={tasks.filter((task) => task.stage_id === stage.id).sort((a, b) => a.position - b.position)} canEdit={canEdit} onReload={onReload} onTaskOpen={onTaskOpen} />)}</div></SortableContext></DndContext>
    {canEdit && <form className="mt-3 flex max-w-md gap-2" onSubmit={addStage}><input className="flex-1" placeholder="新增階段名稱" value={stageName} onChange={(e) => setStageName(e.target.value)} /><button className="btn">新增階段</button></form>}</div>;
}

function StageColumn({ stage, tasks, canEdit, onReload, onTaskOpen }: { stage: Stage; tasks: Task[]; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `stage:${stage.id}`, data: { type: "stage", stageId: stage.id }, disabled: !canEdit }); const [title, setTitle] = useState("");
  const addTask = async (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; await api(`/projects/${stage.project_id}/tasks`, { method: "POST", body: JSON.stringify({ title, stage_id: stage.id }) }); setTitle(""); onReload(); };
  const rename = async () => { const name = window.prompt("階段名稱", stage.name); if (name?.trim()) { await api(`/stages/${stage.id}`, patchBody({ name })); onReload(); } };
  const remove = async () => { if (window.confirm("確定刪除此階段？階段內不可有工作卡片。")) { try { await api(`/stages/${stage.id}`, { method: "DELETE" }); onReload(); } catch (error) { window.alert(error instanceof Error ? error.message : "刪除失敗"); } } };
  return <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .6 : 1 }} className="panel w-72 shrink-0 p-3"><header className="mb-3 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} /><button type="button" className="flex-1 cursor-grab text-left font-semibold" {...attributes} {...listeners}>{stage.name} <span className="text-xs text-star-dim">{tasks.length}</span></button>{canEdit && <><button className="text-xs text-star-dim" onClick={() => void rename()}>改名</button><button className="text-xs text-danger" onClick={() => void remove()}>刪</button></>}</header><SortableContext items={tasks.map((task) => `task:${task.id}`)} strategy={verticalListSortingStrategy}><div className="min-h-12 space-y-2">{tasks.map((task) => <TaskCard key={task.id} task={task} canEdit={canEdit} onReload={onReload} onTaskOpen={onTaskOpen} />)}</div></SortableContext>{canEdit && <form className="mt-3 flex gap-2" onSubmit={addTask}><input className="min-w-0 flex-1 !px-2 !py-1.5" placeholder="新增工作" value={title} onChange={(e) => setTitle(e.target.value)} /><button className="btn !px-2 !py-1.5">＋</button></form>}</section>;
}

function TaskCard({ task, canEdit, onReload, onTaskOpen }: { task: Task; canEdit: boolean; onReload(): void; onTaskOpen(task: Task): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `task:${task.id}`, data: { type: "task", stageId: task.stage_id }, disabled: !canEdit });
  const remove = async () => { if (window.confirm("刪除此工作？")) { await api(`/tasks/${task.id}`, { method: "DELETE" }); onReload(); } };
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .5 : 1 }} className={`kanban-task cursor-pointer border border-nexus-line bg-nexus-raised p-3 shadow-sm ${isDragging ? "is-dragging" : ""} ${task.done ? "opacity-60" : ""}`} onClick={() => onTaskOpen(task)} {...attributes} {...listeners}><div className="flex justify-between gap-2"><p className={`text-sm font-medium ${task.done ? "line-through" : ""}`}>{task.done ? "✓ " : ""}{task.title}</p>{canEdit && <button className="text-xs text-danger" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void remove(); }}>×</button>}</div>{task.assignee_name && <p className="mt-2 text-xs text-star-dim">{task.assignee_name}</p>}{task.due_date && <p className="mt-1 text-xs text-star-dim">到期 {task.due_date}</p>}<p className="mt-2 text-xs text-star-dim">留言 {task.comment_count ?? 0} · 附件 {task.attachment_count ?? 0}</p></article>;
}
