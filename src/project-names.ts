/**
 * 專案名稱比對。前端（上傳檢查）與後端（匯入時對既有專案）共用同一份規則。
 *
 * 系統裡的專案名稱大多是「QA：GDP/GMP」這種全形冒號；使用者在 Excel 裡打的常是
 * 半形「QA:GDP/GMP」，或多了空白。逐字比對會把這些都判成「找不到專案」，檢查就卡住。
 */

/** NFKC 把全形英數與標點（：／（））轉成半形，再去掉所有空白、忽略大小寫。 */
export function normalizeProjectName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * 對不到時，找最像的一個既有專案名稱當提示。只從呼叫端給的清單找——
 * 呼叫端必須只給使用者看得到的專案，否則提示本身就會洩漏別人的專案名稱。
 */
export function closestProjectName(value: string, candidates: string[]): string | null {
  const needle = normalizeProjectName(value);
  if (!needle) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of candidates) {
    const hay = normalizeProjectName(name);
    if (!hay) continue;
    // 少打了前綴（「GDP/GMP」vs「QA：GDP/GMP」）或多打了字，視為很接近。
    const contained = needle.length >= 3 && (hay.includes(needle) || needle.includes(hay));
    const score = contained ? 0.5 : distance(needle, hay);
    const limit = Math.max(2, Math.floor(Math.max(needle.length, hay.length) * 0.3));
    if (score <= limit && (!best || score < best.score)) best = { name, score };
  }
  return best?.name ?? null;
}
