export type AiLang = "zh" | "en";

export function normalizeAiLang(value: unknown): AiLang { return value === "en" ? "en" : "zh"; }

export function aiLanguageInstruction(lang: AiLang): string {
  return lang === "en"
    ? "Write every narrative field in concise, professional English. Do not use Chinese in the response except when preserving a proper noun from the source data."
    : "所有敘述欄位都必須使用專業、簡潔的繁體中文；除保留來源資料中的專有名詞外，不得用英文敘述。";
}

export function draftFallback(rawText: string, lang: AiLang): string {
  return lang === "en"
    ? `## Progress this period\n- ${rawText}\n\n## Risks or blockers\n- To be provided\n\n## Next steps\n- To be provided`
    : `## 本期進展\n- ${rawText}\n\n## 風險或阻礙\n- 待補充\n\n## 下一步\n- 待補充`;
}

export function taskFallback(task: Record<string, unknown>, commentCount: number, lang: AiLang) {
  if (lang === "en") return { summary: `${String(task.title)} is currently in “${String(task.stage_name)}” and is ${Number(task.done) ? "completed" : "in progress"}. ${String(task.description || "No description is available.")}`, unresolved: commentCount ? ["Review the actions and decisions in the comments."] : ["There are no comments from which to identify open items."] };
  return { summary: `${String(task.title)}目前位於「${String(task.stage_name)}」，狀態為${Number(task.done) ? "已完成" : "進行中"}。${String(task.description || "尚無描述")}`, unresolved: commentCount ? ["請確認留言中的待辦與決議"] : ["尚無留言可判斷未決事項"] };
}

export function riskFallback(high: boolean, medium: boolean, lang: AiLang) {
  if (lang === "en") return { level: high ? "high" : medium ? "medium" : "low", summary: high ? "Schedule, overdue work, or inactivity indicators show a high level of risk." : medium ? "Schedule or overdue-work signals require follow-up." : "Current data shows no material risk indicators.", suggestions: ["Confirm owners for overdue tasks and milestones.", "Update the next steps and target dates."] };
  return { level: high ? "high" : medium ? "medium" : "low", summary: high ? "時程、逾期項目或停滯指標顯示高風險。" : medium ? "目前有需要追蹤的時程或逾期訊號。" : "目前數據未顯示明顯風險。", suggestions: ["確認逾期任務與里程碑負責人", "更新下一步與目標日期"] };
}

export function scheduleReason(lang: AiLang): string { return lang === "en" ? "Scheduled as a three-day work window based on the current task order." : "依現有任務順序安排三日工作窗"; }
