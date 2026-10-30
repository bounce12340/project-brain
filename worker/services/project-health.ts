/**
 * 狀態燈號：發進度紀錄時選「順利／有風險／落後」。專案顯示最近一則有標示燈號的紀錄，
 * 存在 projects.health／health_at，清單與儀表板不必每次去翻進度紀錄。
 * 新增、修改或刪除進度紀錄後都呼叫 refreshProjectHealth，讓兩邊保持一致。
 */
export const HEALTH_VALUES = ["on_track", "at_risk", "off_track"] as const;
export type Health = typeof HEALTH_VALUES[number];
export const HEALTH_LABEL: Record<Health, string> = { on_track: "順利", at_risk: "有風險", off_track: "落後" };

/** undefined＝沒傳；null＝清除（不標示）；其他值回錯誤。 */
export function parseHealth(value: unknown): Health | null | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return (HEALTH_VALUES as readonly unknown[]).includes(value) ? value as Health : { error: "狀態燈號只能是順利、有風險或落後" };
}

/**
 * 燈號有變（等級或設定時間）時，順便把 AI 風險標成待重新分析：風險分析以負責人的燈號優先，
 * 不重做的話畫面上會留著和新燈號矛盾的等級，要等 7 天後排程才更新。
 */
export async function refreshProjectHealth(db: D1Database, projectId: string): Promise<void> {
  const latest = await db.prepare("SELECT health,created_at FROM progress_updates WHERE project_id=? AND health IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(projectId).first<{ health: Health; created_at: string }>();
  const health = latest?.health ?? null;
  const at = latest?.created_at ?? null;
  // SET 右邊讀的是更新前的值，所以能比較新舊燈號。
  await db.prepare("UPDATE projects SET health=?,health_at=?,risk_updated_at=CASE WHEN health IS NOT ? OR health_at IS NOT ? THEN NULL ELSE risk_updated_at END WHERE id=?")
    .bind(health, at, health, at, projectId).run();
}
