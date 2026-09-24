import { closestProjectName, normalizeProjectName } from "./project-names";
import { quarterEndDate } from "./project-quarter";
import { columnLetter, STYLE, type Cell, type SheetSpec, type Workbook } from "./xlsx";

/**
 * Excel 批次匯入範本：範本長什麼樣子、怎麼把使用者填好的表轉成匯入資料。
 *
 * 範本與解析共用同一份欄位定義，範本改了解析就跟著改，不會出現「照範本填卻匯不進去」。
 */

export interface ImportContext {
  groups: Array<{ id: string; name: string }>;
  users: Array<{ name: string; email: string }>;
  me: { name: string; email: string; group_name: string };
  /** 目前看得到的專案（名稱與代碼）。用來判斷表上的專案是新的還是既有的。 */
  existingProjects: Array<{ name: string; external_key?: string | null }>;
}

export const SHEET = { projects: "專案", items: "工作項目", updates: "進度紀錄" } as const;
type SheetKind = keyof typeof SHEET;

interface Column { key: string; label: string; required?: boolean; aliases?: string[]; width: number; text?: boolean }

export const COLUMNS: Record<SheetKind, Column[]> = {
  projects: [
    { key: "name", label: "專案名稱", required: true, aliases: ["專案", "案名", "計畫名稱", "project"], width: 30 },
    { key: "code", label: "專案代碼", aliases: ["代碼", "專案編號", "external_key"], width: 14, text: true },
    { key: "group", label: "組別", width: 12 },
    { key: "status", label: "狀態", aliases: ["專案狀態"], width: 10 },
    { key: "visibility", label: "可見性", width: 10 },
    { key: "product", label: "產品", width: 16 },
    { key: "site", label: "廠區", aliases: ["製造廠", "廠商"], width: 18 },
    { key: "start", label: "起始日", aliases: ["開始日", "開始日期", "起始日期"], width: 12 },
    { key: "target", label: "預計完成", aliases: ["預計完成日", "目標日", "目標完成", "預計完成季度"], width: 12 },
    { key: "goal", label: "專案目標", aliases: ["目標", "說明", "專案說明"], width: 44 },
  ],
  items: [
    { key: "project", label: "專案名稱", required: true, aliases: ["專案", "案名", "計畫名稱", "project"], width: 30 },
    { key: "type", label: "類型", aliases: ["種類", "項目類型"], width: 10 },
    { key: "title", label: "項目名稱", required: true, aliases: ["工作項目", "任務", "事項", "任務名稱", "item", "title"], width: 40 },
    { key: "stage", label: "階段", aliases: ["看板階段", "欄位"], width: 12 },
    { key: "assignee", label: "負責人", aliases: ["負責", "執行人", "承辦人", "assignee"], width: 14 },
    { key: "start", label: "開始日", aliases: ["起始日", "開始日期"], width: 12 },
    { key: "end", label: "結束／到期日", aliases: ["到期日", "截止日", "結束日", "預計完成日", "完成日", "日期", "due"], width: 14 },
    { key: "done", label: "完成", aliases: ["是否完成", "已完成", "done"], width: 8 },
  ],
  updates: [
    { key: "project", label: "專案名稱", required: true, aliases: ["專案", "案名", "計畫名稱", "project"], width: 30 },
    { key: "date", label: "日期", required: true, aliases: ["紀錄日期", "更新日期", "date"], width: 12 },
    { key: "content", label: "內容", required: true, aliases: ["進度", "進度說明", "說明", "進度內容", "content"], width: 70 },
  ],
};

export const CHOICES = {
  status: [["進行中", "active"], ["暫停", "paused"], ["已完成", "done"], ["已歸檔", "archived"]] as const,
  visibility: [["同組", "group"], ["全公司", "all"], ["私人", "private"]] as const,
  type: ["任務", "里程碑", "歷程事件"] as const,
  done: ["是", "否"] as const,
};

const ALIASES: Record<string, string[]> = {
  active: ["進行中", "進行", "執行中", "active"], paused: ["暫停", "暫緩", "paused"], done: ["已完成", "完成", "結案", "done"], archived: ["已歸檔", "歸檔", "archived"],
  group: ["同組", "組內", "group"], all: ["全公司", "所有人", "公開", "all"], private: ["私人", "僅自己", "private"],
  任務: ["任務", "工作", "待辦", "task"], 里程碑: ["里程碑", "milestone"], 歷程事件: ["歷程事件", "歷程", "事件", "event"],
};

