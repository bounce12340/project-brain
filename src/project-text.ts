/**
 * 專案背景（projects.description）與專案目標（goal_summary）這類給人讀的長文字。
 * 前端編輯器與後端檢查共用同一組上限。
 */
export const PROJECT_TEXT_LIMITS = { description: 10_000, goal_summary: 2_000 } as const;

/** 以字元（code point）計算長度：中文一個字算一個，表情符號也不會被算成兩個。 */
export const textLength = (value: string): number => [...value].length;

/** 超過這麼多行或字，預設只顯示前幾行並提供「展開」。 */
const CLAMP_LINES = 6;
const CLAMP_CHARS = 300;

export function needsClamp(value: string): boolean {
  return value.split("\n").length > CLAMP_LINES || textLength(value) > CLAMP_CHARS;
}
