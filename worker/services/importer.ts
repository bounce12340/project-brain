export interface ImportUserResolution {
  userId: string;
  notePrefix: string;
  warning?: string;
}
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // 13 月、00 日這類是無效日期，toISOString() 會直接丟 RangeError，
  // 匯入就變成 500 而不是「日期格式錯誤」。2 月 30 日則會滾成 3 月，靠字串比對抓。
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** fallbackLabel 是警告裡對「改掛給誰」的稱呼：管理員匯入時是執行管理員，一般使用者匯入時是匯入者本人。 */
export function resolveImportUser(email: unknown, usersByEmail: ReadonlyMap<string, string>, adminId: string, fallbackLabel = "執行管理員"): ImportUserResolution {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  const matched = normalized ? usersByEmail.get(normalized) : undefined;
  if (matched) return { userId: matched, notePrefix: "" };
  if (!normalized) return { userId: adminId, notePrefix: "" };
  return { userId: adminId, notePrefix: `【原負責人：${normalized}】`, warning: `找不到使用者 ${normalized}，已改掛${fallbackLabel}` };
}

export function progressUpdateImportKey(date: string, content: string): string {
  return `${date}|${content.slice(0, 40)}`;
}

export function importItemExists(existingKeys: ReadonlySet<string>, key: string): boolean {
  return existingKeys.has(key);
}