export interface Issue {
  level: "error" | "warning";
  sheet: string;
  /** Excel 上看到的列號（標題是第 1 列）；整張表的問題為 null。 */
  row: number | null;
  column: string | null;
  message: string;
}

export interface ProjectPreview {
  name: string;
  isNew: boolean;
  /** 只出現在工作項目或進度紀錄、系統上又找不到的專案。 */
  missing?: boolean;
  tasks: number; milestones: number; events: number; updates: number;
}

export interface ConversionResult {
  payload: { projects: Array<Record<string, unknown>> };
  issues: Issue[];
  projects: ProjectPreview[];
}

// ── 值的正規化 ─────────────────────────────────────────────────────────

const normalizeHeader = (value: string) => value.replace(/[（(][^）)]*[）)]/g, "").replace(/[\s*＊:：]/g, "").toLowerCase();

function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isInteger(cell) ? String(cell) : String(Number(cell.toFixed(10)));
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return cell.replace(/\r\n?/g, "\n").trim();
}

function choice(value: string, options: readonly string[]): string | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  for (const option of options) if ((ALIASES[option] ?? [option]).some((alias) => alias.toLowerCase() === needle)) return option;
  return null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function realDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > lastDay(year, month)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Excel 日期序號轉日期。1900 系統的 1 是 1900-01-01，但 Excel 誤把 1900 當閏年，所以用 1899-12-30 當原點。 */
export function excelSerialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const origin = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(origin + Math.floor(serial) * 86_400_000);
  return realDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export interface ParsedDate { date: string | null; note?: string; error?: string }

/**
 * 表格裡的日期什麼樣子都有：Excel 日期、2026/9/30、2026.9.30、115/9/30（民國）、
 * 2026年9月30日。只有年月的當作該月最後一天，並提醒。
 */
export function parseDate(cell: Cell | undefined, date1904 = false): ParsedDate {
  if (cell === null || cell === undefined || cell === "") return { date: null };
  if (typeof cell === "number") {
    const date = cell > 20000 && cell < 80000 ? excelSerialToDate(cell, date1904) : null;
    return date ? { date } : { date: null, error: `看不懂的日期：${cell}` };
  }
  if (typeof cell === "boolean") return { date: null, error: "日期欄填了是非值" };
  const value = cell.trim().replace(/\s+/g, "").replace(/^民國/, "");
  const roc = (year: number) => year < 1000 ? year + 1911 : year;
  let match = /^(\d{2,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:T.*)?$/.exec(value);
  if (match) {
    const date = realDate(roc(Number(match[1])), Number(match[2]), Number(match[3]));
    return date ? { date } : { date: null, error: `不存在的日期：${cell}` };
  }
  match = /^(\d{2,4})[-/.年](\d{1,2})月?$/.exec(value);
  if (match) {
    const year = roc(Number(match[1]));
    const month = Number(match[2]);
    const date = realDate(year, month, month >= 1 && month <= 12 ? lastDay(year, month) : 1);
    return date ? { date, note: `只有年月，已當作 ${date}` } : { date: null, error: `不存在的日期：${cell}` };
  }
  return { date: null, error: `看不懂的日期：${cell}（請寫成 2026-09-30）` };
}

/** 預計完成可以寫季度：2026 Q4、2026Q4、2026 第4季、2026年第四季。 */
export function parseTarget(cell: Cell | undefined, date1904 = false): ParsedDate {
  if (typeof cell === "string") {
    const value = cell.trim().replace(/\s+/g, "");
    const quarter = /^(\d{4})年?[-/]?(?:Q|第)([1-4一二三四])季?$/i.exec(value);
    if (quarter) {
      const number = "一二三四".includes(quarter[2]) ? "一二三四".indexOf(quarter[2]) + 1 : Number(quarter[2]);
      return { date: quarterEndDate(Number(quarter[1]), number) };
    }
  }
  return parseDate(cell, date1904);
}

function parseDone(value: string): boolean | null | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  if (["是", "y", "yes", "true", "1", "v", "✓", "✔", "完成", "已完成", "done", "o", "○"].includes(needle)) return true;
  if (["否", "n", "no", "false", "0", "x", "✗", "未完成", "進行中", "未"].includes(needle)) return false;
  return null;
}

// ── 讀表 ───────────────────────────────────────────────────────────────

/** headerRow 是 Excel 上的列號，用來把問題指回使用者看得到的那一列。 */
interface Table { kind: SheetKind; name: string; map: Map<string, number>; rows: Cell[][]; headerRow: number }

