export function requiredString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function boundedNumber(body: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const value = Number(body[key]);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function integer(body: Record<string, unknown>, key: string, fallback = 0): number {
  const value = Number(body[key]);
  return Number.isInteger(value) ? value : fallback;
}

export function booleanInt(body: Record<string, unknown>, key: string, fallback = 0): number {
  if (body[key] === true || body[key] === 1) return 1;
  if (body[key] === false || body[key] === 0) return 0;
  return fallback;
}

/**
 * 只接受 http(s) 網址，其他（javascript:、data: 等）一律回 null。
 * 存進資料庫、之後會變成可點連結的欄位都要經過這裡：網址若是 javascript:，同事一點就會以他的身分在網站上執行程式。
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export const INVALID_LINK = "連結必須是 http:// 或 https:// 開頭的網址";
