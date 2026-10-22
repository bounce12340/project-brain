/**
 * 系統裡用的精簡 Markdown：標題、項目符號（可縮排）、編號清單、粗體。
 * 專案背景、進度紀錄、AI 報告都用它；拆成純函式，渲染與測試共用。
 */
export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; depth: number; text: string }
  | { kind: "numbered"; depth: number; number: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

/** 縮排兩格算一層，最多三層；Tab 當四格。 */
const depthOf = (indent: string) => Math.min(3, Math.floor(indent.replace(/\t/g, "    ").length / 2));

export function markdownBlocks(content: string): MarkdownBlock[] {
  return content.replace(/\r\n?/g, "\n").split("\n").map((line): MarkdownBlock => {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) return { kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] };
    const bullet = /^(\s*)[-*•] (.*)$/.exec(line);
    if (bullet) return { kind: "bullet", depth: depthOf(bullet[1]), text: bullet[2] };
    const numbered = /^(\s*)(\d{1,3})[.)、] (.*)$/.exec(line);
    if (numbered) return { kind: "numbered", depth: depthOf(numbered[1]), number: numbered[2], text: numbered[3] };
    return line.trim() ? { kind: "paragraph", text: line.trim() } : { kind: "blank" };
  });
}

/**
 * 縮成一兩行的預覽（儀表板動態、快覽清單）放不下排版：拿掉 Markdown 記號，只留文字。
 * 標題的 #、粗體的 ** 去掉；項目符號換成「・」，編號保留。
 */
export function plainMarkdown(content: string): string {
  return content.replace(/\r\n?/g, "\n").split("\n").map((line) => line
    .replace(/^#{1,3} /, "")
    .replace(/^(\s*)[-*•] /, "$1・")
    .replace(/\*\*/g, "")).join("\n");
}
