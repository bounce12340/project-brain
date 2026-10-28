import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, HealthBadge, Loading, PageHeader, ProgressBar, RiskBadge, StatusStamp } from "../components/UI";
import { useT } from "../i18n/LangContext";
import { HEALTH_BUCKETS, healthBucket, portfolioCsv, sortPortfolio, type HealthBucket, type PortfolioRow, type PortfolioSort } from "../portfolio";

const BUCKET_KEY = { on_track: "health.onTrack", at_risk: "health.atRisk", off_track: "health.offTrack", stale: "health.stale", none: "portfolio.noHealth" } as const;
const BUCKET_DOT: Record<HealthBucket, string> = { on_track: "bg-ok", at_risk: "bg-warn", off_track: "bg-danger", stale: "bg-star-dim", none: "border border-star-dim" };
const STATUS_FILTERS = { ongoing: ["active", "paused"], active: ["active"], paused: ["paused"], done: ["done"], all: ["active", "paused", "done", "archived"] } as const;

/**
 * 專案總覽（像 Asana 的 Portfolio）：所有看得到的專案一張表。上方是各燈號的專案數，點一下就篩選；
 * 表頭可以排序；可匯出 CSV。燈號、進度、逾期、目標日一眼看完，不必一個一個點進去。
 */
export function PortfolioPage() {
  const t = useT();
  const { user } = useAuth();
  const [data, setData] = useState<{ projects: PortfolioRow[]; today: string } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<keyof typeof STATUS_FILTERS>("ongoing");
  const [group, setGroup] = useState("");
  const [bucket, setBucket] = useState<HealthBucket | "">("");
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<{ key: PortfolioSort; desc: boolean }>({ key: "health", desc: false });
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    void api<{ projects: PortfolioRow[]; today: string }>("/portfolio").then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("error.load")));
    void api<{ groups: Array<{ id: string; name: string }> }>("/metadata").then((meta) => setAllGroups(meta.groups)).catch(() => undefined);
  }, []);

  const base = useMemo(() => (data?.projects ?? []).filter((row) => (STATUS_FILTERS[status] as readonly string[]).includes(row.status) && (!group || row.group_id === group) && (!mine || row.owner_id === user?.id)), [data, status, group, mine, user?.id]);
  const counts = useMemo(() => Object.fromEntries(HEALTH_BUCKETS.map((key) => [key, base.filter((row) => healthBucket(row) === key).length])) as Record<HealthBucket, number>, [base]);
  const rows = useMemo(() => sortPortfolio(base.filter((row) => !bucket || healthBucket(row) === bucket), sort.key, sort.desc), [base, bucket, sort]);
  // 管理員建的組別全部列出（剛建、還沒有專案的也選得到），再補上專案上出現的組別。
  const groups = useMemo(() => [...new Map([...allGroups.map((group) => [group.id, group.name] as const), ...(data?.projects ?? []).map((row) => [row.group_id, row.group_name] as const)]).entries()].sort((a, b) => a[1].localeCompare(b[1], "zh-Hant")), [data, allGroups]);

  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const today = data.today;
  const header = (key: PortfolioSort, label: string, className = "") => <th className={`py-2 pr-3 ${className}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
    <button type="button" className="font-semibold hover:text-star" onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }))}>{label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}</button>
  </th>;
  const exportCsv = () => {
    const headers = [t("portfolio.project"), t("reports.group"), t("health.pick"), t("portfolio.status"), t("reports.progress"), t("pdash.target"), t("portfolio.owner"), t("portfolio.tasks"), t("pdash.overdue"), t("portfolio.lastUpdate")];
    const content = portfolioCsv(rows, headers, { health: (row) => t(BUCKET_KEY[healthBucket(row)]), status: (row) => t(`status.${row.status}`) });
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `portfolio-${today}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <>
    <PageHeader title={t("portfolio.title")} description={t("portfolio.description")} actions={<button className="btn-secondary" disabled={!rows.length} onClick={exportCsv}>{t("portfolio.export")}</button>} />
    {error && <ErrorBox message={error} />}
    <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label={t("portfolio.healthFilter")}>
      {HEALTH_BUCKETS.map((key) => <button key={key} type="button" aria-pressed={bucket === key} onClick={() => setBucket(bucket === key ? "" : key)}
        className={`panel !p-4 text-left transition-colors ${bucket === key ? "!border-psi ring-2 ring-psi/40" : "hover:!border-gold"}`}>
        <span className="flex items-center gap-2 text-xs text-star-dim"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${BUCKET_DOT[key]}`} />{t(BUCKET_KEY[key])}</span>
        <span className={`mt-1 block font-serif text-3xl font-bold ${key === "off_track" && counts[key] ? "text-danger" : key === "at_risk" && counts[key] ? "text-warn" : ""}`}>{counts[key]}</span>
      </button>)}
    </div>
    <div className="panel">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select aria-label={t("portfolio.status")} value={status} onChange={(event) => setStatus(event.target.value as keyof typeof STATUS_FILTERS)}>
          {(Object.keys(STATUS_FILTERS) as Array<keyof typeof STATUS_FILTERS>).map((key) => <option key={key} value={key}>{t(`portfolio.filter.${key}`)}</option>)}
        </select>
        <select aria-label={t("reports.group")} value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">{t("dashboard.allGroups")}</option>
          {groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />{t("portfolio.mine")}</label>
        {bucket && <button type="button" className="text-sm text-psi hover:text-star" onClick={() => setBucket("")}>{t("portfolio.clearHealth", { label: t(BUCKET_KEY[bucket]) })}</button>}
        <span className="ml-auto text-xs text-star-dim">{t("portfolio.count", { count: rows.length })}</span>
      </div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
        <thead><tr className="border-b border-nexus-line text-gold-bright">
          {header("name", t("portfolio.project"))}{header("health", t("health.pick"))}<th className="py-2 pr-3">{t("portfolio.status")}</th>
          {header("progress", t("reports.progress"), "w-40")}{header("target_date", t("pdash.target"))}{header("owner", t("portfolio.owner"))}
          {header("overdue", t("portfolio.tasks"))}<th className="py-2 pr-3">{t("project.aiRisk")}</th>{header("last_update", t("portfolio.lastUpdate"))}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-nexus-line align-middle hover:bg-nexus-raised">
          <td className="py-3 pr-3"><Link className="font-semibold hover:text-psi" to={`/projects/${row.id}`}>{row.visibility === "private" && "🔒 "}{row.name}</Link><span className="mt-0.5 block text-xs text-star-dim">{row.group_name}{row.product ? ` · ${row.product}` : ""}</span></td>
          <td className="pr-3">{row.health ? <HealthBadge health={row.health} at={row.health_at} /> : <span className="text-xs text-star-dim">{t("portfolio.noHealth")}</span>}</td>
          <td className="pr-3"><StatusStamp status={row.status} /></td>
          <td className="pr-3"><ProgressBar value={row.progress} /></td>
          <td className={`pr-3 font-mono text-xs ${row.target_date && row.target_date < today && (row.status === "active" || row.status === "paused") ? "font-semibold text-danger" : "text-star-dim"}`}>{row.target_date ?? "—"}</td>
          <td className="pr-3">{row.owner_name}</td>
          <td className="pr-3 text-xs"><span>{row.task_done}/{row.task_total}</span>{row.task_overdue > 0 && <span className="ml-2 font-semibold text-danger">{t("portfolio.overdueCount", { count: row.task_overdue })}</span>}</td>
          <td className="pr-3"><RiskBadge level={row.risk_level} /></td>
          <td className="font-mono text-xs text-star-dim">{row.last_update_at?.slice(0, 10) ?? "—"}</td>
        </tr>)}</tbody>
      </table></div> : <Empty>{t("portfolio.empty")}</Empty>}
    </div>
  </>;
}
