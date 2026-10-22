import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useLang, useT } from "../i18n/LangContext";
import { MarkdownInline, RiskBadge } from "./UI";

/** 一次同時分析幾個專案：太多會讓語言模型排隊逾時，一個一個又太慢。 */
export const RISK_REVIEW_CONCURRENCY = 2;

interface Target { id: string; name: string }
interface Result { id: string; name: string; level?: "low" | "medium" | "high"; summary?: string; suggestions?: string[]; fallback?: boolean; error?: string }
const ORDER = { high: 0, medium: 1, low: 2 } as const;

/** 高風險排最前面，失敗的放最後；同一級依原本順序。 */
export const sortReview = <T extends { level?: keyof typeof ORDER; error?: string }>(results: T[]): T[] =>
  results.map((result, index) => ({ result, index }))
    .sort((a, b) => (a.result.error ? 9 : ORDER[a.result.level ?? "low"]) - (b.result.error ? 9 : ORDER[b.result.level ?? "low"]) || a.index - b.index)
    .map(({ result }) => result);

/**
 * 一鍵請 AI 審視「我負責的」全部專案的風險。由瀏覽器逐一呼叫既有的單一專案分析端點：
 * 每個專案是獨立的請求，不受單次請求的子請求上限影響，權限與寫回也和專案頁的「重新分析」完全相同。
 */
export function RiskReview({ projects, onDone }: { projects: Target[]; onDone(): void }) {
  const t = useT(); const { lang } = useLang();
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const stop = useRef(false);

  const start = async () => {
    if (running || !projects.length) return;
    if (!window.confirm(t("riskReview.confirm", { count: projects.length }))) return;
    stop.current = false; setRunning(true); setDone(0); setResults([]);
    const queue = [...projects];
    const worker = async () => {
      for (let next = queue.shift(); next && !stop.current; next = queue.shift()) {
        const target = next;
        let result: Result;
        try {
          const data = await api<{ level: Result["level"]; summary: string; suggestions: string[]; fallback?: boolean }>("/ai/project-risk", { method: "POST", body: JSON.stringify({ project_id: target.id, lang }) });
          result = { ...target, level: data.level, summary: data.summary, suggestions: data.suggestions, fallback: data.fallback };
        } catch (cause) {
          result = { ...target, error: cause instanceof Error ? cause.message : t("error.operation") };
        }
        setResults((current) => [...(current ?? []), result]);
        setDone((count) => count + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(RISK_REVIEW_CONCURRENCY, queue.length) }, worker));
    setRunning(false);
    onDone(); // 儀表板上的風險章跟著更新
  };

  const shown = results ? sortReview(results) : [];
  const count = (level: Result["level"]) => shown.filter((result) => !result.error && result.level === level).length;
  const failed = shown.filter((result) => result.error).length;

  return <section className="panel mb-6" aria-labelledby="risk-review-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="risk-review-title" className="font-bold">{t("riskReview.title")}</h2>
        <p className="mt-1 text-sm text-star-dim">{t("riskReview.description", { count: projects.length })}</p>
      </div>
      {running
        ? <div className="flex items-center gap-3"><span className="text-sm text-star-dim" role="status">{t("riskReview.progress", { done, total: projects.length })}</span><button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => { stop.current = true; }}>{t("riskReview.stop")}</button></div>
        : <button className="btn" disabled={!projects.length} onClick={() => void start()}>{t(results ? "riskReview.again" : "riskReview.start", { count: projects.length })}</button>}
    </div>
    {running && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-nexus-line"><div className="h-full bg-psi transition-all" style={{ width: `${projects.length ? (done / projects.length) * 100 : 0}%` }} /></div>}
    {results && results.length > 0 && <>
      {!running && <p className="mt-4 text-sm font-semibold" role="status">{t("riskReview.summary", { high: count("high"), medium: count("medium"), low: count("low") })}{failed > 0 && <span className="text-danger">{t("riskReview.failed", { count: failed })}</span>}{stop.current && done < projects.length && <span className="text-star-dim">{t("riskReview.stopped", { count: projects.length - done })}</span>}</p>}
      <ul className="mt-3 space-y-3">{shown.map((result) => <li key={result.id} className={`rounded-card border border-l-4 bg-nexus-raised p-3 ${result.error ? "border-danger" : result.level === "high" ? "border-l-danger" : result.level === "medium" ? "border-l-warn" : "border-l-ok"} border-nexus-line`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link className="font-serif font-semibold hover:text-psi" to={`/projects/${result.id}`}>{result.name}</Link>
          {result.error ? <span className="text-xs text-danger">{t("riskReview.error")}</span> : <span className="flex items-center gap-2">{result.fallback && <span className="text-xs text-star-dim">{t("riskReview.ruleBased")}</span>}<RiskBadge level={result.level} /></span>}
        </div>
        {result.error ? <p className="mt-1 text-sm text-danger">{result.error}</p> : <>
          {result.summary && <p className="mt-1 text-sm"><MarkdownInline text={result.summary} /></p>}
          {result.suggestions && result.suggestions.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-star-dim">{result.suggestions.slice(0, 3).map((item, index) => <li key={index}><MarkdownInline text={item} /></li>)}</ul>}
        </>}
      </li>)}</ul>
    </>}
  </section>;
}
