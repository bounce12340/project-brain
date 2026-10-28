import { isIsoDate } from "./importer";

/**
 * 任務自訂欄位的規則：欄位型別、選項與值的檢查。網站 API 與 MCP 共用，
 * 寫進資料庫的值一律是字串（數字存成正規化後的十進位，日期存 YYYY-MM-DD，單選存選項本身）。
 */
export const FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type FieldType = typeof FIELD_TYPES[number];
export interface TaskField { id: string; project_id: string; name: string; type: FieldType; options: string[]; position: number }

export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 30;
export const FIELD_NAME_MAX = 40;
export const OPTION_MAX = 40;
export const TEXT_VALUE_MAX = 500;

export const parseOptions = (json: string): string[] => {
  try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
};

export function cleanFieldName(value: unknown): string | { error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { error: "請輸入欄位名稱" };
  if ([...name].length > FIELD_NAME_MAX) return { error: `欄位名稱最多 ${FIELD_NAME_MAX} 字` };
  return name;
}

/** 單選的選項：去空白、去重複；至少一個。 */
export function cleanOptions(value: unknown): string[] | { error: string } {
  if (!Array.isArray(value)) return { error: "選項格式不正確" };
  const options = [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
  if (!options.length) return { error: "單選欄位至少要有一個選項" };
  if (options.length > MAX_OPTIONS) return { error: `選項最多 ${MAX_OPTIONS} 個` };
  if (options.some((option) => [...option].length > OPTION_MAX)) return { error: `每個選項最多 ${OPTION_MAX} 字` };
  return options;
}

/** null＝清除；回傳要存的字串，或錯誤。 */
export function cleanFieldValue(field: Pick<TaskField, "name" | "type" | "options">, raw: unknown): { value: string | null } | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { value: null };
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (text === null) return { error: `「${field.name}」的值格式不正確` };
  switch (field.type) {
    case "number": {
      const number = Number(text.replace(/,/g, ""));
      return Number.isFinite(number) ? { value: String(number) } : { error: `「${field.name}」要填數字` };
    }
    case "date": return isIsoDate(text) ? { value: text } : { error: `「${field.name}」要填 YYYY-MM-DD 的日期` };
    case "select": return field.options.includes(text) ? { value: text } : { error: `「${field.name}」只能選：${field.options.join("、")}` };
    default: return [...text].length > TEXT_VALUE_MAX ? { error: `「${field.name}」最多 ${TEXT_VALUE_MAX} 字` } : { value: text };
  }
}

export async function projectFields(db: D1Database, projectId: string): Promise<TaskField[]> {
  const rows = await db.prepare("SELECT id,project_id,name,type,options_json,position FROM task_fields WHERE project_id=? ORDER BY position,created_at").bind(projectId)
    .all<{ id: string; project_id: string; name: string; type: FieldType; options_json: string; position: number }>();
  return rows.results.map(({ options_json, ...row }) => ({ ...row, options: parseOptions(options_json) }));
}
