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

export async function recomputeAutoProgress(
  db: D1Database,
  projectId: string,
  actorId: string,
  completionLabel?: string,
): Promise<AutoProgressResult | null> {
  const project = await db.prepare("SELECT progress,progress_mode FROM projects WHERE id=?").bind(projectId).first<{ progress: number; progress_mode: "manual" | "auto" }>();
  if (!project) return null;
  if (project.progress_mode !== "auto") return { mode: "manual", previous: project.progress, progress: project.progress, changed: false };
  const counts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE project_id=?) AS totalTasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id=? AND done=1) AS completedTasks,
      (SELECT COUNT(*) FROM milestones WHERE project_id=?) AS totalMilestones,
      (SELECT COUNT(*) FROM milestones WHERE project_id=? AND done=1) AS completedMilestones,
      (SELECT COUNT(*) FROM todos WHERE project_id=?) AS totalTodos,
      (SELECT COUNT(*) FROM todos WHERE project_id=? AND done=1) AS completedTodos,
      (SELECT COUNT(*) FROM key_results WHERE project_id=?) AS totalKeyResults,
      (SELECT COUNT(*) FROM key_results WHERE project_id=? AND status='完成') AS completedKeyResults
  `).bind(projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId).first<ProgressCounts>();
  if (!counts) return null;
  const progress = calculateAutoProgress(counts, project.progress);
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE projects SET progress=?,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(progress, projectId),
  ];
  if (completionLabel) statements.push(db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot) VALUES (?,?,?,?,?)")
    .bind(`upd_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`, projectId, actorId, `✔ ${completionLabel}（進度 ${progress}%）`, progress));
  await db.batch(statements);
  return { mode: "auto", previous: project.progress, progress, changed: progress !== project.progress };
}
