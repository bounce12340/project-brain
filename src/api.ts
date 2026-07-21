export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const value = typeof body === "object" && body !== null ? body as { error?: unknown; code?: unknown } : {};
    throw new ApiError(typeof value.error === "string" ? value.error : `HTTP ${response.status}`, response.status, typeof value.code === "string" ? value.code : undefined);
  }
  return body as T;
}

export const jsonBody = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
export const patchBody = (value: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(value) });

export function formatDate(value?: string | null, includeTime = false): string {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}

export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
