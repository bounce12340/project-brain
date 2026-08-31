const PROJECT_GROUP_KEY = "brain.projects.group";

/**
 * 沒有紀錄時回傳 null，這與「明確選了全部組別」（空字串）必須分得開——
 * 兩者都當成空字串的話，使用者選了「全部」，下次進頁面又會被預設打回自己的組別。
 */
export function readProjectGroup(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(PROJECT_GROUP_KEY);
  } catch {
    // 無痕視窗或封鎖站台資料時 localStorage 會直接丟例外，視同沒有偏好。
    return null;
  }
}

export function writeProjectGroup(groupId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(PROJECT_GROUP_KEY, groupId);
  } catch {
    // 存不進去只是下次要重選，不該讓畫面壞掉。
  }
}

/**
 * 初次進入預設自己的組別，讓自己的案子先出現，而不是先看到全公司 25 件。
 * 選過就一律尊重選擇，包含選「全部組別」。
 *
 * 實習生不套用這個預設：他們只看得到被指派的專案，本來就沒有雜訊要濾掉，
 * 再依組別篩反而會把跨組指派給他們的專案藏起來。
 */
export function defaultProjectGroup(saved: string | null, user: { group_id: string; role: string } | null): string {
  if (saved !== null) return saved;
  if (!user || user.role === "intern") return "";
  return user.group_id;
}
