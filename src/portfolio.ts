import { healthState } from "./project-health";

/** 專案總覽一列（/api/portfolio）。 */
export interface PortfolioRow {
  id: string; name: string; parent_id: string | null; group_id: string; group_name: string;
  status: "active" | "paused" | "done" | "archived"; progress: number;
  health: string | null; health_at: string | null; risk_level: "low" | "medium" | "high" | null;
  owner_id: string; owner_name: string; product: string; start_date: string | null; target_date: string | null;
  last_activity_at: string; visibility: string;
  task_total: number; task_done: number; task_overdue: number; last_update_at: string | null;
}

/** 燈號分類（含過期與未標示），總覽上方的計數與篩選共用。 */
export const HEALTH_BUCKETS = ["on_track", "at_risk", "off_track", "stale", "none"] as const;
export type HealthBucket = typeof HEALTH_BUCKETS[number];
export function healthBucket(row: Pick<PortfolioRow, "health" | "health_at">, now = Date.now()): HealthBucket {
  const state = healthState(row.health, row.health_at, now);
  if (!state.level) return "none";
  return state.stale ? "stale" : state.level;
}

export type PortfolioSort = "name" | "health" | "progress" | "target_date" | "owner" | "overdue" | "last_update";
const HEALTH_ORDER: Record<HealthBucket, number> = { off_track: 0, at_risk: 1, stale: 2, none: 3, on_track: 4 };

/** 排序：燈號由壞到好、逾期多的在前、目標日近的在前（沒填的放最後）。desc 反轉。 */
export function sortPortfolio(rows: PortfolioRow[], sort: PortfolioSort, desc = false, now = Date.now()): PortfolioRow[] {
  const key = (row: PortfolioRow): string | number => {
    switch (sort) {
      case "health": return HEALTH_ORDER[healthBucket(row, now)];
      case "progress": return row.progress;
      case "target_date": return row.target_date ?? "9999-12-31";
      case "owner": return row.owner_name;
      case "overdue": return -row.task_overdue;
      case "last_update": return row.last_update_at ?? "";
      default: return row.name;
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-Hant");
    return order || a.name.localeCompare(b.name, "zh-Hant");
  });
  return desc ? sorted.reverse() : sorted;
}

export function portfolioCsv(rows: PortfolioRow[], headers: string[], labels: { health: (row: PortfolioRow) => string; status: (row: PortfolioRow) => string }): string {
  const body = rows.map((row) => [row.name, row.group_name, labels.health(row), labels.status(row), `${row.progress}%`, row.target_date ?? "", row.owner_name, `${row.task_done}/${row.task_total}`, row.task_overdue, row.last_update_at?.slice(0, 10) ?? ""]);
  return `﻿${[headers, ...body].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
}
