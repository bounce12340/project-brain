export interface ImportPreview {
  projects: number;
  tasks: number;
  progress_updates: number;
  reg_entries: number;
}

export function createImportPreview(source: string): ImportPreview {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("最外層必須是 JSON object");
  const body = value as { projects?: unknown; reg_entries?: unknown };
  if (body.projects !== undefined && !Array.isArray(body.projects)) throw new Error("projects 必須是陣列");
  if (body.reg_entries !== undefined && !Array.isArray(body.reg_entries)) throw new Error("reg_entries 必須是陣列");
  const projects = (body.projects ?? []) as Array<{ tasks?: unknown; progress_updates?: unknown }>;
  const count = (item: unknown) => Array.isArray(item) ? item.length : 0;
  return {
    projects: projects.length,
    tasks: projects.reduce((sum, item) => sum + count(item.tasks), 0),
    progress_updates: projects.reduce((sum, item) => sum + count(item.progress_updates), 0),
    reg_entries: count(body.reg_entries),
  };
}
