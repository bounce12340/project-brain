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

  it("送出中按鈕停用，兩種語言都有提示字串", () => {
    expect(panel).toContain('disabled={busy}>{t(busy ? "common.processing" : "okr.saveObjective")}');
    for (const language of ["zh", "en"] as const) {
      expect(translations[language]["okr.saved"], language).toBeTruthy();
    }
  });
});
