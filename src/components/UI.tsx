import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gold-bright">{title}</h1>{description && <p className="mt-1 text-sm text-star-dim">{description}</p>}</div>{actions}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="flex items-center gap-3"><div className="energy-track"><div className={`energy-fill ${value >= 100 ? "is-complete" : ""}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div><span className="w-10 text-right text-sm font-semibold text-star">{value}%</span></div>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
export function ErrorBox({ message }: { message: string }) { return <div className="mb-4 border border-danger bg-void p-3 text-sm text-danger">{message}</div>; }
export function Loading() { return <div className="py-20 text-center text-star-dim">載入中…</div>; }

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return <span className="badge">未分析</span>;
  const style = level === "high" ? "risk-high" : level === "medium" ? "risk-medium" : "risk-low";
  const label = level === "high" ? "高風險" : level === "medium" ? "中風險" : "低風險";
  return <span className={`inline-flex px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  return <div className="space-y-2 text-sm leading-6">{lines.map((line, index) => {
    if (line.startsWith("### ")) return <h4 className="pt-2 font-semibold" key={index}>{inlineMarkdown(line.slice(4))}</h4>;
    if (line.startsWith("## ")) return <h3 className="pt-3 text-base font-bold" key={index}>{inlineMarkdown(line.slice(3))}</h3>;
    if (line.startsWith("# ")) return <h2 className="pt-3 text-lg font-bold" key={index}>{inlineMarkdown(line.slice(2))}</h2>;
    if (/^[-*] /.test(line)) return <div className="flex gap-2 pl-2" key={index}><span>•</span><span>{inlineMarkdown(line.slice(2))}</span></div>;
    return line ? <p key={index}>{inlineMarkdown(line)}</p> : <div className="h-1" key={index} />;
  })}</div>;
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>);
}
