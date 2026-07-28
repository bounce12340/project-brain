import type { AiLang } from "./ai-language";

export interface ProgressLinkTask {
  id: string;
  title: string;
  stage_name: string;
}

export interface ProgressLinkComplete {
  task_id: string;
  reason: string;
}

export interface ProgressLinkCreate {
  title: string;
  stage_name?: string;
  due_date?: string;
}

export interface ProgressLinkMilestone {
  title: string;
  due_date: string;
}

export interface ProgressLinkDate {
  task_id: string;
  due_date: string;
  reason: string;
}

export interface ProgressLinksResult {
  complete: ProgressLinkComplete[];
  create: ProgressLinkCreate[];
  milestones: ProgressLinkMilestone[];
  dates: ProgressLinkDate[];
  fallback: boolean;
}

const explicitCompletionPattern = /已(?:經)?(?:完成|送出|提交|取得|收到|獲得|核准)|完成了|送出了|\b(?:completed|submitted|obtained|received|sent)\b/i;
const ambiguousCompletionPattern = /將要|將於|預計|規劃|計畫|打算|下週|明天|之後|尚待|待辦|\b(?:will|plan(?:ned|ning)?|expect(?:ed|ing)?|intend(?:ed|ing)?|next\s+(?:week|month)|tomorrow|going\s+to)\b/i;
const deliverableCheckpointPattern = /(?:收到|取得|獲得|交付|提供|提交|核准|批准).*(?:文件|資料|報告|結果|許可|證照)|(?:receive|obtain|deliver|provide|submit|approv).*(?:document|file|data|report|result|license|certificate)/i;

function codePoints(value: string): string[] {
  return Array.from(value);
}

function trimTo(value: string, length: number): string {
  return codePoints(value.trim()).slice(0, length).join("");
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function explicitClauses(content: string): string[] {
  return content
    .split(/[\n。！？!?；;，,]/)
    .map((value) => value.trim())
    .filter((value) => explicitCompletionPattern.test(value) && !ambiguousCompletionPattern.test(value));
}

function clauseMatchesTask(clause: string, title: string): boolean {
  const normalizedClause = normalizedText(clause);
  const normalizedTitle = normalizedText(title);
  return normalizedTitle.length >= 2
    && (normalizedClause.includes(normalizedTitle) || (normalizedClause.length >= 4 && normalizedTitle.includes(normalizedClause)));
}

function isValidFutureDate(value: unknown, today: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value <= today) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function buildProgressLinksPrompt(lang: AiLang): string {
  const outputLanguage = lang === "en" ? "English" : "Traditional Chinese";
  return [
    `Respond in ${outputLanguage}. Return JSON only:`,
    '{"complete":[{"task_id":"...","reason":"..."}],"create":[{"title":"...","stage_name":"...","due_date":"YYYY-MM-DD"}],"milestones":[{"title":"...","due_date":"YYYY-MM-DD"}],"dates":[{"task_id":"...","due_date":"YYYY-MM-DD","reason":"..."}]}.',
    "Use only the supplied unfinished tasks and exact stage names.",
    "A task may appear in complete ONLY when the progress text explicitly says that same work is already completed, submitted/sent, or obtained/received.",
    "Future or ambiguous wording such as will, planned, expected, next week, 將要, 預計, 規劃, 計畫, or 下週 MUST NEVER appear in complete.",
    "Put future next actions in create instead. Never infer completion.",
    "Put every dated future deliverable handoff (for example, providing or receiving a document) in milestones, NEVER in create, with an explicit future due_date, at most 5 items. If a checkpoint is already represented by an unfinished task, use dates only and do not also create a milestone.",
    "Use dates only to suggest a future due_date for an existing unfinished task_id; include a short reason grounded in the progress text.",
    "Historical or past dates are narrative only and MUST NOT create any create, milestones, or dates object.",
    "Keep each complete reason to one sentence of at most 30 characters and each create title to at most 80 characters.",
    "Return at most 5 create items. Use null or omit due_date unless the text provides a future date.",
  ].join(" ");
}

export function sanitizeProgressLinks(
  value: unknown,
  tasks: ProgressLinkTask[],
  stageNames: string[],
  content: string,
  today: string,
): Omit<ProgressLinksResult, "fallback"> {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const stages = new Set(stageNames);
  const clauses = explicitClauses(content);
  const seen = new Set<string>();
  const complete: ProgressLinkComplete[] = [];
  if (Array.isArray(source.complete)) {
    for (const item of source.complete) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const reason = typeof row.reason === "string" ? trimTo(row.reason, 30) : "";
      const task = taskMap.get(taskId);
      if (!task || !reason || seen.has(taskId)) continue;
      if (ambiguousCompletionPattern.test(reason)) continue;
      if (!clauses.some((clause) => clauseMatchesTask(clause, task.title))) continue;
      seen.add(taskId);
      complete.push({ task_id: taskId, reason });
    }
  }

  const milestones: ProgressLinkMilestone[] = [];
  const seenMilestones = new Set<string>();
  const addMilestone = (title: string, dueDate: string): boolean => {
    const key = `${title}\u0000${dueDate}`;
    const normalizedTitle = normalizedText(title);
    const duplicatesExistingTask = tasks.some((task) => {
      const normalizedTask = normalizedText(task.title);
      return normalizedTask.length >= 2 && normalizedTitle.includes(normalizedTask);
    });
    if (!title || milestones.length >= 5 || duplicatesExistingTask || seenMilestones.has(key)) return false;
    seenMilestones.add(key);
    milestones.push({ title, due_date: dueDate });
    return true;
  };

  if (Array.isArray(source.milestones)) {
    for (const item of source.milestones) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const title = typeof row.title === "string" ? trimTo(row.title, 80) : "";
      const dueDate = isValidFutureDate(row.due_date, today) ? row.due_date : undefined;
      if (title && dueDate) addMilestone(title, dueDate);
    }
  }

  const create: ProgressLinkCreate[] = [];
  if (Array.isArray(source.create)) {
    for (const item of source.create) {
      if (create.length >= 5) break;
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const title = typeof row.title === "string" ? trimTo(row.title, 80) : "";
      if (!title) continue;
      const stageName = typeof row.stage_name === "string" && stages.has(row.stage_name) ? row.stage_name : undefined;
      const dueDate = isValidFutureDate(row.due_date, today) ? row.due_date : undefined;
      if (dueDate && deliverableCheckpointPattern.test(title)) {
        addMilestone(title, dueDate);
        continue;
      }
      create.push({ title, ...(stageName ? { stage_name: stageName } : {}), ...(dueDate ? { due_date: dueDate } : {}) });
    }
  }

  const dates: ProgressLinkDate[] = [];
  const seenDates = new Set<string>();
  if (Array.isArray(source.dates)) {
    for (const item of source.dates) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const dueDate = isValidFutureDate(row.due_date, today) ? row.due_date : undefined;
      const reason = typeof row.reason === "string" ? trimTo(row.reason, 80) : "";
      if (!taskMap.has(taskId) || !dueDate || !reason || seenDates.has(taskId)) continue;
      seenDates.add(taskId);
      dates.push({ task_id: taskId, due_date: dueDate, reason });
    }
  }
  return { complete, create, milestones, dates };
}

export function progressLinksFallback(): ProgressLinksResult {
  return { complete: [], create: [], milestones: [], dates: [], fallback: true };
}
