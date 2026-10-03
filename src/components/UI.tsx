import type { ReactNode } from "react";
import { translateBackendError } from "../i18n/errors";
import { useT } from "../i18n/LangContext";
import { markdownBlocks } from "../markdown";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gold-bright">{title}</h1>{description && <p className="mt-1 text-sm text-star-dim">{description}</p>}</div>{actions}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="flex items-center gap-3"><div className="energy-track"><div className={`energy-fill ${value >= 100 ? "is-complete" : ""}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div><span className="w-10 text-right text-sm font-semibold text-star">{value}%</span></div>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
export function ErrorBox({ message }: { message: string }) { const t = useT(); return <div className="mb-4 rounded-card border border-danger bg-void p-3 text-sm text-danger">{translateBackendError(message, t)}</div>; }
export function Loading() { const t = useT(); return <div className="py-20 text-center text-star-dim">{t("common.loading")}</div>; }

/** 專案狀態蓋成章：進行中是墨色、暫停琥珀、完成綠、歸檔淡墨。 */
export function StatusStamp({ status }: { status: "active" | "paused" | "done" | "archived" }) {
  const t = useT();
  const tone = { active: "stamp-ink", paused: "stamp-amber", done: "stamp-green", archived: "stamp-faint" }[status];
  return <span className={`stamp ${tone}`}>{t(`status.${status}`)}</span>;
}

export function RiskBadge({ level }: { level?: string | null }) {
  const t = useT();
  // 還沒分析就不蓋章——章代表有結論。
  if (!level) return <span className="text-xs text-star-dim">{t("risk.unanalyzed")}</span>;
  const style = level === "high" ? "risk-high" : level === "medium" ? "risk-medium" : "risk-low";
  const label = level === "high" ? t("risk.high") : level === "medium" ? t("risk.medium") : t("risk.low");
  return <span className={style}>{label}</span>;
}

export function Markdown({ content }: { content: string }) {
  const indent = (depth: number) => ({ paddingLeft: `${0.5 + depth * 1.25}rem` });
  return <div className="space-y-2 text-sm leading-6">{markdownBlocks(content).map((block, index) => {
    if (block.kind === "heading") {
      if (block.level === 3) return <h4 className="pt-2 font-semibold" key={index}>{inlineMarkdown(block.text)}</h4>;
      if (block.level === 2) return <h3 className="pt-3 text-base font-bold" key={index}>{inlineMarkdown(block.text)}</h3>;
      return <h2 className="pt-3 text-lg font-bold" key={index}>{inlineMarkdown(block.text)}</h2>;
    }
    if (block.kind === "bullet") return <div className="flex gap-2" style={indent(block.depth)} key={index}><span>{block.depth ? "◦" : "•"}</span><span>{inlineMarkdown(block.text)}</span></div>;
    if (block.kind === "numbered") return <div className="flex gap-2" style={indent(block.depth)} key={index}><span className="tabular-nums">{block.number}.</span><span>{inlineMarkdown(block.text)}</span></div>;
    return block.kind === "paragraph" ? <p key={index}>{inlineMarkdown(block.text)}</p> : <div className="h-1" key={index} />;
  })}</div>;
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>);
}
