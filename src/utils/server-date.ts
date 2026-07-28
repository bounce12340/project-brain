const TIME_ZONE_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/i;

export function parseServerDate(value: string): Date {
  if (value.length === 10) return new Date(`${value}T00:00:00+08:00`);
  if (TIME_ZONE_SUFFIX.test(value)) return new Date(value);
  return new Date(`${value.replace(" ", "T")}Z`);
}
