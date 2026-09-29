export interface ProgressCounts {
  completedTasks: number;
  totalTasks: number;
  completedMilestones: number;
  totalMilestones: number;
  completedTodos: number;
  totalTodos: number;
  completedKeyResults?: number;
  totalKeyResults?: number;
}

export function calculateAutoProgress(counts: ProgressCounts, current: number): number {
  const completed = counts.completedTasks + counts.completedMilestones + counts.completedTodos + (counts.completedKeyResults ?? 0);
  const total = counts.totalTasks + counts.totalMilestones + counts.totalTodos + (counts.totalKeyResults ?? 0);
  return total === 0 ? current : Math.round(100 * completed / total);
}

export interface AutoProgressResult {
  mode: "manual" | "auto";
  previous: number;
  progress: number;
  changed: boolean;
}

/**
 * 自動進度：已完成的任務、里程碑、待辦與 KR 佔全部的比例。
 * 母專案把子專案的項目一起算（整體進度），所以子專案有變動時，母專案也跟著重算。
 * 子專案只有一層，母專案沒有自己的母專案，重算不會一直往上遞迴。
 */
export async function recomputeAutoProgress(
  db: D1Database,
  projectId: string,
  actorId: string,
  completionLabel?: string,
): Promise<AutoProgressResult | null> {
  const project = await db.prepare("SELECT progress,progress_mode,parent_id FROM projects WHERE id=?").bind(projectId).first<{ progress: number; progress_mode: "manual" | "auto"; parent_id: string | null }>();
  if (!project) return null;
  const result = project.progress_mode === "auto"
    ? await recomputeOwn(db, projectId, project.progress, actorId, completionLabel)
    : { mode: "manual" as const, previous: project.progress, progress: project.progress, changed: false };
  if (project.parent_id) await recomputeAutoProgress(db, project.parent_id, actorId);
  return result;
}

async function recomputeOwn(db: D1Database, projectId: string, current: number, actorId: string, completionLabel?: string): Promise<AutoProgressResult | null> {
  const scope = await db.prepare("SELECT id FROM projects WHERE id=? OR parent_id=?").bind(projectId, projectId).all<{ id: string }>();
  const ids = scope.results.map((row) => row.id);
  const inList = ids.map(() => "?").join(",");
  const counts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE project_id IN (${inList})) AS totalTasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id IN (${inList}) AND done=1) AS completedTasks,
      (SELECT COUNT(*) FROM milestones WHERE project_id IN (${inList}) AND kind='milestone') AS totalMilestones,
      (SELECT COUNT(*) FROM milestones WHERE project_id IN (${inList}) AND kind='milestone' AND done=1) AS completedMilestones,
      (SELECT COUNT(*) FROM todos WHERE project_id IN (${inList})) AS totalTodos,
      (SELECT COUNT(*) FROM todos WHERE project_id IN (${inList}) AND done=1) AS completedTodos,
      (SELECT COUNT(*) FROM key_results WHERE project_id IN (${inList})) AS totalKeyResults,
      (SELECT COUNT(*) FROM key_results WHERE project_id IN (${inList}) AND status='完成') AS completedKeyResults
  `).bind(...Array.from({ length: 8 }, () => ids).flat()).first<ProgressCounts>();
  if (!counts) return null;
  const progress = calculateAutoProgress(counts, current);
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE projects SET progress=?,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(progress, projectId),
  ];
  if (completionLabel) statements.push(db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot) VALUES (?,?,?,?,?)")
    .bind(`upd_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`, projectId, actorId, `✔ ${completionLabel}（進度 ${progress}%）`, progress));
  await db.batch(statements);
  return { mode: "auto", previous: current, progress, changed: progress !== current };
}