/** 標題列：前 5 列裡第一個對得到必填欄位的列。上方多一兩列標題文字也能讀。 */
function findHeader(rows: Cell[][], kind: SheetKind): { index: number; map: Map<string, number>; unknown: string[] } | null {
  const lookup = new Map<string, string>();
  for (const column of COLUMNS[kind]) for (const label of [column.label, ...(column.aliases ?? [])]) lookup.set(normalizeHeader(label), column.key);
  for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
    const map = new Map<string, number>();
    const unknown: string[] = [];
    (rows[index] ?? []).forEach((cell, column) => {
      const text = cellText(cell);
      if (!text) return;
      const key = lookup.get(normalizeHeader(text));
      if (key && !map.has(key)) map.set(key, column);
      else if (!key) unknown.push(text);
    });
    if (COLUMNS[kind].filter((column) => column.required).every((column) => map.has(column.key))) return { index, map, unknown };
  }
  return null;
}

const IGNORED_SHEETS = /說明|範例|選項|指令|ai/i;

function locateTables(workbook: Workbook, issues: Issue[]): Table[] {
  const tables: Table[] = [];
  const claimed = new Set<SheetKind>();
  const add = (kind: SheetKind, sheet: Workbook["sheets"][number], header: NonNullable<ReturnType<typeof findHeader>>) => {
    claimed.add(kind);
    tables.push({ kind, name: sheet.name, map: header.map, rows: sheet.rows.slice(header.index + 1), headerRow: header.index + 1 });
    if (header.unknown.length) issues.push({ level: "warning", sheet: sheet.name, row: header.index + 1, column: null, message: `這些欄位不在範本裡，已略過：${header.unknown.join("、")}` });
  };
  // 先依工作表名稱配對；對不到名稱的再看標題長得像哪一張（例如 AI 整理後貼到新檔案的「工作表1」）。
  for (const [kind, name] of Object.entries(SHEET) as Array<[SheetKind, string]>) {
    const sheet = workbook.sheets.find((item) => item.name.trim() === name);
    if (!sheet) continue;
    const header = findHeader(sheet.rows, kind);
    if (header) add(kind, sheet, header);
    else issues.push({ level: "error", sheet: sheet.name, row: null, column: null, message: `找不到標題列，必填欄位是：${COLUMNS[kind].filter((column) => column.required).map((column) => column.label).join("、")}` });
  }
  for (const sheet of workbook.sheets) {
    if (tables.some((table) => table.name === sheet.name) || Object.values(SHEET).includes(sheet.name.trim() as never) || IGNORED_SHEETS.test(sheet.name)) continue;
    for (const kind of ["items", "updates", "projects"] as SheetKind[]) {
      if (claimed.has(kind)) continue;
      const header = findHeader(sheet.rows, kind);
      if (header) { add(kind, sheet, header); break; }
    }
  }
  if (!tables.length) issues.push({ level: "error", sheet: "", row: null, column: null, message: `找不到「${SHEET.projects}」「${SHEET.items}」「${SHEET.updates}」任何一張工作表。請用範本填寫，第一列標題不要改` });
  return tables;
}

