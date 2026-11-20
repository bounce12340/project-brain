import type { AuthUser, ProjectAccess } from "../types";

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

/**
 * 專案的存取資訊。專案屬於哪家公司，看專案組別（groups.company_id）。
 * 傳入 user 時，別家公司的專案一律當作不存在（回 null，路由回 404），不透露它存在。
 */
export async function getProjectAccess(db: D1Database, projectId: string, user?: Pick<AuthUser, "company_id">): Promise<ProjectAccess | null> {
  const project = await db.prepare("SELECT p.id, p.owner_id, p.group_id, p.visibility, g.company_id FROM projects p JOIN groups g ON g.id = p.group_id WHERE p.id = ?").bind(projectId).first<Omit<ProjectAccess, "member_ids">>();
  if (!project) return null;
  if (user && project.company_id !== user.company_id) return null;
  const members = await db.prepare("SELECT user_id FROM project_members WHERE project_id = ?").bind(projectId).all<{ user_id: string }>();
  return { ...project, member_ids: members.results.map((row) => row.user_id) };
}

export async function touchProject(db: D1Database, projectId: string): Promise<void> {
  await db.prepare("UPDATE projects SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId).run();
}

export async function writeAudit(
  db: D1Database,
  user: AuthUser,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
): Promise<void> {
  await db.prepare("INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(createId("audit"), user.id, action, entityType, entityId, summary).run();
}
