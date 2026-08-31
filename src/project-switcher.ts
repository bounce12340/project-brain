export interface SwitchableProject {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  /** 同產品的專案常跨組別——BD 的 `Plenvu` 與一般組的 `RA：啟動Plenvu註冊` 是同一個產品。 */
  product: string;
}

export interface SwitchGroup<T extends SwitchableProject> {
  id: string;
  name: string;
  isCurrentGroup: boolean;
  projects: T[];
}

const byLabel = (left: string, right: string) => left.localeCompare(right, "zh-TW", { numeric: true });

export function groupProjectsForSwitch<T extends SwitchableProject>(projects: T[], currentGroupId: string): Array<SwitchGroup<T>> {
  const groups = new Map<string, SwitchGroup<T>>();
  for (const project of projects) {
    const group = groups.get(project.group_id);
    if (group) group.projects.push(project);
    else groups.set(project.group_id, { id: project.group_id, name: project.group_name, isCurrentGroup: project.group_id === currentGroupId, projects: [project] });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, projects: [...group.projects].sort((left, right) => byLabel(left.name, right.name) || left.id.localeCompare(right.id)) }))
    .sort((left, right) => Number(right.isCurrentGroup) - Number(left.isCurrentGroup) || byLabel(left.name, right.name) || left.id.localeCompare(right.id));
}

export function orderProjectsForSwitch<T extends SwitchableProject>(projects: T[], currentGroupId: string): T[] {
  return groupProjectsForSwitch(projects, currentGroupId).flatMap((group) => group.projects);
}

export function nextProjectId(projects: SwitchableProject[], current: { id: string; group_id: string }): string | null {
  const ordered = orderProjectsForSwitch(projects, current.group_id);
  if (ordered.length < 2) return null;
  const index = ordered.findIndex((project) => project.id === current.id);
  return index < 0 ? ordered[0].id : ordered[(index + 1) % ordered.length].id;
}
