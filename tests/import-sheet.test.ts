import { describe, expect, it } from "vitest";
import {
  aiInstructions, COLUMNS, EXAMPLES, excelSerialToDate, parseDate, parseTarget, SHEET, templateSheets, workbookToPayload, type ImportContext,
} from "../src/import-sheet";
import { readXlsx, unzip, writeXlsx, type Cell, type Workbook } from "../src/xlsx";

const context: ImportContext = {
  groups: [{ id: "grp_general", name: "RA/PV組" }, { id: "grp_bd", name: "BD組" }],
  users: [{ name: "王小明", email: "ming@example.com" }, { name: "陳冠宇", email: "chen@example.com" }, { name: "同名", email: "a@example.com" }, { name: "同名", email: "b@example.com" }],
  me: { name: "管理者", email: "me@example.com", group_name: "RA/PV組" },
  existingProjects: [{ name: "RA：啟動Plenvu註冊" }, { name: "Salagen準備展延", external_key: null }, { name: "舊名稱", external_key: "OLD-1" }],
};
const header = (kind: keyof typeof SHEET) => COLUMNS[kind].map((column) => column.label);
const book = (sheets: Record<string, Cell[][]>, date1904 = false): Workbook => ({ sheets: Object.entries(sheets).map(([name, rows]) => ({ name, rows })), date1904 });
const errors = (result: ReturnType<typeof workbookToPayload>) => result.issues.filter((issue) => issue.level === "error");

describe("日期", () => {
  it.each([
    ["2026-09-30", "2026-09-30"], ["2026/9/30", "2026-09-30"], ["2026.9.30", "2026-09-30"], ["115/9/30", "2026-09-30"],
    ["民國115年9月30日", "2026-09-30"], ["2026年9月30日", "2026-09-30"], ["2026-09-30T00:00:00", "2026-09-30"], [" 2026 / 9 / 30 ", "2026-09-30"],
  ])("%s → %s", (input, expected) => expect(parseDate(input)).toEqual({ date: expected }));

  it("Excel 日期序號（1900 與 1904 兩種系統）", () => {
    expect(parseDate(46295)).toEqual({ date: "2026-09-30" });
    expect(parseDate(44833, true)).toEqual({ date: "2026-09-30" });
    expect(excelSerialToDate(45292)).toBe("2024-01-01");
  });

  it("只有年月時用該月最後一天，並提醒", () => {
    expect(parseDate("2026-02")).toEqual({ date: "2026-02-28", note: "只有年月，已當作 2026-02-28" });
    expect(parseDate("2028/2")).toMatchObject({ date: "2028-02-29" });
  });

  it("不存在或看不懂的日期回錯誤，不猜", () => {
    expect(parseDate("2026-02-30").error).toContain("不存在的日期");
    expect(parseDate("2026-13").error).toContain("不存在的日期");
    expect(parseDate("下週一").error).toContain("看不懂的日期");
    expect(parseDate(3.5).error).toContain("看不懂的日期");
    expect(parseDate(true).error).toBeTruthy();
  });

  it("空白就是沒有日期", () => {
    for (const value of [null, undefined, ""]) expect(parseDate(value)).toEqual({ date: null });
  });

  it("預計完成可以寫季度", () => {
    for (const value of ["2026 Q4", "2026Q4", "2026q4", "2026-Q4", "2026 第4季", "2026年第四季"]) expect(parseTarget(value)).toEqual({ date: "2026-12-31" });
    expect(parseTarget("2027 Q1")).toEqual({ date: "2027-03-31" });
    expect(parseTarget("2026-09-09")).toEqual({ date: "2026-09-09" });
  });
});

