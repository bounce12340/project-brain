import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatDate } from "../api";
import { Empty, Loading, PageHeader, ProgressBar, RiskBadge } from "../components/UI";
import type { Project } from "../types";

interface DashboardData {
  kpis: { active_projects: number; overdue_milestones: number; today_todos: number; week_updates: number };
  projects: Project[]; recent_updates: Array<{ id: string; project_id: string; project_name: string; author_name: string; content: string; created_at: string }>;
  charts: { group_status: Array<Record<string, string | number>>; clinical_enrollments: Array<{ record_date: string; count: number; project_name: string; target_n: number }>; bd_fees: Array<{ month: string; currency: string; total: number }> };
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { api<DashboardData>("/dashboard").then(setData); }, []);
  const clinical = useMemo(() => { let total = 0; return (data?.charts.clinical_enrollments ?? []).map((item) => ({ ...item, 累計收案: total += Number(item.count), 目標: item.target_n })); }, [data]);
  if (!data) return <Loading />;
  const cards = [["進行中專案", data.kpis.active_projects, "text-brand-700"], ["逾期里程碑", data.kpis.overdue_milestones, "text-red-600"], ["今日待辦", data.kpis.today_todos, "text-amber-600"], ["本週更新", data.kpis.week_updates, "text-emerald-600"]] as const;
  return <><PageHeader title="儀表板" description="所有數據都依您的專案可見權限即時彙整。" />
    <div data-tour="kpi" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, color]) => <div className="card" key={label}><p className="text-sm text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></div>)}</div>
    <div className="grid gap-6 lg:grid-cols-3"><section className="card lg:col-span-2"><h2 className="mb-4 font-bold">各組專案進度</h2><div className="space-y-4">{data.projects.length ? data.projects.map((project) => <Link to={`/projects/${project.id}`} className="block rounded-lg border border-slate-100 p-3 hover:border-brand-200" key={project.id}><div className="mb-2 flex justify-between gap-3"><span className="font-medium">{project.visibility === "private" && "🔒 "}{project.name}</span><span className="flex items-center gap-2 text-xs text-slate-500">{project.group_name}<RiskBadge level={project.risk_level} /></span></div><ProgressBar value={project.progress} /></Link>) : <Empty>目前沒有可見專案</Empty>}</div></section>
      <section className="card"><h2 className="mb-4 font-bold">最近動態</h2><div className="space-y-4">{data.recent_updates.map((item) => <Link to={`/projects/${item.project_id}`} className="block border-l-2 border-brand-200 pl-3" key={item.id}><p className="text-sm font-medium">{item.project_name}</p><p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.content}</p><p className="mt-1 text-xs text-slate-400">{item.author_name} · {formatDate(item.created_at, true)}</p></Link>)}</div></section>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-3"><ChartCard title="各組專案狀態"><ResponsiveContainer width="100%" height={250}><BarChart data={data.charts.group_status}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="group" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="active" name="進行中" stackId="a" fill="#4f46e5" /><Bar dataKey="paused" name="暫停" stackId="a" fill="#f59e0b" /><Bar dataKey="done" name="完成" stackId="a" fill="#10b981" /><Bar dataKey="archived" name="歸檔" stackId="a" fill="#94a3b8" /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="臨床收案累計 vs 目標"><ResponsiveContainer width="100%" height={250}><LineChart data={clinical}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="record_date" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="累計收案" stroke="#4f46e5" strokeWidth={2} /><Line type="monotone" dataKey="目標" stroke="#ef4444" strokeDasharray="4 4" /></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title="BD 費用月別"><ResponsiveContainer width="100%" height={250}><BarChart data={data.charts.bd_fees}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="total" name="費用" fill="#6366f1" /></BarChart></ResponsiveContainer></ChartCard></div>
  </>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="card"><h2 className="mb-4 font-bold">{title}</h2>{children}</section>; }
