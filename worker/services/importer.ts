export interface ImportUserResolution {
  userId: string;
  notePrefix: string;
  warning?: string;
}
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function resolveImportUser(email: unknown, usersByEmail: ReadonlyMap<string, string>, adminId: string): ImportUserResolution {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  const matched = normalized ? usersByEmail.get(normalized) : undefined;
  if (matched) return { userId: matched, notePrefix: "" };
  if (!normalized) return { userId: adminId, notePrefix: "" };
  return { userId: adminId, notePrefix: `【原負責人：${normalized}】`, warning: `找不到使用者 ${normalized}，已改掛執行管理員` };
}

export function progressUpdateImportKey(date: string, content: string): string {
  return `${date}|${content.slice(0, 40)}`;
}

export function importItemExists(existingKeys: ReadonlySet<string>, key: string): boolean {
  return existingKeys.has(key);
}
