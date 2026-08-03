/**
 * 階段色盤。五個語意色，經 OKLCH 檢定：在深色（#0D1526）與淺色（#FBF9F4）圖表底色上
 * 都通過亮度帶、彩度下限、全配對 CVD 分離與對比檢查。
 *
 * 為什麼只有五色：八色與六色在「全配對」下都找不到通過的組合（例如紫 #7c3aed 與
 * 藍 #2563eb 在 deutan 下 ΔE 僅 0.4，等同同色）。五色是能同時滿足兩種底色的上限。
 * 綠↔橘在 protan 下 ΔE 6.5 屬於下限帶，僅在有次要編碼時合格——本系統的圖例有文字
 * 標籤、色條有 tooltip、完成另有斜紋，條件成立。
 */
export const STAGE_COLORS = {
  notStarted: "#0284c7",
  active: "#d97706",
  waiting: "#7c3aed",
  attention: "#e11d48",
  done: "#15803d",
} as const;

export type StageColorRole = keyof typeof STAGE_COLORS;

/** 階段名稱 → 語意角色。名稱取自正式資料庫的實際階段（19 種）。 */
export const STAGE_ROLE_BY_NAME: Readonly<Record<string, StageColorRole>> = {
  待辦: "notStarted", 啟動準備: "notStarted", 準備文件: "notStarted", 開立: "notStarted",
  進行中: "active", 執行中: "active", 收案中: "active", 根因調查: "active", 措施擬定: "active",
  送件: "waiting", 審查中: "waiting", "IRB 送審": "waiting", 效期確認: "waiting",
  補件: "attention", 收到補件並進行回覆: "attention",
  完成: "done", 結案: "done", 核准領證: "done", 報告: "done",
};

/**
 * 未列於對照表的自訂階段一律給 notStarted：新建的階段通常尚未開工，且這樣不會落回
 * 原本無法分辨的預設靛藍。使用者仍可在階段設定改成任何顏色。
 */
export function stageColorFor(name: string): string {
  return STAGE_COLORS[STAGE_ROLE_BY_NAME[name.trim()] ?? "notStarted"];
}
