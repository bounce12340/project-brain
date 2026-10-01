/** 會議記錄與外出上課共用的型別與顯示規則。時間一律是台北時間的「YYYY-MM-DDTHH:MM」。 */

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
