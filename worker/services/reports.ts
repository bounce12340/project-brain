import { createId } from "./db";
import { llmChat } from "./llm";
import { previousTaipeiWeek } from "./time";

interface ReportProject {
  id: string;
  name: string;
  group_id: string;
  progress: number;
  status: string;
}

async function dataMarkdown(env: Env, start: string, end: string, scope: string): Promise<string> {
  const where = scope === "all" ? "" : " AND p.group_id = ?";
  const bind = <T>(sql: string) => scope === "all" ? env.DB.prepare(sql).bind(start, end) : env.DB.prepare(sql).bind(start, end, scope);
  const [projects, updates, tasks, enrollments, events, fees] = await Promise.all([
    scope === "all" ? env.DB.prepare("SELECT id,name,group_id,progress,status FROM projects WHERE status!='archived' ORDER BY name").all<ReportProject>() : env.DB.prepare("SELECT id,name,group_id,progress,status FROM projects WHERE status!='archived' AND group_id=? ORDER BY name").bind(scope).all<ReportProject>(),
    bind(`SELECT p.name,COUNT(*) AS count FROM progress_updates pu JOIN projects p ON p.id=pu.project_id WHERE date(pu.created_at) BETWEEN ? AND ?${where} GROUP BY p.id`).all<Record<string, unknown>>(),
    bind(`SELECT p.name,COUNT(*) AS count FROM tasks t JOIN stages s ON s.id=t.stage_id JOIN projects p ON p.id=t.project_id WHERE date(t.updated_at) BETWEEN ? AND ? AND (s.name LIKE '%完成%' OR s.name LIKE '%結案%')${where} GROUP BY p.id`).all<Record<string, unknown>>(),
    bind(`SELECT p.name,SUM(ce.count) AS count FROM clinical_enrollments ce JOIN projects p ON p.id=ce.project_id WHERE ce.record_date BETWEEN ? AND ?${where} GROUP BY p.id`).all<Record<string, unknown>>(),
    bind(`SELECT p.name,COUNT(*) AS count FROM bd_case_events e JOIN bd_cases bc ON bc.id=e.case_id JOIN projects p ON p.id=bc.project_id WHERE e.event_date BETWEEN ? AND ?${where} GROUP BY p.id`).all<Record<string, unknown>>(),
    bind(`SELECT p.name,f.currency,SUM(f.amount) AS total FROM bd_fees f JOIN projects p ON p.id=f.project_id WHERE f.fee_date BETWEEN ? AND ?${where} GROUP BY p.id,f.currency`).all<Record<string, unknown>>(),
  ]);
  const lines = [`# 專案週報（${start} ～ ${end}）`, "", "## 專案概況"];
  for (const project of projects.results) lines.push(`- ${project.name}：${project.progress}%（${project.status}）`);
  const section = (title: string, rows: Record<string, unknown>[], formatter: (row: Record<string, unknown>) => string) => {
    lines.push("", `## ${title}`);
    if (!rows.length) lines.push("- 本期無資料");
    else for (const row of rows) lines.push(`- ${formatter(row)}`);
  };
  section("進度更新", updates.results, (row) => `${row.name}：${row.count} 筆`);
  section("完成任務", tasks.results, (row) => `${row.name}：${row.count} 項`);
  section("臨床新增收案", enrollments.results, (row) => `${row.name}：${row.count} 人`);
  section("BD 案件事件", events.results, (row) => `${row.name}：${row.count} 筆`);
  section("BD 費用", fees.results, (row) => `${row.name}：${row.currency} ${Number(row.total).toLocaleString("zh-TW")}`);
  return lines.join("\n");
}

export async function regenerateWeeklyReports(env: Env, period = previousTaipeiWeek()): Promise<{ reports: number; ai_fallbacks: number }> {
  const groups = await env.DB.prepare("SELECT id,name FROM groups ORDER BY name").all<{ id: string; name: string }>();
  const scopes = [{ id: "all", name: "全公司" }, ...groups.results];
  let fallbacks = 0;
  for (const scope of scopes) {
    const raw = await dataMarkdown(env, period.start, period.end, scope.id);
    let content = raw;
    try {
      content = await llmChat(env, [
        { role: "system", content: "你是台灣醫藥代理商的專案管理助理。請以繁體中文整理週報，保留所有數字，分成成果、風險、下週重點，使用簡潔 Markdown。" },
        { role: "user", content: raw },
      ]);
    } catch (error) {
      fallbacks += 1;
      console.error(JSON.stringify({ message: "AI 週報失敗，使用純數據版", scope: scope.id, error: error instanceof Error ? error.message : String(error) }));
    }
    await env.DB.prepare("INSERT INTO ai_reports (id,period_start,period_end,scope,content_md) VALUES (?,?,?,?,?)").bind(createId("report"), period.start, period.end, scope.id, content).run();
  }
  const users = await env.DB.prepare("SELECT id FROM users WHERE is_active=1").all<{ id: string }>();
  if (users.results.length) await env.DB.batch(users.results.map((user) => env.DB.prepare("INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)").bind(createId("noti"), user.id, "weekly_report", "上週專案週報已產生", `${period.start} 至 ${period.end} 的專案週報已可查看。`, "/reports")));
  return { reports: scopes.length, ai_fallbacks: fallbacks };
}