describe("範例資料轉換", () => {
  const result = workbookToPayload(book({
    [SHEET.projects]: [header("projects"), ...EXAMPLES.projects],
    [SHEET.items]: [header("items"), ...EXAMPLES.items],
    [SHEET.updates]: [header("updates"), ...EXAMPLES.updates],
  }), context);

  it("沒有任何錯誤或警告", () => expect(result.issues).toEqual([]));

  it("轉出的專案資料正確", () => {
    expect(result.payload.projects[0]).toEqual({
      name: "原料藥來源變更", external_key: "RA-2026-01", group: "RA/PV組", status: "active", visibility: "group", product: "範例錠 10mg", site: "範例原料廠",
      goal_summary: "完成原料藥第二來源變更並取得核准", start_date: "2026-01-15", target_date: "2026-12-31",
      events: [{ title: "召開變更評估會議", due_date: "2026-01-20" }],
      tasks: [
        { title: "收集新廠商 DMF 與 CoA", stage: "進行中", start_date: "2026-01-20", due_date: "2026-02-28", done: true },
        { title: "回覆補件缺失", stage: "待辦", due_date: "2026-10-28" },
      ],
      milestones: [{ title: "遞交變更申請", due_date: "2026-05-25", done: true }, { title: "CDE 審查期", due_date: "2026-06-01", end_date: "2026-08-31" }],
      progress_updates: [
        { date: "2026-05-28", content: "已遞交變更申請，TFDA 收文。" },
        { date: "2026-08-31", content: "收到補件通知，共 6 點，主要是元素不純物評估與三批成品檢驗結果。" },
      ],
    });
  });

  it("新專案沒填組別時用上傳者的組別（有代碼的也一樣）；預覽標出新舊", () => {
    expect(result.payload.projects[0].group).toBe("RA/PV組");
    expect(result.payload.projects[1].group).toBe("RA/PV組");
    expect(result.projects).toEqual([
      { name: "原料藥來源變更", isNew: true, tasks: 2, milestones: 2, events: 1, updates: 2 },
      { name: "年度 GMP 自我查核", isNew: true, tasks: 1, milestones: 0, events: 0, updates: 0 },
    ]);
  });
});

describe("既有專案", () => {
  it("只寫在工作項目表的既有專案不需要「專案」表，也不補組別", () => {
    const result = workbookToPayload(book({ [SHEET.items]: [header("items"), ["RA：啟動Plenvu註冊", "里程碑", "取得 PMF", "", "", "", "2027-04-30", ""]] }), context);
    expect(errors(result)).toEqual([]);
    expect(result.payload.projects).toEqual([{ name: "RA：啟動Plenvu註冊", milestones: [{ title: "取得 PMF", due_date: "2027-04-30" }] }]);
  });

  it("在「專案」表列出既有專案但沒填組別時不補——補了管理員匯入會把專案搬到別組", () => {
    const result = workbookToPayload(book({ [SHEET.projects]: [header("projects"), ["Salagen準備展延", "", "", "暫停"]] }), context);
    expect(result.payload.projects).toEqual([{ name: "Salagen準備展延", status: "paused" }]);
  });

  it("代碼對到既有專案時視為既有，即使表上的名稱改了；不補組別", () => {
    const result = workbookToPayload(book({ [SHEET.projects]: [header("projects"), ["新名稱", "OLD-1"]] }), context);
    expect(result.projects[0].isNew).toBe(false);
    expect(result.payload.projects).toEqual([{ name: "新名稱", external_key: "OLD-1" }]);
  });

  it("工作項目寫了系統上沒有、也沒在「專案」表的專案時報錯", () => {
    const result = workbookToPayload(book({ [SHEET.items]: [header("items"), ["打錯的專案名", "任務", "t"]] }), context);
    expect(errors(result)).toEqual([{ level: "error", sheet: SHEET.items, row: 2, column: "專案名稱（A 欄）", message: "找不到專案「打錯的專案名」。新專案請先在「專案」工作表加一列" }]);
  });
});

