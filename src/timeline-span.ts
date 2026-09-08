/**
 * 全域時間軸上一個專案該畫多長。
 *
 * 原本是 `project.start_date ?? start`——沒填開始日就退回「整條軸線的最左端」，
 * 沒填目標日就讓結束等於開始。正式資料上 25 個進行中專案的 start_date 全是 null，
 * 於是每一條專案軸不是釘在最左邊的 8px 小點，就是從最左端橫跨到目標日的假長條。
 *
 * 沒填日期的專案不是「從時間軸原點開始」，而是「它的期間要看它裡面有什麼」。
 */

export interface SpanTask { start_date: string | null; due_date: string | null }
export interface SpanMarker { due_date: string | null; end_date: string | null }
export interface SpanProject {
  start_date: string | null;
  target_date: string | null;
  tasks: SpanTask[];
  markers: SpanMarker[];
}

export interface Span { start: string; end: string }

/**
 * 專案的區間。明確填了就用填的；沒填的那一端改由裡面的任務與里程碑推出來；
 * 兩者都沒有就回 null——什麼都畫不出來時，不該假裝畫得出來。
 *
 * 任務的 `created_at` 刻意不納入。那是紀錄被建進系統的時間，不是工作開始的時間；
 * 拿它當開始日會讓一批同時匯入的專案全部從匯入那天長出來。
 */
export function projectSpan(project: SpanProject): Span | null {
  const dates: string[] = [];
  for (const task of project.tasks) {
    if (task.start_date) dates.push(task.start_date);
    if (task.due_date) dates.push(task.due_date);
  }
  for (const marker of project.markers) {
    if (marker.due_date) dates.push(marker.due_date);
    if (marker.end_date) dates.push(marker.end_date);
  }
  dates.sort();
  const contentStart = dates[0];
  const contentEnd = dates.at(-1);

  const start = project.start_date ?? contentStart;
  const end = project.target_date ?? contentEnd;
  if (!start && !end) return null;
  // 只有一端有值時，另一端跟著它——一條長度為零的軸至少位置是對的，
  // 而畫面上會被最小寬度撐成一個看得見的點。
  const from = start ?? (end as string);
  const to = end ?? (start as string);
  return from <= to ? { start: from, end: to } : { start: to, end: from };
}

/** 專案在時間軸上完全沒有可畫的東西。用來決定要不要顯示「尚未排程」的說明。 */
export function hasNoSchedule(project: SpanProject): boolean {
  return projectSpan(project) === null;
}
