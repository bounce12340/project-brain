export interface TimelineGroupable {
  group_id: string;
  group_name: string;
  name: string;
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
    .map((group) => ({ ...group, projects: group.projects.sort((a, b) => a.name.localeCompare(b.name, "zh-TW")) }));
}
