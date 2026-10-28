/**
 * 狀態燈號：發進度紀錄時選「順利／有風險／落後」，專案顯示最近一次的燈號。
 * 超過 HEALTH_STALE_DAYS 天沒有再標示，就改顯示灰色「待更新」，提醒負責人重新判斷。
 */
export const HEALTH_LEVELS = ["on_track", "at_risk", "off_track"] as const;
export type Health = typeof HEALTH_LEVELS[number];
export const HEALTH_STALE_DAYS = 14;

export interface HealthState { level: Health | null; stale: boolean; since: string | null }

/** healthAt 是資料庫的 UTC 時間（「YYYY-MM-DD HH:MM:SS」或 ISO）。 */
export function healthState(health: string | null | undefined, healthAt: string | null | undefined, now = Date.now()): HealthState {
  const level = (HEALTH_LEVELS as readonly string[]).includes(health ?? "") ? health as Health : null;
  if (!level || !healthAt) return { level, stale: false, since: healthAt ?? null };
  const at = Date.parse(healthAt.includes("T") ? healthAt : `${healthAt.replace(" ", "T")}Z`);
  const stale = Number.isFinite(at) && now - at > HEALTH_STALE_DAYS * 86_400_000;
  return { level, stale, since: healthAt };
}
