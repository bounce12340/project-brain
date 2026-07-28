import { formatDate } from "../api";
import { interpolate, type Lang } from "../i18n/LangContext";
import { translations } from "../i18n/translations";
import { parseServerDate } from "./server-date";
export function relativeTime(value: string, lang: Lang, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - parseServerDate(value).getTime()) / 1000));
  const text = (key: "time.justNow" | "time.minutesAgo" | "time.hoursAgo" | "time.daysAgo", count?: number) => interpolate(translations[lang][key], count === undefined ? {} : { count });
  if (seconds < 60) return text("time.justNow");
  if (seconds < 3600) return text("time.minutesAgo", Math.floor(seconds / 60));
  if (seconds < 86400) return text("time.hoursAgo", Math.floor(seconds / 3600));
  if (seconds < 604800) return text("time.daysAgo", Math.floor(seconds / 86400));
  return formatDate(value, false, lang);
}