describe("逐列指出問題", () => {
  const result = workbookToPayload(book({
    [SHEET.projects]: [header("projects"), ["新案", "", "不存在組"], ["新案"]],
    [SHEET.items]: [header("items"),
      ["新案", "任務", "t1", "", "", "2026-10-01", "2026-09-01", "也許"],
      ["新案", "會議", "t2"],
      ["新案", "歷程事件", "沒日期的事件"],
      ["", "任務", "沒專案"],
      [],
      ["新案", "任務", ""],
      ["新案", "會議", "三個問題的列", "", "", "", "2026-13-01", "也許"],
    ],
  }), context);
  const at = (row: number) => errors(result).filter((issue) => issue.row === row).map((issue) => `${issue.column}：${issue.message}`);

  it("工作表、列號、欄位名稱與欄位字母都對", () => {
    expect(at(2).filter((text) => text.startsWith("組別"))).toEqual(["組別（C 欄）：沒有「不存在組」這個組別，可填：RA/PV組、BD組"]);
    expect(errors(result).find((issue) => issue.sheet === SHEET.projects && issue.row === 3)?.message).toBe("「新案」在這張表出現了兩次，請合併成一列");
  });

  it("工作項目的每一種錯", () => {
    const items = (row: number) => errors(result).filter((issue) => issue.sheet === SHEET.items && issue.row === row).map((issue) => issue.message);
    expect(items(2)).toEqual(["結束／到期日早於開始日", "「也許」看不懂，請填「是」或「否」"]);
    expect(items(3)).toEqual(["「會議」不是有效的類型，可填：任務、里程碑、歷程事件"]);
    expect(items(8)).toEqual(["「會議」不是有效的類型，可填：任務、里程碑、歷程事件", "不存在的日期：2026-13-01", "「也許」看不懂，請填「是」或「否」"]);
    expect(items(4)).toEqual(["歷程事件一定要有日期"]);
    expect(items(5)).toEqual(["專案名稱不能空白"]);
    // 第 6 列是空白列，直接略過；第 7 列才是下一個問題。
    expect(items(6)).toEqual([]);
    expect(items(7)).toEqual(["項目名稱不能空白"]);
  });
});

describe("負責人", () => {
  const run = (value: string) => workbookToPayload(book({ [SHEET.items]: [header("items"), ["Salagen準備展延", "任務", "t", "", value]] }), context);

  it("姓名或 Email 都對得到", () => {
    expect((run("王小明").payload.projects[0].tasks as Array<Record<string, unknown>>)[0].assignee_email).toBe("ming@example.com");
    expect((run("CHEN@example.com").payload.projects[0].tasks as Array<Record<string, unknown>>)[0].assignee_email).toBe("chen@example.com");
  });

  it("對不到或同名時是警告，不擋送出", () => {
    expect(run("路人甲").issues).toEqual([expect.objectContaining({ level: "warning", message: "系統上找不到「路人甲」，會改掛你並在任務說明記下原負責人" })]);
    expect(run("同名").issues[0].message).toContain("有 2 位同名的「同名」");
  });
});

describe("找表", () => {
  it("欄位順序打亂、標題上方多一列說明、欄名用別名，照樣讀得到", () => {
    const result = workbookToPayload(book({
      [SHEET.items]: [["我的工作進度"], ["完成", "到期日", "任務", "專案", "備註"], ["是", "2026/10/1", "送件", "Salagen準備展延", "隨便寫"]],
    }), context);
    expect(errors(result)).toEqual([]);
    expect(result.payload.projects[0].tasks).toEqual([{ title: "送件", due_date: "2026-10-01", done: true }]);
    expect(result.issues).toEqual([expect.objectContaining({ level: "warning", row: 2, message: "這些欄位不在範本裡，已略過：備註" })]);
  });

  it("工作表名稱不對時看標題判斷是哪一張（例如 AI 整理後貼進新檔的「工作表1」）", () => {
    const result = workbookToPayload(book({ "工作表1": [header("updates"), ["Salagen準備展延", "2026-09-22", "會議紀錄"]] }), context);
    expect(errors(result)).toEqual([]);
    expect(result.payload.projects[0].progress_updates).toEqual([{ date: "2026-09-22", content: "會議紀錄" }]);
  });

  it("說明、範例、選項這幾張不會被當成資料", () => {
    const result = workbookToPayload(book({ "範例": [header("items"), ["原料藥來源變更", "任務", "x"]] }), context);
    expect(errors(result).map((issue) => issue.message)[0]).toContain("找不到「專案」「工作項目」「進度紀錄」任何一張工作表");
  });

  it("只有標題沒有資料時明確說出來", () => {
    const result = workbookToPayload(book({ [SHEET.items]: [header("items")] }), context);
    expect(errors(result).map((issue) => issue.message)).toEqual(["沒有讀到任何資料列。範本的第一列是標題，資料請從第二列開始填"]);
  });
});

