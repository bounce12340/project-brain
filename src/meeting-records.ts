/** 會議記錄與公司外訓共用的型別與顯示規則。時間一律是台北時間的「YYYY-MM-DDTHH:MM」。 */

export type RecordKind = "meeting" | "course";

export interface MeetingRecord {
  id: string; kind: RecordKind; title: string; starts_at: string; ends_at: string | null;
  location: string; attendees: string; organizer: string; summary: string;
  project_id: string | null; project_name: string | null;
  created_by: string | null; created_by_name: string | null; updated_by_name: string | null;
  created_at: string; updated_at: string; can_edit: boolean;
}

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(value: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  return { date, time, year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

function dateLabel(value: string, lang: "zh" | "en", withYear: boolean): string {
  const { year, month, day, weekday } = parts(value);
  if (lang === "en") return `${EN_WEEKDAYS[weekday]}, ${EN_MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ""}`;
  const md = `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  return `${withYear ? `${year}/` : ""}${md}（${ZH_WEEKDAYS[weekday]}）`;
}

/**
 * 「2026/10/01（四）14:00–15:30」；沒有結束時間就只有開始；跨日時結束那端也寫日期。
 */
export function formatRecordTime(startsAt: string, endsAt: string | null, lang: "zh" | "en"): string {
  const start = parts(startsAt);
  // 中文的星期括號已經是全形，後面不再空一格。
  const gap = lang === "zh" ? "" : " ";
  const head = `${dateLabel(startsAt, lang, true)}${gap}${start.time}`;
  if (!endsAt) return head;
  const end = parts(endsAt);
  if (end.date === start.date) return `${head}–${end.time}`;
  return `${head} – ${dateLabel(endsAt, lang, end.year !== start.year)}${gap}${end.time}`;
}

/** 台北時間的現在，格式同 starts_at。 */
export function taipeiNowLocal(date = new Date()): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

/** 還沒結束的放「接下來」（近的先），結束了的放「已舉行」（新的先）。 */
export function splitRecords<T extends Pick<MeetingRecord, "starts_at" | "ends_at">>(records: T[], now: string): { upcoming: T[]; past: T[] } {
  const upcoming = records.filter((record) => (record.ends_at ?? record.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = records.filter((record) => (record.ends_at ?? record.starts_at) < now).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

/** 全形半形、大小寫不影響搜尋；每個詞都要出現在名稱、地點、人員、主辦單位、專案或摘要裡。 */
export function recordMatches(record: Pick<MeetingRecord, "title" | "location" | "attendees" | "organizer" | "summary" | "project_name" | "starts_at">, query: string): boolean {
  const fold = (value: string) => value.normalize("NFKC").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold([record.title, record.location, record.attendees, record.organizer, record.summary, record.project_name ?? "", record.starts_at.slice(0, 10)].join(" "));
  return words.every((word) => text.includes(word));
}

/** 年月範圍，格式「YYYY-MM」；沒填的那端不限。 */
export interface MonthRange { from: string | null; to: string | null }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 網址或下拉選單來的值：不是合法的「YYYY-MM」就當沒填。 */
export const cleanMonth = (value: string | null | undefined): string | null => value && MONTH.test(value) ? value : null;

/** 起訖顛倒時自動對調，選錯順序也查得到。 */
export function normalizeRange(range: MonthRange): MonthRange {
  return range.from && range.to && range.from > range.to ? { from: range.to, to: range.from } : range;
}

/** 以開始時間所在的月份判斷是否落在範圍內（含頭尾）。 */
export function inMonthRange(record: Pick<MeetingRecord, "starts_at">, range: MonthRange): boolean {
  const { from, to } = normalizeRange(range);
  const month = record.starts_at.slice(0, 7);
  return (!from || month >= from) && (!to || month <= to);
}

/** 「本月」「上個月」「今年」三個快速選項，以台北時間的現在計算。 */
export function monthPresets(now: string): { thisMonth: MonthRange; lastMonth: MonthRange; thisYear: MonthRange } {
  const year = Number(now.slice(0, 4)); const month = Number(now.slice(5, 7));
  const current = now.slice(0, 7);
  const last = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  return { thisMonth: { from: current, to: current }, lastMonth: { from: last, to: last }, thisYear: { from: `${year}-01`, to: `${year}-12` } };
}

/** 年份下拉的選項：紀錄裡出現過的年份加上今年，新的在前。 */
export function recordYears(records: Array<Pick<MeetingRecord, "starts_at">>, now: string): string[] {
  return [...new Set([now.slice(0, 4), ...records.map((record) => record.starts_at.slice(0, 4))])].sort((a, b) => b.localeCompare(a));
}

/** 「2026/10」「2026/09–2026/10」「2026/09 起」「至 2026/10」；沒有範圍回 null。 */
export function rangeLabel(range: MonthRange, lang: "zh" | "en"): string | null {
  const { from, to } = normalizeRange(range);
  const show = (value: string) => value.replace("-", "/");
  if (from && to) return from === to ? show(from) : `${show(from)}–${show(to)}`;
  if (from) return lang === "zh" ? `${show(from)} 起` : `from ${show(from)}`;
  if (to) return lang === "zh" ? `至 ${show(to)}` : `until ${show(to)}`;
  return null;
}

/**
 * 複製到報告用的純文字清單：一行一筆、依時間先後，欄位名稱由呼叫端給（中英文）。
 *   公司外訓（2026/10，共 2 筆）
 *   1. 2026/10/01（四）09:00–16:00　GDP 實務研習｜主辦：TFDA｜地點：臺大醫院｜參加：Elvis
 */
export function recordsReport(records: MeetingRecord[], heading: string, labels: { organizer: string; location: string; attendees: string; project: string }, lang: "zh" | "en"): string {
  const sorted = [...records].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const gap = lang === "zh" ? "　" : "  ";
  const sep = lang === "zh" ? "｜" : " | ";
  const colon = lang === "zh" ? "：" : ": ";
  const lines = sorted.map((record, index) => {
    const parts = [
      record.kind === "course" && record.organizer ? `${labels.organizer}${colon}${record.organizer}` : "",
      record.kind === "meeting" && record.project_name ? `${labels.project}${colon}${record.project_name}` : "",
      record.location ? `${labels.location}${colon}${record.location}` : "",
      record.attendees ? `${labels.attendees}${colon}${record.attendees}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${formatRecordTime(record.starts_at, record.ends_at, lang)}${gap}${record.title}${parts.length ? sep + parts.join(sep) : ""}`;
  });
  return [heading, ...lines].join("\n");
}
