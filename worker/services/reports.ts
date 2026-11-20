import type { AuthUser } from "../types";
import { createId } from "./db";
import { llmChat } from "./llm";
import { previousTaipeiMonth, previousTaipeiWeek } from "./time";

export type ReportPeriodType = "week" | "month";
type ReportActor = Pick<AuthUser, "id" | "role" | "group_id">;
type ReportAccess = { scope: string; include_private: number; owner_user_id?: string | null };

/** 個人報告的 scope：只含「我是擁有者或成員」的專案，只有產生者本人（及同公司管理員）能讀。 */
export const MINE_SCOPE = "mine";
type ReportProjectAccess = { group_id: string; visibility: string };

interface ReportProject extends ReportProjectAccess {
  id: string;
  name: string;
  progress: number;
  status: string;
}

export interface GenerateReportInput {
  /** 報告屬於哪家公司：內容只含這家公司（專案的組別所屬公司）的專案。 */
  companyId: string;
  start: string;
  end: string;
  scope: string;
  periodType: ReportPeriodType;
  includePrivate?: boolean;
  /** scope 為 mine 時必填：報告屬於哪位使用者。 */
  ownerUserId?: string;
}

export function reportProjectVisible(project: ReportProjectAccess, scope: string, includePrivate: boolean): boolean {
  return (scope === "all" || project.group_id === scope) && (includePrivate || project.visibility !== "private");
}

export function canGenerateReport(user: ReportActor, scope: string, includePrivate: boolean): boolean {
  if (user.role === "admin") return true;
  // 個人報告只含自己參與的專案，任何角色都能產；不能要求含保密專案。
  if (scope === MINE_SCOPE) return !includePrivate;
  // 實習生只看得到被邀進去的專案，組別報告會帶出他看不到的同組專案，所以一律不能產組別／全公司報告。
  if (user.role === "intern") return false;
  return scope !== "all" && scope === user.group_id && !includePrivate;
}

export function canReadReport(user: ReportActor, report: ReportAccess): boolean {
  if (user.role === "admin") return true;
  // 個人報告只有本人讀得到（舊資料沒有 owner 的一律拒絕）。
  if (report.scope === MINE_SCOPE) return Boolean(report.owner_user_id) && report.owner_user_id === user.id;
  if (user.role === "intern") return false;
  return report.include_private === 0 && report.scope !== "all" && report.scope === user.group_id;
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(",");
}