describe("範本", () => {
  it("下載的空白範本，自己的解析器讀得懂、會說沒有資料，而不是看不懂格式", async () => {
    const workbook = await readXlsx(writeXlsx(templateSheets(context)));
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["說明", "專案", "工作項目", "進度紀錄", "給AI的整理指令", "範例", "選項清單"]);
    expect(errors(workbookToPayload(workbook, context)).map((issue) => issue.message)).toEqual(["沒有讀到任何資料列。範本的第一列是標題，資料請從第二列開始填"]);
  });

  it("照範本填入範例資料後，寫出、讀回、轉換都沒有問題", async () => {
    const sheets = templateSheets(context).map((sheet) => {
      const kind = (Object.entries(SHEET).find(([, name]) => name === sheet.name) ?? [])[0] as keyof typeof SHEET | undefined;
      return kind ? { ...sheet, rows: [...sheet.rows, ...EXAMPLES[kind]] } : sheet;
    });
    const result = workbookToPayload(await readXlsx(writeXlsx(sheets)), context);
    expect(result.issues).toEqual([]);
    expect(result.payload.projects.map((item) => item.name)).toEqual(["原料藥來源變更", "年度 GMP 自我查核"]);
  });

  it("必填欄位的標題有標記，標記不影響解析", () => {
    const [, projects] = templateSheets(context);
    expect(projects.rows[0][0]).toBe("專案名稱＊");
    expect(projects.rows[0][1]).toBe("專案代碼");
  });

  it("下拉選單指向「選項清單」裡現在的組別與成員", async () => {
    const files = await unzip(writeXlsx(templateSheets(context)));
    const itemsXml = new TextDecoder().decode(files.get("xl/worksheets/sheet3.xml"));
    expect(itemsXml).toContain(`sqref="B2:B1000"><formula1>'選項清單'!$D$2:$D$4</formula1>`);
    const options = (await readXlsx(writeXlsx(templateSheets(context)))).sheets.find((sheet) => sheet.name === "選項清單")!;
    expect(options.rows.map((row) => row[0]).filter(Boolean)).toEqual(["組別", "RA/PV組", "BD組"]);
    expect(options.rows.map((row) => row[5]).filter(Boolean)).toEqual(["負責人（姓名）", "王小明", "陳冠宇", "同名", "同名"]);
  });

  it("專案代碼欄是文字格式，007 不會變成 7", () => {
    const [, projects] = templateSheets(context);
    expect(projects.columnStyles?.[1]).toBe(4);
  });
});

describe("給 AI 的整理指令", () => {
  const lines = aiInstructions(context);

  it("帶入現在的組別與成員名單", () => {
    expect(lines.join("\n")).toContain("「組別」只能填：RA/PV組、BD組");
    expect(lines.join("\n")).toContain("王小明、陳冠宇");
  });

  it("指令裡寫的欄位名稱與範本一字不差", () => {
    for (const kind of ["projects", "items", "updates"] as const) {
      expect(lines).toContain(`${SHEET[kind]}：${header(kind).join("｜")}`);
    }
  });

  it("指令裡的範例本身就是合法的匯入資料——AI 照做，產出就能匯入", () => {
    const start = lines.indexOf("【範例】");
    const tables: Record<string, Cell[][]> = {};
    let current = "";
    for (const line of lines.slice(start + 1)) {
      if (!line || line.startsWith("以下是我的")) break;
      if (!line.includes("\t")) { current = line; tables[current] = []; continue; }
      tables[current].push(line.split("\t"));
    }
    expect(Object.keys(tables)).toEqual([SHEET.projects, SHEET.items, SHEET.updates]);
    expect(workbookToPayload(book(tables), context).issues).toEqual([]);
  });

  it("每一行都不含換行——在 Excel 裡一格一行，整欄複製才不會被加上引號", () => {
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });
});
