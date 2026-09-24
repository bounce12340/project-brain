/**
 * 最小的 .xlsx 讀寫，只做批次匯入需要的部分，不引入套件。
 *
 * .xlsx 是一個 zip，裡面是幾份 XML。讀的時候用瀏覽器與 Node 都內建的
 * DecompressionStream("deflate-raw") 解壓；寫的時候只用「不壓縮（stored）」，
 * 因此不需要壓縮器。XML 是 Excel 產生的固定結構，用正規表示式讀即可，
 * 這樣同一份程式在測試（Node，沒有 DOMParser）與瀏覽器裡都能跑。
 */

export type Cell = string | number | boolean | null;
export interface Sheet { name: string; rows: Cell[][] }
export interface Workbook { sheets: Sheet[]; date1904: boolean }

// ── zip ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class XlsxError extends Error {}

/** 讀出 zip 裡的所有檔案。只支援 stored 與 deflate，xlsx 用的就是這兩種。 */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new XlsxError("這不是 Excel 檔（.xlsx）。舊版 .xls 請先另存成 .xlsx");
  const entries = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new XlsxError("Excel 檔已損毀");
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new XlsxError("Excel 檔使用了不支援的壓縮方式");
  }
  return files;
}

/** 寫出 zip（不壓縮）。時間固定，同樣內容永遠產生同樣的位元組。 */
export function zip(files: Array<[string, Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true); lv.setUint16(12, DOS_DATE, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    const header = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true); cv.setUint16(14, DOS_DATE, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    chunks.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const part of [...chunks, ...central, endRecord]) { out.set(part, position); position += part.length; }
  return out;
}

// ── XML ────────────────────────────────────────────────────────────────

export function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "amp") return "&";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

export function escapeXml(value: string): string {
  // XML 1.0 不允許大部分控制字元；從別的系統貼來的文字偶爾會夾帶，留著會讓 Excel 打不開。
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) result[match[1]] = decodeXml(match[3] ?? match[4] ?? "");
  return result;
}

/** 一段 <si> 或 <is> 裡的純文字。<rPh> 是日文注音用的標音，不屬於內容，要先拿掉。 */
function richText(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += decodeXml(match[1]);
  return text;
}

/** "AB12" → 欄 27（從 0 起算）。 */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function columnLetter(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) { const rest = (value - 1) % 26; letters = String.fromCharCode(65 + rest) + letters; value = Math.floor((value - 1) / 26); }
  return letters;
}

function parseSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttributes = attributes(rowMatch[1]);
    const rowIndex = rowAttributes.r ? Number(rowAttributes.r) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: Cell[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttributes = attributes(cellMatch[1]);
      const column = cellAttributes.r ? columnIndex(cellAttributes.r) : nextColumn;
      nextColumn = column + 1;
      const body = cellMatch[2] ?? "";
      const type = cellAttributes.t ?? "n";
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "s") value = rawValue === undefined ? null : shared[Number(rawValue)] ?? null;
      else if (type === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str" || type === "d") value = rawValue === undefined ? null : decodeXml(rawValue);
      else if (type === "b") value = rawValue === undefined ? null : rawValue.trim() === "1";
      else if (type === "e") value = null;
      else if (rawValue !== undefined && rawValue.trim() !== "") {
        const number = Number(rawValue);
        value = Number.isFinite(number) ? number : decodeXml(rawValue);
      }
      cells[column] = value;
    }
    for (let index = 0; index < cells.length; index += 1) if (cells[index] === undefined) cells[index] = null;
    rows[rowIndex] = cells;
  }
  for (let index = 0; index < rows.length; index += 1) if (rows[index] === undefined) rows[index] = [];
  return rows;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
  return out.join("/");
}

export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  const files = await unzip(bytes);
  const text = (path: string) => { const file = files.get(path); return file ? new TextDecoder().decode(file) : null; };
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new XlsxError("這個 zip 裡沒有 Excel 活頁簿");
  const rels = new Map<string, string>();
  for (const match of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = attributes(match[0]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, resolveTarget(attrs.Target));
  }
  const shared: string[] = [];
  for (const match of (text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(richText(match[1] ?? ""));
  const workbookPr = /<workbookPr\b[^>]*>/.exec(workbook)?.[0] ?? "";
  const date1904 = ["1", "true"].includes(attributes(workbookPr).date1904 ?? "");
  const sheets: Sheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const attrs = attributes(match[0]);
    const path = rels.get(attrs["r:id"] ?? "") ?? "";
    const xml = text(path);
    if (xml && attrs.name) sheets.push({ name: attrs.name, rows: parseSheet(xml, shared) });
  }
  return { sheets, date1904 };
}

// ── 寫出 ───────────────────────────────────────────────────────────────

export const STYLE = { normal: 0, header: 1, wrap: 2, title: 3, text: 4, subtitle: 5 } as const;

export interface SheetSpec {
  name: string;
  rows: Array<Array<string | number | null>>;
  /** 欄寬（字元數）。 */
  widths?: number[];
  /** 第一列是標題：粗體、底色、凍結。 */
  header?: boolean;
  /** 每列的樣式（覆蓋預設）。 */
  rowStyles?: Array<number | undefined>;
  /** 整欄預設樣式，例如專案代碼設成文字格式，避免 007 變成 7。 */
  columnStyles?: Array<number | undefined>;
  /** 下拉選單。errorStyle 用 warning：可以填清單以外的值，只是會提醒。 */
  validations?: Array<{ range: string; source: string }>;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="12"/><color rgb="FF1F4E79"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(spec: SheetSpec, selected: boolean): string {
  const pane = spec.header ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` : "";
  const cols = (spec.widths ?? []).map((width, index) => {
    const style = spec.columnStyles?.[index];
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"${style ? ` style="${style}"` : ""}/>`;
  }).join("");
  const rows = spec.rows.map((row, rowIndex) => {
    const rowStyle = spec.rowStyles?.[rowIndex] ?? (spec.header && rowIndex === 0 ? STYLE.header : undefined);
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnLetter(columnIndex)}${rowIndex + 1}`;
      const style = rowStyle ?? spec.columnStyles?.[columnIndex];
      const styleAttr = style ? ` s="${style}"` : "";
      if (value === null || value === "") return style ? `<c r="${reference}"${styleAttr}/>` : "";
      if (typeof value === "number") return `<c r="${reference}"${styleAttr}><v>${value}</v></c>`;
      return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const validations = spec.validations?.length
    ? `<dataValidations count="${spec.validations.length}">${spec.validations.map((item) =>
      `<dataValidation type="list" errorStyle="warning" allowBlank="1" showErrorMessage="1" sqref="${item.range}"><formula1>${escapeXml(item.source)}</formula1></dataValidation>`).join("")}</dataValidations>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${selected ? ` tabSelected="1"` : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData>${validations}</worksheet>`;
}

export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const file = (path: string, content: string): [string, Uint8Array] => [path, encoder.encode(content)];
  const sheetEntries = sheets.map((sheet, index) => ({ ...sheet, id: index + 1 }));
  return zip([
    file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries.map((sheet) => `<Override PartName="/xl/worksheets/sheet${sheet.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetEntries.map((sheet) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${sheet.id}" r:id="rId${sheet.id}"/>`).join("")}</sheets></workbook>`),
    file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((sheet) => `<Relationship Id="rId${sheet.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.id}.xml"/>`).join("")}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    file("xl/styles.xml", STYLES_XML),
    ...sheetEntries.map((sheet, index) => file(`xl/worksheets/sheet${sheet.id}.xml`, sheetXml(sheet, index === 0))),
  ]);
}
