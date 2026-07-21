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