/** 把填好的活頁簿轉成匯入資料，並逐列列出問題。有任何 error 就不該送出。 */
export function workbookToPayload(workbook: Workbook, context: ImportContext): ConversionResult {
  const issues: Issue[] = [];
  const tables = locateTables(workbook, issues);
  const groupByName = new Map<string, string>();
  for (const group of context.groups) { groupByName.set(group.name.toLowerCase(), group.name); groupByName.set(group.id.toLowerCase(), group.name); }
  // 以正規化後的名稱比對（全形半形、空白不影響），對到時改用系統裡的正式名稱。
  const existing = new Map(context.existingProjects.map((item) => [normalizeProjectName(item.name), item.name.trim()]));
  const existingCodes = new Set(context.existingProjects.map((item) => item.external_key?.trim()).filter(Boolean));
  const byEmail = new Map(context.users.map((user) => [user.email.toLowerCase(), user.email]));
  const byName = new Map<string, string[]>();
  for (const user of context.users) byName.set(user.name.trim(), [...(byName.get(user.name.trim()) ?? []), user.email]);

  const projects = new Map<string, Record<string, unknown>>();
  const fromProjectSheet = new Set<string>();
  /** 只在另外兩張表出現的專案，記下第一次出現的位置，找不到時才指得回那一列。 */
  const firstReference = new Map<string, { sheet: string; row: number; column: string | null }>();
  /** 以正規化名稱為鍵：同一個專案在不同工作表寫法略有不同（全形半形、空白）也算同一個。 */
  const project = (name: string) => {
    const key = normalizeProjectName(name);
    let item = projects.get(key);
    if (!item) { item = { name: existing.get(key) ?? name }; projects.set(key, item); }
    return item;
  };
  const push = (item: Record<string, unknown>, field: string, value: unknown) => { (item[field] = (item[field] as unknown[] | undefined) ?? []); (item[field] as unknown[]).push(value); };

  for (const table of tables) {
    const { headerRow } = table;
    const col = (key: string) => table.map.get(key);
    table.rows.forEach((row, offset) => {
      const excelRow = headerRow + 1 + offset;
      const get = (key: string) => { const index = col(key); return index === undefined ? null : row[index] ?? null; };
      const text = (key: string) => cellText(get(key));
      if (!row.some((cell) => cellText(cell))) return;
      const issue = (level: Issue["level"], key: string | null, message: string) => {
        const column = key === null ? null : COLUMNS[table.kind].find((item) => item.key === key)?.label ?? key;
        const index = key === null ? undefined : col(key);
        issues.push({ level, sheet: table.name, row: excelRow, column: column && index !== undefined ? `${column}（${columnLetter(index)} 欄）` : column, message });
      };
      const date = (key: string, parse = parseDate) => {
        const parsed = parse(get(key), workbook.date1904);
        if (parsed.error) issue("error", key, parsed.error);
        if (parsed.note) issue("warning", key, parsed.note);
        return parsed.date;
      };

      const projectName = text(table.kind === "projects" ? "name" : "project");
      if (!projectName) { issue("error", table.kind === "projects" ? "name" : "project", "專案名稱不能空白"); return; }

      if (table.kind === "projects") {
        if (fromProjectSheet.has(normalizeProjectName(projectName))) { issue("error", "name", `「${projectName}」在這張表出現了兩次，請合併成一列`); return; }
        fromProjectSheet.add(normalizeProjectName(projectName));
        const item = project(projectName);
        const code = text("code");
        if (code) item.external_key = code;
        const groupText = text("group");
        if (groupText) {
          const group = groupByName.get(groupText.toLowerCase());
          if (group) item.group = group; else issue("error", "group", `沒有「${groupText}」這個組別，可填：${context.groups.map((g) => g.name).join("、")}`);
        }
        for (const [key, options] of [["status", CHOICES.status], ["visibility", CHOICES.visibility]] as const) {
          const value = text(key);
          if (!value) continue;
          const matched = choice(value, options.map(([, code]) => code));
          if (matched) item[key] = matched; else issue("error", key, `「${value}」不是有效的${key === "status" ? "狀態" : "可見性"}，可填：${options.map(([label]) => label).join("、")}`);
        }
        for (const key of ["product", "site"] as const) if (text(key)) item[key] = text(key);
        const goal = text("goal");
        if (goal) item.goal_summary = goal;
        const start = date("start");
        const target = date("target", parseTarget);
        if (start) item.start_date = start;
        if (target) item.target_date = target;
        if (start && target && start > target) issue("error", "target", "預計完成早於起始日");
        return;
      }

      const item = project(projectName);
      if (!firstReference.has(normalizeProjectName(projectName))) {
        const index = col("project");
        firstReference.set(normalizeProjectName(projectName), { sheet: table.name, row: excelRow, column: index === undefined ? null : `專案名稱（${columnLetter(index)} 欄）` });
      }
      if (table.kind === "updates") {
        const updateDate = date("date");
        const content = text("content");
        if (!updateDate && !get("date")) issue("error", "date", "日期不能空白");
        if (!content) issue("error", "content", "內容不能空白");
        if (updateDate && content) push(item, "progress_updates", { date: updateDate, content });
        return;
      }

      // 同一列的問題全部列出來，不在第一個錯誤就停——否則使用者要改一次、傳一次、再看到下一個。
      const before = issues.length;
      const title = text("title");
      if (!title) issue("error", "title", "項目名稱不能空白");
      const typeText = text("type");
      const type = typeText ? choice(typeText, CHOICES.type) : "任務";
      if (!type) issue("error", "type", `「${typeText}」不是有效的類型，可填：${CHOICES.type.join("、")}`);
      const start = date("start");
      const end = date("end");
      if (start && end && start > end) issue("error", "end", "結束／到期日早於開始日");
      const doneText = text("done");
      const done = parseDone(doneText);
      if (done === null) issue("error", "done", `「${doneText}」看不懂，請填「是」或「否」`);
      if (!title || !type || issues.slice(before).some((item) => item.level === "error")) return;
      const assigneeText = text("assignee");
      let assignee: string | undefined;
      if (assigneeText) {
        const email = byEmail.get(assigneeText.toLowerCase());
        const named = byName.get(assigneeText) ?? [];
        if (email) assignee = email;
        else if (named.length === 1) assignee = named[0];
        else {
          issue("warning", "assignee", named.length > 1 ? `有 ${named.length} 位同名的「${assigneeText}」，請改填 Email；先改掛你` : `系統上找不到「${assigneeText}」，會改掛你並在任務說明記下原負責人`);
          assignee = assigneeText;
        }
      }
      if (type === "任務") {
        const task: Record<string, unknown> = { title };
        const stage = text("stage");
        if (stage) task.stage = stage;
        if (assignee) task.assignee_email = assignee;
        if (start) task.start_date = start;
        if (end) task.due_date = end;
        if (done) task.done = true;
        push(item, "tasks", task);
        return;
      }
      if (text("stage")) issue("warning", "stage", "階段只用在任務，這一列會忽略");
      if (assigneeText) issue("warning", "assignee", "負責人只用在任務，這一列會忽略");
      if (type === "里程碑") {
        const milestone: Record<string, unknown> = { title };
        // 只填一個日期時，那就是里程碑的日期；兩個都填則是一段期間。
        if (start && end) { milestone.due_date = start; if (end !== start) milestone.end_date = end; }
        else if (start || end) milestone.due_date = start ?? end;
        if (done) milestone.done = true;
        push(item, "milestones", milestone);
        return;
      }
      if (!start && !end) { issue("error", "start", "歷程事件一定要有日期"); return; }
      if (doneText) issue("warning", "done", "歷程事件是已經發生的事，不用填完成");
      const event: Record<string, unknown> = { title, due_date: start ?? end };
      if (start && end && end !== start) event.end_date = end;
      push(item, "events", event);
    });
  }

  const previews: ProjectPreview[] = [];
  for (const [key, item] of projects) {
    const name = item.name as string;
    const code = item.external_key as string | undefined;
    // 有代碼時以代碼判斷（重新匯入時改了名稱也對得上），沒有代碼才看名稱。
    const isNew = code ? !existingCodes.has(code) : !existing.has(key);
    if (fromProjectSheet.has(key)) {
      // 新專案沒填組別時用自己的組別。既有專案不補：補了會把專案搬到別組（管理員匯入時真的會搬）。
      if (isNew && !item.group) item.group = context.me.group_name;
    } else if (!existing.has(key)) {
      const where = firstReference.get(key);
      const guess = closestProjectName(name, [...existing.values()]);
      issues.push({ level: "error", sheet: where?.sheet ?? SHEET.items, row: where?.row ?? null, column: where?.column ?? null,
        message: `找不到專案「${name}」。${guess ? `是不是「${guess}」？名稱要跟系統上一致。` : ""}新專案請先在「${SHEET.projects}」工作表加一列` });
    }
    const count = (field: string) => (item[field] as unknown[] | undefined)?.length ?? 0;
    previews.push({ name, isNew: isNew && fromProjectSheet.has(key), ...(!fromProjectSheet.has(key) && !existing.has(key) ? { missing: true } : {}), tasks: count("tasks"), milestones: count("milestones"), events: count("events"), updates: count("progress_updates") });
  }
  if (tables.length && !projects.size) issues.push({ level: "error", sheet: "", row: null, column: null, message: "沒有讀到任何資料列。範本的第一列是標題，資料請從第二列開始填" });
  return { payload: { projects: [...projects.values()] }, issues, projects: previews };
}

