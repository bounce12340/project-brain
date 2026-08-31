import type { Project } from "./types";

/** 分群只需要這兩個欄位，測試與切換器都能餵精簡物件進來。 */
type Groupable = Pick<Project, "id" | "name" | "product">;

export interface ProjectSection<T> {
  /** 空字串代表「其他」：沒有產品，或該產品在目前這份清單裡只有一件。 */
  product: string;
  projects: T[];
}

/**
 * 依產品分群，但**只有兩件以上才成群**。
 *
 * 每個產品都給一個標題的話，畫面會變成一長串「一個標題配一列」，比原本的卡片更亂——
 * 分群的目的是讓有關聯的案子被看見，不是替每件案子加一行字。單獨的案子集中到最後的
 * 「其他」，它們的產品仍然顯示在該列上，資訊沒有消失。
 *
 * 群組排序：件數多的在前，同件數依產品名。件數多代表關聯性強，是使用者想先看到的。
 */
export function groupByProduct<T extends Groupable>(projects: T[]): Array<ProjectSection<T>> {
  const byProduct = new Map<string, T[]>();
  for (const project of projects) {
    const key = (project.product ?? "").trim();
    if (!key) continue;
    byProduct.set(key, [...(byProduct.get(key) ?? []), project]);
  }
  const clusters = [...byProduct.entries()]
    .filter(([, items]) => items.length > 1)
    .sort(([leftName, left], [rightName, right]) => right.length - left.length || leftName.localeCompare(rightName))
    .map(([product, items]) => ({ product, projects: items }));

  const clustered = new Set(clusters.flatMap((section) => section.projects.map((project) => project.id)));
  const rest = projects.filter((project) => !clustered.has(project.id));
  return rest.length ? [...clusters, { product: "", projects: rest }] : clusters;
}

/**
 * 同產品的其他專案。沒填產品時回空陣列——不能把所有未分類的案子都當成彼此相關，
 * 那是「都沒填」而不是「有關聯」。
 */
export function relatedProjects<T extends Groupable>(all: T[], current: Groupable): T[] {
  const key = (current.product ?? "").trim();
  if (!key) return [];
  return all.filter((project) => project.id !== current.id && (project.product ?? "").trim() === key);
}

/** 有沒有任何一群成立；沒有的話畫面不必顯示分群標題。 */
export function hasClusters<T extends Groupable>(sections: Array<ProjectSection<T>>): boolean {
  return sections.some((section) => section.product !== "");
}
