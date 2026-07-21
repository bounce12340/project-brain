import type { NotificationItem } from "../types";
import { createId } from "./db";
import { sendMail } from "./mailer";
import { groupEmailNotifications } from "./reminders";
import { taipeiDate } from "./time";

interface Recipient { id: string; email: string; email_notifications: number }
interface ReminderSource { project_id: string; project_name: string; owner_id: string; group_id: string }

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function projectRecipients(db: D1Database, source: ReminderSource, sameGroup = false): Promise<Recipient[]> {
  const query = sameGroup
    ? "SELECT DISTINCT id,email,email_notifications FROM users WHERE is_active=1 AND (id=? OR group_id=?)"
    : "SELECT DISTINCT u.id,u.email,u.email_notifications FROM users u LEFT JOIN project_members pm ON pm.user_id=u.id AND pm.project_id=? WHERE u.is_active=1 AND (u.id=? OR pm.project_id=?)";
  const result = sameGroup
    ? await db.prepare(query).bind(source.owner_id, source.group_id).all<Recipient>()
    : await db.prepare(query).bind(source.project_id, source.owner_id, source.project_id).all<Recipient>();
  return result.results;
}

export async function runDailyReminders(env: Env): Promise<{ notifications: number; emails: number; archived: number }> {
  const today = taipeiDate();
  const next3 = addDays(today, 3);
  const next7 = addDays(today, 7);
  const staleProjectAt = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const staleCaseDate = addDays(today, -14);
  const notifications: NotificationItem[] = [];
  const addFor = async (source: ReminderSource, title: string, body: string, sameGroup = false) => {
    for (const recipient of await projectRecipients(env.DB, source, sameGroup)) notifications.push({ user_id: recipient.id, email: recipient.email_notifications ? recipient.email : "", title, body, link: `/projects/${source.project_id}` });
  };
  const milestones = await env.DB.prepare(`SELECT m.title,m.due_date,p.id AS project_id,p.name AS project_name,p.owner_id,p.group_id FROM milestones m JOIN projects p ON p.id=m.project_id WHERE m.done=0 AND m.due_date<=? AND p.status!='archived'`).bind(next3).all<ReminderSource & { title: string; due_date: string }>();
  for (const row of milestones.results) await addFor(row, row.due_date < today ? "里程碑已逾期" : "里程碑即將到期", `${row.project_name}：${row.title}（${row.due_date}）`);

  const todos = await env.DB.prepare("SELECT t.user_id,t.title,t.due_date,u.email,u.email_notifications FROM todos t JOIN users u ON u.id=t.user_id WHERE t.done=0 AND t.due_date<=? AND u.is_active=1").bind(today).all<{ user_id: string; title: string; due_date: string; email: string; email_notifications: number }>();
  for (const row of todos.results) notifications.push({ user_id: row.user_id, email: row.email_notifications ? row.email : "", title: row.due_date < today ? "待辦事項已逾期" : "待辦事項今日到期", body: `${row.title}（${row.due_date}）`, link: "/todos" });

  const approvals = await env.DB.prepare("SELECT bc.case_name,bc.expected_approval,p.id AS project_id,p.name AS project_name,p.owner_id,p.group_id FROM bd_cases bc JOIN projects p ON p.id=bc.project_id WHERE bc.expected_approval BETWEEN ? AND ? AND bc.current_status NOT IN ('核准','結案')").bind(today, next7).all<ReminderSource & { case_name: string; expected_approval: string }>();
  for (const row of approvals.results) await addFor(row, "BD 預計核准日將近", `${row.project_name}／${row.case_name}：${row.expected_approval}`, true);

  const stalledCases = await env.DB.prepare(`SELECT bc.case_name,p.id AS project_id,p.name AS project_name,p.owner_id,p.group_id,MAX(e.event_date) AS last_event FROM bd_cases bc JOIN projects p ON p.id=bc.project_id LEFT JOIN bd_case_events e ON e.case_id=bc.id WHERE bc.current_status='補件中' GROUP BY bc.id HAVING last_event IS NULL OR last_event<?`).bind(staleCaseDate).all<ReminderSource & { case_name: string }>();
  for (const row of stalledCases.results) await addFor(row, "BD 補件案件停滯", `${row.project_name}／${row.case_name} 已超過 14 天無歷程更新。`, true);

  const stalledProjects = await env.DB.prepare("SELECT id AS project_id,name AS project_name,owner_id,group_id FROM projects WHERE status='active' AND last_activity_at<?").bind(staleProjectAt).all<ReminderSource>();
  for (const row of stalledProjects.results) await addFor(row, "專案停滯", `${row.project_name} 已超過 21 天無更新。`, true);

  const archiveAt = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const archiveRows = await env.DB.prepare("SELECT id AS project_id,name AS project_name,owner_id,group_id FROM projects WHERE status='done' AND auto_archive=1 AND last_activity_at<?").bind(archiveAt).all<ReminderSource>();
  if (archiveRows.results.length) await env.DB.batch(archiveRows.results.map((row) => env.DB.prepare("UPDATE projects SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.project_id)));
  for (const row of archiveRows.results) await addFor(row, "專案已自動歸檔", `${row.project_name} 完成超過 14 天，已自動歸檔。`);

  if (notifications.length) await env.DB.batch(notifications.map((item) => env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)").bind(createId("noti"), item.user_id, "daily_reminder", item.title, item.body, item.link)));
  let sent = 0;
  for (const digest of groupEmailNotifications(notifications.filter((item) => item.email))) {
    const text = [`今日共有 ${digest.items.length} 則提醒：`, "", ...digest.items.map((item) => `- ${item.title}：${item.body}\n  ${env.APP_BASE_URL}${item.link}`), "", `開啟專案進度大腦：${env.APP_BASE_URL}`].join("\n");
    const result = await sendMail(env, digest.email, "[專案進度大腦] 今日提醒", text);
    if (result.sent) sent += 1;
  }
  return { notifications: notifications.length, emails: sent, archived: archiveRows.results.length };
}