/** 直接上傳 JSON 時的預覽：只數每個專案有幾筆，新舊依名稱或代碼判斷。 */
export function previewPayload(payload: unknown, context: Pick<ImportContext, "existingProjects">): ProjectPreview[] {
  const projects = (payload as { projects?: unknown })?.projects;
  if (!Array.isArray(projects)) return [];
  const names = new Set(context.existingProjects.map((item) => normalizeProjectName(item.name)));
  const codes = new Set(context.existingProjects.map((item) => item.external_key?.trim()).filter(Boolean));
  return projects.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null).map((item) => {
    const name = typeof item.name === "string" ? item.name.trim() : String(item.external_key ?? "");
    const code = typeof item.external_key === "string" ? item.external_key.trim() : "";
    const count = (field: string) => Array.isArray(item[field]) ? (item[field] as unknown[]).length : 0;
    return { name, isNew: code ? !codes.has(code) : !names.has(normalizeProjectName(name)), tasks: count("tasks"), milestones: count("milestones"), events: count("events"), updates: count("progress_updates") };
  });
}

// ── 範本 ───────────────────────────────────────────────────────────────

/** 範本與給 AI 的指令裡的範例。範例放在另一張工作表，不會被當成資料匯入。 */
export const EXAMPLES: Record<SheetKind, string[][]> = {
  projects: [
    ["原料藥來源變更", "RA-2026-01", "", "進行中", "同組", "範例錠 10mg", "範例原料廠", "2026-01-15", "2026 Q4", "完成原料藥第二來源變更並取得核准"],
    ["年度 GMP 自我查核", "", "", "進行中", "同組", "", "", "2026-03-01", "2026-11-30", "完成年度查核與缺失改善"],
  ],
  items: [
    ["原料藥來源變更", "歷程事件", "召開變更評估會議", "", "", "2026-01-20", "", ""],
    ["原料藥來源變更", "任務", "收集新廠商 DMF 與 CoA", "進行中", "", "2026-01-20", "2026-02-28", "是"],
    ["原料藥來源變更", "里程碑", "遞交變更申請", "", "", "", "2026-05-25", "是"],
    ["原料藥來源變更", "里程碑", "CDE 審查期", "", "", "2026-06-01", "2026-08-31", "否"],
    ["原料藥來源變更", "任務", "回覆補件缺失", "待辦", "", "", "2026-10-28", "否"],
    ["年度 GMP 自我查核", "任務", "盤點上年度缺失", "完成", "", "", "2026-03-15", "是"],
  ],
  updates: [
    ["原料藥來源變更", "2026-05-28", "已遞交變更申請，TFDA 收文。"],
    ["原料藥來源變更", "2026-08-31", "收到補件通知，共 6 點，主要是元素不純物評估與三批成品檢驗結果。"],
  ],
};

