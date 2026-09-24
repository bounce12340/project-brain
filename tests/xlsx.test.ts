import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { columnIndex, columnLetter, crc32, readXlsx, unzip, writeXlsx, XlsxError } from "../src/xlsx";

/**
 * 真正的 Excel 檔是壓縮過的（deflate），而且用共用字串表、有時夾帶日文標音。
 * 自己寫自己讀只驗得到一半，所以另外手工組一份「長得像 Excel 存出來」的檔案。
 */
function deflatedZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = encoder.encode(content);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const header = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    parts.push(local, data); central.push(header);
    offset += local.length + data.length;
  }
  const size = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let position = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, position); position += part.length; }
  return out;
}

const excelLike = (workbookPr = "<workbookPr/>") => deflatedZip({
  "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r">${workbookPr}<sheets><sheet name="工作項目" sheetId="3" r:id="rId7"/><sheet name="空的" sheetId="4" r:id="rId8"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId8" Type="ws" Target="/xl/worksheets/sheet9.xml"/><Relationship Target="worksheets/sheet2.xml" Id="rId7" Type="ws"/></Relationships>`,
  "xl/sharedStrings.xml": `<?xml version="1.0"?><sst count="4"><si><t>專案名稱</t></si><si><r><rPr><b/></rPr><t>Salagen </t></r><r><t xml:space="preserve">包材 &amp; 變更</t></r><rPh sb="0" eb="1"><t>サラ</t></rPh></si><si><t/></si><si><t>第一行&#10;第二行</t></si></sst>`,
  "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1" spans="1:4"><c r="A1" t="s"><v>0</v></c><c r="D1" t="inlineStr"><is><t>到期日</t></is></c></row>
    <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="2"/><c r="C3" t="b"><v>1</v></c><c r="D3" s="5"><v>46295</v></c><c r="E3" t="str"><f>A3</f><v>公式結果</v></c><c r="F3" t="e"><v>#N/A</v></c><c r="G3"><v>3.5</v></c><c r="H3" t="s"><v>3</v></c></row>
  </sheetData></worksheet>`,
  "xl/worksheets/sheet9.xml": `<?xml version="1.0"?><worksheet><sheetData/></worksheet>`,
});

describe("讀 Excel 存出來的檔案", () => {
  it("解壓 deflate、依關聯檔找到工作表（相對與絕對路徑都行）", async () => {
    const workbook = await readXlsx(excelLike());
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["工作項目", "空的"]);
    expect(workbook.sheets[1].rows).toEqual([]);
  });

  it("共用字串：合併多段格式、去掉日文標音、解開實體", async () => {
    const [sheet] = (await readXlsx(excelLike())).sheets;
    expect(sheet.rows[2][0]).toBe("Salagen 包材 & 變更");
    expect(sheet.rows[2][7]).toBe("第一行\n第二行");
  });

  it("各種儲存格型別，並依欄位字母放到正確位置", async () => {
    const [sheet] = (await readXlsx(excelLike())).sheets;
    expect(sheet.rows[0]).toEqual(["專案名稱", null, null, "到期日"]);
    expect(sheet.rows[1]).toEqual([]);
    expect(sheet.rows[2].slice(1, 7)).toEqual([null, true, 46295, "公式結果", null, 3.5]);
  });

  it("讀得出 1904 日期系統的旗標", async () => {
    expect((await readXlsx(excelLike())).date1904).toBe(false);
    expect((await readXlsx(excelLike('<workbookPr date1904="1"/>'))).date1904).toBe(true);
  });

  it("不是 xlsx 的檔案給看得懂的錯誤", async () => {
    await expect(unzip(new TextEncoder().encode("name,date\nA,2026-01-01"))).rejects.toThrow(XlsxError);
    await expect(unzip(new TextEncoder().encode("name,date\nA,2026-01-01"))).rejects.toThrow("舊版 .xls 請先另存成 .xlsx");
  });
});

describe("寫出再讀回", () => {
  it("文字、數字、換行、特殊字元都原樣回來", async () => {
    const bytes = writeXlsx([
      { name: "第一張", rows: [["標題", "數字"], ["A & <B> \"C\"", 42], ["多行\n文字", null]], header: true, widths: [20, 10] },
      { name: "第二張", rows: [[null, "跳過第一欄"]] },
    ]);
    const workbook = await readXlsx(bytes);
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["第一張", "第二張"]);
    expect(workbook.sheets[0].rows).toEqual([["標題", "數字"], ["A & <B> \"C\"", 42], ["多行\n文字"]]);
    expect(workbook.sheets[1].rows).toEqual([[null, "跳過第一欄"]]);
  });

  it("控制字元會被拿掉，否則 Excel 打不開", async () => {
    const workbook = await readXlsx(writeXlsx([{ name: "s", rows: [["a\u0001b\u000bc"]] }]));
    expect(workbook.sheets[0].rows[0][0]).toBe("abc");
  });

  it("同樣內容產生同樣的檔案", () => {
    const spec = [{ name: "s", rows: [["a", 1]] }];
    expect(writeXlsx(spec)).toEqual(writeXlsx(spec));
  });

  it("下拉選單與凍結標題列寫進工作表", async () => {
    const files = await unzip(writeXlsx([{ name: "s", rows: [["類型"]], header: true, validations: [{ range: "A2:A1000", source: "'選項清單'!$A$2:$A$4" }] }]));
    const xml = new TextDecoder().decode(files.get("xl/worksheets/sheet1.xml"));
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain(`<dataValidation type="list" errorStyle="warning" allowBlank="1" showErrorMessage="1" sqref="A2:A1000"><formula1>'選項清單'!$A$2:$A$4</formula1></dataValidation>`);
    // dataValidations 必須在 sheetData 之後，順序錯了 Excel 會說檔案損毀。
    expect(xml.indexOf("</sheetData>")).toBeLessThan(xml.indexOf("<dataValidations"));
  });
});

describe("欄位字母", () => {
  it("雙向換算", () => {
    for (const [letter, index] of [["A", 0], ["Z", 25], ["AA", 26], ["AZ", 51], ["BA", 52], ["ZZ", 701], ["AAA", 702]] as const) {
      expect(columnIndex(`${letter}12`)).toBe(index);
      expect(columnLetter(index)).toBe(letter);
    }
  });
});
