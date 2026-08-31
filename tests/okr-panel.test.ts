import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translations } from "../src/i18n/translations";

const source = readFileSync(new URL("../src/components/OkrPanel.tsx", import.meta.url), "utf8");
// 只取元件本體，避免把 SortableKr 的內容也算進來。
const panel = source.slice(source.indexOf("export function OkrPanel"), source.indexOf("function SortableKr"));

describe("OKR 面板的寫入動作不會靜默失敗", () => {
  it("四個寫入動作全部經過 run()", () => {
    // 修正前 saveObjective／update／remove／dragEnd 都是裸的 await api(...)，沒有 catch。
    // 失敗時 promise 靜靜地 reject，畫面完全不動，跟按鈕沒接上分不出來。
    for (const handler of ["saveObjective", "createKr", "update", "remove", "dragEnd"]) {
      const body = panel.slice(panel.indexOf(`const ${handler} =`), panel.indexOf(`const ${handler} =`) + 700);
      expect(body, handler).toContain("run(");
    }
  });

  it("run() 會把失敗寫進畫面看得到的狀態", () => {
    const helper = panel.slice(panel.indexOf("const run ="), panel.indexOf("const saveObjective"));
    expect(helper).toContain("catch");
    expect(helper).toContain("setActionError");
  });

  it("寫入失敗不會把整個面板換掉，只有載入失敗才會", () => {
    // 動作失敗時資料還在畫面上，整片換成錯誤訊息等於把使用者的內容藏起來。
    expect(panel).toContain("if (loadError) return <ErrorBox");
    expect(panel).not.toContain("if (actionError) return");
    expect(panel).toContain("{actionError && <ErrorBox");
  });

  it("排序送出失敗會把樂觀更新的順序放回去", () => {
    const drag = panel.slice(panel.indexOf("const dragEnd ="));
    expect(drag).toContain("const previous = data.key_results");
    expect(drag).toContain("key_results: previous");
  });
});

describe("儲存目標看得出來有沒有成功", () => {
  it("成功後顯示已儲存提示", () => {
    // 存檔成功時輸入框內容與送出前一字不差，沒有提示就跟沒反應一樣。
    expect(panel).toContain("setSaved(await run(");
    expect(panel).toContain('{saved && <span');
    expect(panel).toContain('role="status"');
  });

  it("重新編輯或換季度時提示就收掉，不會停在舊狀態", () => {
    expect(panel).toContain("onChange={() => setSaved(false)}");
    expect(panel).toContain("setSaved(false); void load();");
  });

  it("送出中按鈕停用並顯示處理中", () => {
    expect(panel).toContain("disabled={busy}");
    expect(panel).toContain('busy ? "common.processing"');
  });

  it("每個新字串兩種語言都有", () => {
    for (const key of ["okr.saved", "okr.updateObjective", "okr.objectiveCurrent", "okr.onePerQuarter"] as const) {
      for (const language of ["zh", "en"] as const) expect(translations[language][key], `${language}.${key}`).toBeTruthy();
    }
  });
});

describe("季度目標的版面說明「一季只有一個」", () => {
  it("已有目標時把它當成一句陳述顯示，不是只躺在輸入框裡", () => {
    // 使用者回報「按了儲存卻沒有新增一個項目出來」。目標一季只有一個
    // （project_quarter_goals 有 UNIQUE(project_id, quarter)），但版面跟下方
    // 的「新增 KR」表單長得一樣，於是被讀成新增。
    expect(panel).toContain('t("okr.objectiveCurrent", { quarter })');
    expect(panel).toContain("{data.objective.objective}");
  });

  it("按鈕在已有目標時說「更新」，沒有時才說「儲存」", () => {
    expect(panel).toContain('data.objective?.objective ? "okr.updateObjective" : "okr.saveObjective"');
  });

  it("已有目標時說明再次儲存會覆蓋", () => {
    expect(panel).toContain('t("okr.onePerQuarter")');
  });

  it("沒有編輯權限時仍看得到目標本身", () => {
    // 目標的顯示不綁在 can_edit 上，只有編輯表單綁。
    const display = panel.slice(panel.indexOf('t("okr.objectiveLabel")'), panel.indexOf("{data.can_edit && <>"));
    expect(display).toContain("data.objective?.objective");
    expect(display).not.toContain("can_edit");
  });
});