export async function dataMarkdown(env: Env, input: GenerateReportInput): Promise<string> {
  const allProjects = await env.DB.prepare("SELECT p.id,p.name,p.group_id,p.progress,p.status,p.visibility FROM projects p JOIN groups g ON g.id=p.group_id WHERE p.status!='archived' AND g.company_id=? ORDER BY p.name")
    .bind(input.companyId).all<ReportProject>();
  let projects: ReportProject[];
  if (input.scope === MINE_SCOPE) {
    // 個人報告：只取我是擁有者或成員的專案（這些必然是 canViewProject 允許的），不看可見性，也絕不含我不在內的專案。
    if (!input.ownerUserId) throw new Error("個人報告需要指定擁有者");
    const mine = await env.DB.prepare("SELECT p.id FROM projects p JOIN groups g ON g.id=p.group_id WHERE g.company_id=? AND (p.owner_id=? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?))")
      .bind(input.companyId, input.ownerUserId, input.ownerUserId).all<{ id: string }>();
    const ids = new Set(mine.results.map((row) => row.id));
    projects = allProjects.results.filter((project) => ids.has(project.id));
  } else {
    projects = allProjects.results.filter((project) => reportProjectVisible(project, input.scope, !!input.includePrivate));
  }
  const periodName = input.periodType === "month" ? "月報" : "週報";
  const lines = [`# 專案${periodName}（${input.start} ～ ${input.end}）`, "", "## 專案進度變化"];
  if (!projects.length) {
    lines.push("- 本期無符合範圍的專案");
  } else {
    const ids = projects.map((project) => project.id);
    const marks = placeholders(ids.length);
    const [updates, tasks, keyResults, enrollments, events, fees, overdueTasks, overdueMilestones] = await Promise.all([
      env.DB.prepare(`SELECT pu.project_id,pu.content,pu.progress_snapshot,pu.created_at FROM progress_updates pu WHERE date(pu.created_at) BETWEEN ? AND ? AND pu.project_id IN (${marks}) ORDER BY pu.project_id,pu.created_at`).bind(input.start, input.end, ...ids).all<{ project_id: string; content: string; progress_snapshot: number | null; created_at: string }>(),
      env.DB.prepare(`SELECT t.project_id,t.title,t.done_at FROM tasks t WHERE t.done=1 AND date(t.done_at) BETWEEN ? AND ? AND t.project_id IN (${marks}) ORDER BY t.done_at`).bind(input.start, input.end, ...ids).all<{ project_id: string; title: string; done_at: string }>(),
      env.DB.prepare(`SELECT kr.project_id,kr.title,kr.updated_at FROM key_results kr WHERE kr.status='完成' AND date(kr.updated_at) BETWEEN ? AND ? AND kr.project_id IN (${marks}) ORDER BY kr.updated_at`).bind(input.start, input.end, ...ids).all<{ project_id: string; title: string; updated_at: string }>(),
      env.DB.prepare(`SELECT ce.project_id,SUM(ce.count) AS count FROM clinical_enrollments ce WHERE ce.record_date BETWEEN ? AND ? AND ce.project_id IN (${marks}) GROUP BY ce.project_id`).bind(input.start, input.end, ...ids).all<{ project_id: string; count: number }>(),
      env.DB.prepare(`SELECT bc.project_id,e.event_type,COUNT(*) AS count FROM bd_case_events e JOIN bd_cases bc ON bc.id=e.case_id WHERE e.event_date BETWEEN ? AND ? AND bc.project_id IN (${marks}) GROUP BY bc.project_id,e.event_type`).bind(input.start, input.end, ...ids).all<{ project_id: string; event_type: string; count: number }>(),
      env.DB.prepare(`SELECT f.project_id,f.currency,SUM(f.amount) AS total FROM bd_fees f WHERE f.fee_date BETWEEN ? AND ? AND f.project_id IN (${marks}) GROUP BY f.project_id,f.currency`).bind(input.start, input.end, ...ids).all<{ project_id: string; currency: string; total: number }>(),
      env.DB.prepare(`SELECT project_id,title,due_date FROM tasks WHERE done=0 AND due_date<? AND project_id IN (${marks}) ORDER BY due_date`).bind(input.end, ...ids).all<{ project_id: string; title: string; due_date: string }>(),
      env.DB.prepare(`SELECT project_id,title,COALESCE(end_date, due_date) AS due_date FROM milestones WHERE kind='milestone' AND done=0 AND COALESCE(end_date, due_date)<? AND project_id IN (${marks}) ORDER BY 3`).bind(input.end, ...ids).all<{ project_id: string; title: string; due_date: string }>(),
    ]);
    const projectName = new Map(projects.map((project) => [project.id, project.name]));
    for (const project of projects) {
      const projectUpdates = updates.results.filter((row) => row.project_id === project.id);
      const snapshots = projectUpdates.map((row) => row.progress_snapshot).filter((value): value is number => value !== null);
      const change = snapshots.length > 1 ? snapshots.at(-1)! - snapshots[0] : 0;
      lines.push(`- ${project.name}：目前 ${project.progress}%（本期 ${change >= 0 ? "+" : ""}${change}%）`);
    }
    const section = (title: string, rows: string[]) => {
      lines.push("", `## ${title}`, ...(rows.length ? rows.map((row) => `- ${row}`) : ["- 本期無資料"]));
    };
    section("進度更新摘要", updates.results.map((row) => `${projectName.get(row.project_id)}：${row.content.replace(/\s+/g, " ").slice(0, 180)}`));
    section("完成任務與 KR", [
      ...tasks.results.map((row) => `${projectName.get(row.project_id)}完成任務「${row.title}」`),
      ...keyResults.results.map((row) => `${projectName.get(row.project_id)}完成 KR「${row.title}」`),
    ]);
    section("臨床收案", enrollments.results.map((row) => `${projectName.get(row.project_id)}：新增 ${row.count} 人`));
    section("BD 案件事件", events.results.map((row) => `${projectName.get(row.project_id)}：${row.event_type} ${row.count} 筆`));
    section("BD 費用小計", fees.results.map((row) => `${projectName.get(row.project_id)}：${row.currency} ${Number(row.total).toLocaleString("zh-TW")}`));
    section("逾期警示", [
      ...overdueTasks.results.map((row) => `${projectName.get(row.project_id)}任務「${row.title}」已於 ${row.due_date} 到期`),
      ...overdueMilestones.results.map((row) => `${projectName.get(row.project_id)}里程碑「${row.title}」已於 ${row.due_date} 到期`),
    ]);
  }
  lines.push("", "---", input.scope === MINE_SCOPE ? "本報告僅含您參與的專案，僅限本人閱讀。" : input.includePrivate ? "本報告含保密專案，僅限管理員閱讀。" : "保密專案未納入");
  return lines.join("\n");
}

