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

/**
 * 空狀態：一句話說明這裡會放什麼。icon 與 action 都是選用的——
 * 使用者自己能補上內容的地方給一個動作（新增第一筆、清除篩選），其餘維持一句話。
 */
export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state">{icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}<div>{children}</div>{action && <div className="empty-state-action">{action}</div>}</div>;
}
/** 空狀態用的圖示：一個空的卷宗夾。 */
export function FolderIcon() { return <svg viewBox="0 0 24 24"><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7.5Z" /></svg>; }
/** 空狀態用的圖示：一張還沒勾的清單。 */
export function ChecklistIcon() { return <svg viewBox="0 0 24 24"><path d="M4 6.5 5.5 8 8 5.5M4 12.5 5.5 14 8 11.5M4 18.5 5.5 20 8 17.5M11.5 7H20M11.5 13H20M11.5 19H20" /></svg>; }
/** 空狀態用的圖示：還沒排上日期的行事曆。 */
export function CalendarIcon() { return <svg viewBox="0 0 24 24"><path d="M4.5 6.5h15A1.5 1.5 0 0 1 21 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V8a1.5 1.5 0 0 1 1.5-1.5ZM3 11h18M8 4v4M16 4v4" /></svg>; }
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

/**
 * 行長上限 38em：全形中文一行約 38 字，再長眼睛就找不到下一行的開頭。行變長，行高也跟著從 1.5rem 拉到 1.75rem；
 * 用 !leading-7 是因為「大字體」偏好對 .text-sm 另有一條優先度更高的行高規則，不加會被蓋回 24px。
 */
export function Markdown({ content }: { content: string }) {
  const indent = (depth: number) => ({ paddingLeft: `${0.5 + depth * 1.25}rem` });
  return <div className="max-w-[38em] space-y-2 text-sm !leading-7">{markdownBlocks(content).map((block, index) => {
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
