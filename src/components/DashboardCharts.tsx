import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "../chartTheme";
import { useT } from "../i18n/LangContext";

interface Props {
  groupStatus: Array<Record<string, string | number>>;
  clinical: Array<{ record_date: string; enrollment: number; target: number }>;
  bdFees: Array<{ month: string; currency: string; total: number }>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2 className="mb-4 font-bold">{title}</h2>{children}</section>;
}

/**
 * recharts 是最大的 chunk（gzip 約 107KB），靜態 import 會擋住儀表板上半部的 KPI 卡。
 * 圖表在畫面下半部，因此獨立成一個 lazy chunk，讓 KPI 先顯示。
 */
export default function DashboardCharts({ groupStatus, clinical, bdFees }: Props) {
  const t = useT();
  return <div className="mt-6 grid gap-6 lg:grid-cols-3">
    <ChartCard title={t("dashboard.groupStatus")}><ResponsiveContainer width="100%" height={250}><BarChart data={groupStatus}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="group" tick={{ fill: CHART.starDim }} /><YAxis allowDecimals={false} tick={{ fill: CHART.starDim }} /><Tooltip /><Legend /><Bar dataKey="active" name={t("status.active")} stackId="a" fill={CHART.psi} /><Bar dataKey="paused" name={t("status.paused")} stackId="a" fill={CHART.gold} /><Bar dataKey="done" name={t("status.done")} stackId="a" fill={CHART.ok} /><Bar dataKey="archived" name={t("status.archived")} stackId="a" fill={CHART.warn} /></BarChart></ResponsiveContainer></ChartCard>
    <ChartCard title={t("dashboard.clinicalChart")}><ResponsiveContainer width="100%" height={250}><LineChart data={clinical}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="record_date" tick={{ fill: CHART.starDim }} /><YAxis tick={{ fill: CHART.starDim }} /><Tooltip /><Legend /><Line name={t("dashboard.enrollment")} type="monotone" dataKey="enrollment" stroke={CHART.psi} strokeWidth={2} /><Line name={t("dashboard.target")} type="monotone" dataKey="target" stroke={CHART.gold} strokeDasharray="4 4" /></LineChart></ResponsiveContainer></ChartCard>
    <ChartCard title={t("dashboard.bdFees")}><ResponsiveContainer width="100%" height={250}><BarChart data={bdFees}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fill: CHART.starDim }} /><YAxis tick={{ fill: CHART.starDim }} /><Tooltip /><Bar dataKey="total" name={t("dashboard.fees")} fill={CHART.psi} /></BarChart></ResponsiveContainer></ChartCard>
  </div>;
}
