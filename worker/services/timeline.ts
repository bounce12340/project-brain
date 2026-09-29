export interface TimelineGroupable {
  id?: string;
  group_id: string;
  group_name: string;
  name: string;
  /** 子專案排在母專案後面（母專案在同一組時）。 */
  parent_id?: string | null;
}

export function groupTimelineProjects<T extends TimelineGroupable>(projects: T[]): Array<{ id: string; name: string; projects: T[] }> {
  const groups = new Map<string, { id: string; name: string; projects: T[] }>();
  for (const project of projects) {
    const group = groups.get(project.group_id) ?? { id: project.group_id, name: project.group_name, projects: [] };
    group.projects.push(project);
    groups.set(project.group_id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "zh-TW") || a.id.localeCompare(b.id))
    .map((group) => {
      const names = new Map(group.projects.map((project) => [project.id, project.name]));
      // 排序鍵：一般專案用自己的名稱；子專案用「母專案名稱＋自己的名稱」，就會緊接在母專案後面。
      const key = (project: T) => project.parent_id && names.has(project.parent_id) ? [names.get(project.parent_id)!, project.name] : [project.name, ""];
      return { ...group, projects: group.projects.sort((a, b) => { const [left, right] = [key(a), key(b)]; return left[0].localeCompare(right[0], "zh-TW") || left[1].localeCompare(right[1], "zh-TW"); }) };
    });
}
