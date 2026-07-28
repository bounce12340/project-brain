import type { Stage, Task } from "./types";

export const PROGRESS_LINKS_STORAGE_KEY = "AIUR_PROGRESS_LINKS";

export interface ProgressLinksResponse {
  complete: Array<{ task_id: string; reason: string }>;
  create: Array<{ title: string; stage_name?: string; due_date?: string }>;
  milestones: Array<{ title: string; due_date: string }>;
  dates: Array<{ task_id: string; due_date: string; reason: string }>;
  fallback: boolean;
}

export interface ProgressCompleteDraft {
  key: string;
  task_id: string;
  title: string;
  stage_name: string;
  reason: string;
  selected: boolean;
}

export interface ProgressCreateDraft {
  key: string;
  title: string;
  stage_id: string;
  due_date: string;
  selected: boolean;
}

export interface ProgressMilestoneDraft {
  key: string;
  title: string;
  due_date: string;
  selected: boolean;
}

export interface ProgressDateDraft {
  key: string;
  task_id: string;
  title: string;
  due_date: string;
  reason: string;
  selected: boolean;
}

export function readProgressLinksPreference(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(PROGRESS_LINKS_STORAGE_KEY) !== "false";
}

export function writeProgressLinksPreference(enabled: boolean, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(PROGRESS_LINKS_STORAGE_KEY, String(enabled));
}

export function defaultProgressLinkStageId(stages: Stage[], tasks: Task[]): string {
  const ordered = [...stages].sort((left, right) => left.position - right.position);
  return ordered.find((stage) => tasks.some((task) => task.stage_id === stage.id && !task.done))?.id ?? ordered[0]?.id ?? "";
}

export function progressLinkDrafts(response: ProgressLinksResponse, stages: Stage[], tasks: Task[]): {
  complete: ProgressCompleteDraft[];
  create: ProgressCreateDraft[];
  milestones: ProgressMilestoneDraft[];
  dates: ProgressDateDraft[];
} {
  const defaultStageId = defaultProgressLinkStageId(stages, tasks);
  return {
    complete: response.complete.flatMap((item, index) => {
      const task = tasks.find((candidate) => candidate.id === item.task_id && !candidate.done);
      if (!task) return [];
      return [{
        key: `complete-${item.task_id}-${index}`,
        task_id: task.id,
        title: task.title,
        stage_name: stages.find((stage) => stage.id === task.stage_id)?.name ?? "",
        reason: item.reason,
        selected: false,
      }];
    }),
    create: response.create.map((item, index) => ({
      key: `create-${index}`,
      title: item.title,
      stage_id: stages.find((stage) => stage.name === item.stage_name)?.id ?? defaultStageId,
      due_date: item.due_date ?? "",
      selected: false,
    })),
    milestones: response.milestones.map((item, index) => ({
      key: `milestone-${index}`,
      title: item.title,
      due_date: item.due_date,
      selected: false,
    })),
    dates: response.dates.flatMap((item, index) => {
      const task = tasks.find((candidate) => candidate.id === item.task_id && !candidate.done);
      if (!task) return [];
      return [{
        key: `date-${item.task_id}-${index}`,
        task_id: task.id,
        title: task.title,
        due_date: item.due_date,
        reason: item.reason,
        selected: false,
      }];
    }),
  };
}
