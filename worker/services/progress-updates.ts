export function progressAuditExcerpt(content: string): string {
  return Array.from(content).slice(0, 40).join("");
}
