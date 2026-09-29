const TIME_ZONE_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/i;

export function parseServerDate(value: string): Date {
  if (value.length === 10) return new Date(`${value}T00:00:00+08:00`);
  if (TIME_ZONE_SUFFIX.test(value)) return new Date(value);
  return new Date(`${value.replace(" ", "T")}Z`);
}

/** 給 <input type="datetime-local"> 用的台北時間「YYYY-MM-DDTHH:mm」。 */
export function taipeiDateTimeInput(value: string | Date): string {
  const date = typeof value === "string" ? parseServerDate(value) : value;
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

/** datetime-local 的台北時間轉成帶時區的字串，送給伺服器。 */
export function taipeiInputToIso(value: string): string {
  return `${value.length === 16 ? `${value}:00` : value}+08:00`;
}