const headers = (kind: SheetKind) => COLUMNS[kind].map((column) => column.required ? `${column.label}＊` : column.label);

/** 給 AI 的整理指令，一行一句。放在範本裡，也讓匯入頁可以一鍵複製。 */
export function aiInstructions(context: Pick<ImportContext, "groups" | "users">): string[] {
  const line = (kind: SheetKind) => COLUMNS[kind].map((column) => column.label).join("\t");
  return [
    "你是資料整理助手。請把我接下來貼上的「原始工作進度表」，整理成「艾爾水晶批次匯入範本」的三張表格。",
    "",
    "【輸出格式】",
    "請輸出三個表格，依序是「專案」「工作項目」「進度紀錄」。每個表格前面單獨一行寫表格名稱，第一列是欄位名稱，名稱與順序必須完全照下面這樣：",
    `專案：${line("projects").replace(/\t/g, "｜")}`,
    `工作項目：${line("items").replace(/\t/g, "｜")}`,
    `進度紀錄：${line("updates").replace(/\t/g, "｜")}`,
    "欄位之間用 Tab 分隔（這樣可以直接貼回 Excel），不要用 Markdown 表格，也不要在表格裡加任何說明文字。",
    "三個表格都輸出完之後，另外用「整理備註」列出你略過的內容、做的假設、以及看不懂的地方。",
    "",
    "【怎麼分表】",
    "1. 每個專案在「專案」表只寫一列。「工作項目」與「進度紀錄」用「專案名稱」對應，名稱必須一字不差。",
    "2. 「工作項目」的「類型」只能填：任務、里程碑、歷程事件。",
    "   - 要去做的事、待辦事項 → 任務",
    "   - 重要的交付點或期限（送件、核准、取得證書、截止日）→ 里程碑",
    "   - 已經發生過的事（開會、收到公文、對方回覆）→ 歷程事件，一定要有日期",
    "3. 原始表裡的進度說明、備註、會議紀錄，依日期拆成「進度紀錄」，一個日期一列。沒有日期的說明放進「專案目標」，不要自己編日期。",
    "",
    "【欄位規則】",
    "4. 日期一律寫成 YYYY-MM-DD，例如 2026-09-30。民國年要換成西元（115/9/30 → 2026-09-30）。只有年月的寫該月最後一天；完全沒有日期就留空，不要猜。",
    "5. 「預計完成」可以寫季度，例如 2026 Q4。",
    "6. 任務與里程碑的日期：只有一個日期就填在「結束／到期日」；有起訖期間才兩欄都填。",
    "7. 「完成」只能填：是、否。已完成、Done、✓ → 是。歷程事件不用填。",
    `8. 「狀態」只能填：${CHOICES.status.map(([label]) => label).join("、")}。「可見性」只能填：${CHOICES.visibility.map(([label]) => label).join("、")}。不確定就留空。`,
    `9. 「組別」只能填：${context.groups.map((group) => group.name).join("、")}。不確定就留空（會用上傳者的組別）。`,
    `10. 「負責人」填系統上的姓名或 Email：${context.users.map((user) => user.name).join("、") || "（向管理員確認）"}。對不上的就留空。`,
    "11. 「階段」是看板上的欄位，例如 待辦、進行中、完成；原始表沒有對應資訊就留空。",
    "12. 「專案代碼」可以留空。已經在系統上的專案不用寫進「專案」表，直接在另外兩張表寫它的名稱就好。",
    "13. 不要發明原始資料沒有的內容；看不懂的欄位就略過，寫進「整理備註」。",
    "",
    "【範例】",
    "專案",
    line("projects"),
    ...EXAMPLES.projects.map((row) => row.join("\t")),
    "工作項目",
    line("items"),
    ...EXAMPLES.items.map((row) => row.join("\t")),
    "進度紀錄",
    line("updates"),
    ...EXAMPLES.updates.map((row) => row.join("\t")),
    "",
    "以下是我的原始工作進度表：",
  ];
}