export async function generateReport(env: Env, input: GenerateReportInput): Promise<{ id: string; content_md: string; fallback: boolean }> {
  const raw = await dataMarkdown(env, input);
  const periodName = input.periodType === "month" ? "月報" : "週報";
  const privacyNote = input.scope === MINE_SCOPE ? "本報告僅含您參與的專案，僅限本人閱讀。" : input.includePrivate ? "本報告含保密專案，僅限管理員閱讀。" : "保密專案未納入";
  let content = raw;
  let fallback = false;
  try {
    content = await llmChat(env, [
      { role: "system", content: `你是台灣醫藥代理商的專案管理助理。請以繁體中文整理${periodName}，保留所有數字與專案名稱，分成成果、進度變化、風險、後續重點，使用簡潔 Markdown。不得加入輸入以外的專案或事實。` },
      { role: "user", content: raw },
    ]);
  } catch (error) {
    fallback = true;
    console.error(JSON.stringify({ message: `AI ${periodName}失敗，使用純數據版`, scope: input.scope, error: error instanceof Error ? error.message : String(error) }));
  }
  if (!content.trimEnd().endsWith(privacyNote)) content = `${content.trimEnd()}\n\n---\n${privacyNote}`;
  const id = createId("report");
  await env.DB.prepare("INSERT INTO ai_reports (id,period_start,period_end,scope,content_md,period_type,include_private,company_id,owner_user_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, input.start, input.end, input.scope, content, input.periodType, input.includePrivate ? 1 : 0, input.companyId, input.scope === MINE_SCOPE ? input.ownerUserId ?? null : null).run();
  return { id, content_md: content, fallback };
}

/** 啟用中的公司（排程用）；指定 companyIds 時只取其中的。 */
async function activeCompanyIds(env: Env, companyIds?: string[]): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT id FROM companies WHERE status='active' ORDER BY created_at, id").all<{ id: string }>();
  return rows.results.map((row) => row.id).filter((id) => !companyIds || companyIds.includes(id));
}

/** 每家公司各自產「全公司」與每個組別的報告；一家公司失敗不影響其他公司。 */
export async function regenerateReports(env: Env, periodType: ReportPeriodType, period: { start: string; end: string }, companyIds?: string[]): Promise<{ reports: number; ai_fallbacks: number }> {
  let reports = 0;
  let fallbacks = 0;
  for (const companyId of await activeCompanyIds(env, companyIds)) {
    try {
      const groups = await env.DB.prepare("SELECT id,name FROM groups WHERE company_id=? ORDER BY name").bind(companyId).all<{ id: string; name: string }>();
      for (const scope of ["all", ...groups.results.map((group) => group.id)]) {
        const report = await generateReport(env, { ...period, companyId, scope, periodType, includePrivate: false });
        reports += 1;
        if (report.fallback) fallbacks += 1;
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "公司報表產生失敗", company_id: companyId, period_type: periodType, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { reports, ai_fallbacks: fallbacks };
}

export async function regenerateWeeklyReports(env: Env, period = previousTaipeiWeek(), companyIds?: string[]): Promise<{ reports: number; ai_fallbacks: number }> {
  const result = await regenerateReports(env, "week", period, companyIds);
  // 週報通知只發給各公司自己的同仁。
  for (const companyId of await activeCompanyIds(env, companyIds)) {
    try {
      const users = await env.DB.prepare("SELECT u.id FROM users u JOIN groups g ON g.id=u.group_id WHERE u.is_active=1 AND u.role!='intern' AND g.company_id=?").bind(companyId).all<{ id: string }>();
      if (users.results.length) {
        await env.DB.batch(users.results.map((user) => env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)")
          .bind(createId("noti"), user.id, "weekly_report", "上週專案週報已產生", `${period.start} 至 ${period.end} 的專案週報已可查看。`, "/reports")));
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "公司週報通知失敗", company_id: companyId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return result;
}

export async function regenerateMonthlyReports(env: Env, period = previousTaipeiMonth(), companyIds?: string[]): Promise<{ reports: number; ai_fallbacks: number }> {
  return regenerateReports(env, "month", period, companyIds);
}
