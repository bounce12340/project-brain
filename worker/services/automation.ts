import { recomputeAutoProgress } from "./auto-progress";

export type TriggerType = "task_done" | "task_moved_to_stage" | "milestone_done" | "progress_reached";
export type ActionType = "notify_user" | "assign_task_to" | "create_todo_for" | "log_update";

export interface AutomationRuleLike {
  trigger_type: TriggerType;
  trigger_param: string | null;
  action_type: ActionType;
  enabled: number;
}

export interface AutomationEvent {
  type: TriggerType;
  taskId?: string;
  stageId?: string;
  previousProgress?: number;
  progress?: number;
  depth?: number;
}

export function crossedProgressThreshold(previous: number, next: number, threshold: number): boolean {
  return previous < threshold && next >= threshold;
}

export function ruleMatches(rule: AutomationRuleLike, event: AutomationEvent): boolean {
  if (!rule.enabled || (event.depth ?? 0) > 0 || rule.trigger_type !== event.type) return false;
  if (rule.trigger_type === "task_moved_to_stage") return !!event.taskId && rule.trigger_param === event.stageId;
  if (rule.trigger_type === "progress_reached") {
    const threshold = Number(rule.trigger_param);
    return Number.isFinite(threshold) && event.previousProgress !== undefined && event.progress !== undefined && crossedProgressThreshold(event.previousProgress, event.progress, threshold);
  }
  return rule.trigger_type === "milestone_done" || !!event.taskId;
}

export function isValidRuleCombination(trigger: TriggerType, action: ActionType): boolean {
  return action !== "assign_task_to" || trigger === "task_done" || trigger === "task_moved_to_stage";
}

interface StoredRule extends AutomationRuleLike {
  id: string;
  project_id: string;
  name: string;
  action_param_user: string | null;
  action_param_text: string | null;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export async function runAutomationRules(
  db: D1Database,
  actorId: string,
  projectId: string,
  events: AutomationEvent[],
): Promise<number> {
  const rules = await db.prepare("SELECT * FROM automation_rules WHERE project_id=? AND enabled=1 ORDER BY created_at")
    .bind(projectId).all<StoredRule>();
  let fired = 0;
  let createdTodo = false;
  for (const rule of rules.results) {
    const event = events.find((candidate) => ruleMatches(rule, candidate));
    if (!event) continue;
    if (rule.action_type === "notify_user" && rule.action_param_user) {
      await db.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)")
        .bind(id("noti"), rule.action_param_user, "automation", `自動化：${rule.name}`, rule.action_param_text || "規則已觸發。", `/projects/${projectId}${event.taskId ? `?task=${event.taskId}` : ""}`).run();
    } else if (rule.action_type === "assign_task_to" && rule.action_param_user && event.taskId) {
      await db.prepare("UPDATE tasks SET assignee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?")
        .bind(rule.action_param_user, event.taskId, projectId).run();
    } else if (rule.action_type === "create_todo_for" && rule.action_param_user) {
      await db.prepare("INSERT INTO todos (id,user_id,title,project_id) VALUES (?,?,?,?)")
        .bind(id("todo"), rule.action_param_user, rule.action_param_text || `處理自動化：${rule.name}`, projectId).run();
      createdTodo = true;
    } else if (rule.action_type === "log_update") {
      await db.prepare("INSERT INTO progress_updates (id,project_id,author_id,content,progress_snapshot) SELECT ?,?,?,?,progress FROM projects WHERE id=?")
        .bind(id("upd"), projectId, actorId, rule.action_param_text || `自動化規則「${rule.name}」已觸發`, projectId).run();
    } else continue;
    await db.prepare("INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,summary) VALUES (?,?,?,?,?,?)")
      .bind(id("audit"), actorId, "automation_fired", "automation_rule", rule.id, `觸發規則「${rule.name}」`).run();
    fired += 1;
  }
  if (createdTodo) await recomputeAutoProgress(db, projectId, actorId);
  return fired;
}