/** 下載用的範本。組別與成員名單即時帶入，所以下拉選單永遠是現在系統裡的值。 */
export function templateSheets(context: ImportContext): SheetSpec[] {
  const maxRows = 1000;
  const optionColumns: Array<[string, string[]]> = [
    ["組別", context.groups.map((group) => group.name)],
    ["狀態", CHOICES.status.map(([label]) => label)],
    ["可見性", CHOICES.visibility.map(([label]) => label)],
    ["類型", [...CHOICES.type]],
    ["完成", [...CHOICES.done]],
    ["負責人（姓名）", context.users.map((user) => user.name)],
    ["負責人（Email）", context.users.map((user) => user.email)],
  ];
  const optionRows = Math.max(...optionColumns.map(([, values]) => values.length));
  const optionRange = (label: string) => {
    const index = optionColumns.findIndex(([name]) => name === label);
    const size = Math.max(1, optionColumns[index][1].length);
    return `'選項清單'!$${columnLetter(index)}$2:$${columnLetter(index)}$${size + 1}`;
  };
  const range = (kind: SheetKind, key: string) => { const letter = columnLetter(COLUMNS[kind].findIndex((column) => column.key === key)); return `${letter}2:${letter}${maxRows}`; };
  const data = (kind: SheetKind): Pick<SheetSpec, "rows" | "widths" | "header" | "columnStyles"> => ({
    rows: [headers(kind)], widths: COLUMNS[kind].map((column) => column.width), header: true,
    columnStyles: COLUMNS[kind].map((column) => column.text ? STYLE.text : undefined),
  });

  const help: string[][] = [
    ["艾爾水晶 批次匯入範本"],
    [`下載者：${context.me.name}（${context.me.group_name}）`],
    [""],
    ["怎麼用"],
    ["1. 在「專案」「工作項目」「進度紀錄」三張表填資料。第一列標題不要改，欄位順序可以調整。"],
    ["2. 存檔後到艾爾水晶 → 專案 → 批次匯入上傳。系統會立刻檢查，列出哪一張表、第幾列、哪一欄有問題。"],
    ["3. 一般使用者送出後由管理員審核，核准後才會出現在系統上；管理員上傳則直接匯入。"],
    ["4. 不想自己搬資料的話，把「給AI的整理指令」連同你原本的工作進度表貼給 AI（ChatGPT、Claude 等），請它整理成這三張表，再貼回來。"],
    [""],
    ["三張表的關係"],
    ["用「專案名稱」連起來，名稱要一字不差。已經在系統上的專案不用寫進「專案」表，直接在另外兩張表寫它的名稱即可。"],
    ["系統上有同名的專案時會併入那個專案；有兩個以上同名時，請在「專案」表填專案代碼區分。"],
    [""],
    ["欄位說明（＊ 為必填）"],
    ["專案｜專案名稱＊：專案的名稱。"],
    ["專案｜專案代碼：選填。填了之後，之後重新匯入會以代碼對應同一個專案，改名也不怕。"],
    [`專案｜組別：${context.groups.map((group) => group.name).join("、")}。新專案沒填時用你的組別。`],
    [`專案｜狀態：${CHOICES.status.map(([label]) => label).join("、")}。可見性：${CHOICES.visibility.map(([label]) => label).join("、")}。`],
    ["專案｜起始日、預計完成：日期寫 2026-09-30；預計完成也可以寫季度，例如 2026 Q4。"],
    ["工作項目｜類型：任務（要做的事）、里程碑（重要期限或交付點）、歷程事件（已經發生的事，一定要有日期）。沒填當作任務。"],
    ["工作項目｜階段：只用在任務，就是看板上的欄位，例如 待辦、進行中、完成。沒有的階段會自動建立。"],
    ["工作項目｜負責人：只用在任務，填系統上的姓名或 Email（見「選項清單」）。"],
    ["工作項目｜開始日、結束／到期日：只有一個日期時填在「結束／到期日」；有起訖期間才兩欄都填。"],
    ["工作項目｜完成：是 / 否。"],
    ["進度紀錄｜日期＊、內容＊：一個日期一列，會記在上傳者名下。"],
    [""],
    ["日期可以怎麼寫"],
    ["2026-09-30、2026/9/30、2026.9.30、115/9/30（民國）、2026年9月30日都可以；只有年月（2026-09）會當作該月最後一天並提醒你。"],
    [""],
    ["重新匯入是安全的"],
    ["同一專案同一階段同名的任務、同名同日期的里程碑與歷程事件、同一天內容開頭相同的進度紀錄，都不會重複建立。修正後整份重新上傳即可。"],
    [""],
    ["注意"],
    ["新專案的擁有者是上傳的人；進度紀錄記在上傳者名下。只能動你有編輯權的專案。"],
    ["法規動態、KR、證照效期、CCR、臨床收案不能用這份範本匯入，請洽管理員。"],
    ["「範例」工作表只是示範，不會被匯入。"],
  ];
  const helpStyles = help.map(([text], index) => index === 0 ? STYLE.title : ["怎麼用", "三張表的關係", "欄位說明（＊ 為必填）", "日期可以怎麼寫", "重新匯入是安全的", "注意"].includes(text) ? STYLE.subtitle : STYLE.wrap);

  const exampleRows: string[][] = [];
  const exampleStyles: Array<number | undefined> = [];
  for (const kind of ["projects", "items", "updates"] as SheetKind[]) {
    exampleRows.push([`「${SHEET[kind]}」工作表的範例`]); exampleStyles.push(STYLE.subtitle);
    exampleRows.push(headers(kind)); exampleStyles.push(STYLE.header);
    for (const row of EXAMPLES[kind]) { exampleRows.push(row.map((cell, index) => kind === "projects" && index === 2 && !cell ? context.me.group_name : cell)); exampleStyles.push(undefined); }
    exampleRows.push([]); exampleStyles.push(undefined);
  }
  const instructions = aiInstructions(context);

  return [
    { name: "說明", rows: help, widths: [120], rowStyles: helpStyles },
    { ...data("projects"), name: SHEET.projects, validations: [
      { range: range("projects", "group"), source: optionRange("組別") },
      { range: range("projects", "status"), source: optionRange("狀態") },
      { range: range("projects", "visibility"), source: optionRange("可見性") },
    ] },
    { ...data("items"), name: SHEET.items, validations: [
      { range: range("items", "type"), source: optionRange("類型") },
      { range: range("items", "done"), source: optionRange("完成") },
      { range: range("items", "assignee"), source: optionRange("負責人（姓名）") },
    ] },
    { ...data("updates"), name: SHEET.updates },
    { name: "給AI的整理指令", rows: [["選取 A3 以下整欄複製，貼給 AI，再接著貼上你的原始工作進度表。"], [""], ...instructions.map((text) => [text])], widths: [140], rowStyles: [STYLE.subtitle] },
    { name: "範例", rows: exampleRows, widths: [30, 16, 40, 12, 12, 14, 18, 12, 12, 44], rowStyles: exampleStyles },
    { name: "選項清單", rows: [optionColumns.map(([label]) => label), ...Array.from({ length: optionRows }, (_, row) => optionColumns.map(([, values]) => values[row] ?? null))], widths: optionColumns.map(() => 18), header: true },
  ];
}
