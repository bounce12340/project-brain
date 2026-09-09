/**
 * 專案的預計完成時間以「某年第幾季」表達，但底層仍存成日期。
 *
 * `target_date` 是 DATE 欄位，時間軸、甘特、AI 排程建議、報表等 12 處都在讀它。
 * 若改存「2026Q4」這種字串，那些全部要跟著改，而且得各自再解析一次。
 * 因此季度只是輸入與顯示的形式：一律換算成該季的最後一天。
 *
 * 「第幾季完成」是期限，所以取季末而不是季初。
 */

export interface Quarter { year: number; quarter: 1 | 2 | 3 | 4 }

const QUARTER_END: Record<number, string> = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };

const isQuarter = (value: number): value is 1 | 2 | 3 | 4 => value === 1 || value === 2 || value === 3 || value === 4;

export function quarterEndDate(year: number, quarter: number): string {
  if (!Number.isInteger(year) || year < 1900 || year > 2999 || !isQuarter(quarter)) return "";
  return `${year}-${QUARTER_END[quarter]}`;
}

/** 只有剛好落在季末的日期才視為「一個季度」。其餘是明確日期，原樣保留。 */
export function quarterOfDate(date: string | null | undefined): Quarter | null {
  if (typeof date !== "string") return null;
  const match = /^(\d{4})-(\d{2}-\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(Object.keys(QUARTER_END).find((key) => QUARTER_END[Number(key)] === match[2]));
  return isQuarter(quarter) ? { year, quarter } : null;
}

/** 結構對不代表日期存在——2026-13-01 符合 \d{4}-\d{2}-\d{2} 但沒有 13 月。 */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatQuarter(value: Quarter): string {
  return `${value.year} Q${value.quarter}`;
}

/** 顯示用：季末日期顯示成季度，其他日期原樣顯示，沒有值則回空字串。 */
export function targetLabel(date: string | null | undefined): string {
  const quarter = quarterOfDate(date);
  return quarter ? formatQuarter(quarter) : (date ?? "");
}

/**
 * 下拉選單的值換回日期。
 * `""` → null（清除）、`2026-4` → 季末、`2026-09-09` → 原樣（保留既有的明確日期）。
 * 認不得的值回 undefined，呼叫端據此決定不要送出，以免把使用者原本的資料洗掉。
 */
export function resolveTargetDate(value: string): string | null | undefined {
  if (value === "") return null;
  const quarter = /^(\d{4})-([1-4])$/.exec(value);
  if (quarter) return quarterEndDate(Number(quarter[1]), Number(quarter[2]));
  return isRealDate(value) ? value : undefined;
}

/** 選單裡該列出哪些季度。以今年為中心，往前一年、往後三年。 */
export function quarterOptions(today: string, back = 1, forward = 3): Quarter[] {
  const year = Number(today.slice(0, 4));
  if (!Number.isInteger(year)) return [];
  const list: Quarter[] = [];
  for (let offset = -back; offset <= forward; offset += 1) {
    for (const quarter of [1, 2, 3, 4] as const) list.push({ year: year + offset, quarter });
  }
  return list;
}

/** 下拉選單的選項值。 */
export function quarterValue(value: Quarter): string {
  return `${value.year}-${value.quarter}`;
}
