import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "../chartTheme";
import { useT } from "../i18n/LangContext";

/**
 * 只有臨床組專案的「臨床」分頁會用到這張圖。先前 ProjectDetailPage 靜態 import recharts，
 * 使每一次開啟任何專案都要先下載並解析 gzip 約 107KB 的圖表庫——即使該專案根本沒有臨床分頁。
 */
export default function EnrollmentChart({ data }: { data: Array<{ date: string; 累計收案: number; 目標: number }> }) {
  const t = useT();
  return <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <CartesianGrid stroke={CHART.line} strokeDasharray="3 3" />
      <XAxis dataKey="date" tick={{ fill: CHART.starDim }} />
      <YAxis tick={{ fill: CHART.starDim }} />
      <Tooltip />
      <Legend />
      <Line name={t("dashboard.enrollment")} dataKey="累計收案" stroke={CHART.psi} strokeWidth={3} />
      <Line name={t("dashboard.target")} dataKey="目標" stroke={CHART.gold} strokeDasharray="4 4" />
    </LineChart>
  </ResponsiveContainer>;
}
