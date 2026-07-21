export interface DependencyEdge { task_id: string; depends_on_task_id: string }

export function wouldCreateDependencyCycle(taskId: string, dependsOnTaskId: string, edges: DependencyEdge[]): boolean {
  if (taskId === dependsOnTaskId) return true;
  const graph = new Map<string, string[]>();
  for (const edge of edges) graph.set(edge.task_id, [...(graph.get(edge.task_id) ?? []), edge.depends_on_task_id]);
  graph.set(taskId, [...(graph.get(taskId) ?? []), dependsOnTaskId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

