import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(new URL("../worker/routes/reports.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../src/components/AiSidebar.tsx", import.meta.url), "utf8");

/** 取出某個端點的處理函式內容，避免掃到隔壁端點的字串。 */
function handler(source: string, path: string): string {
  const start = source.search(new RegExp(`aiRoutes\\.(post|get)\\("${path.replace("/", "\\/")}"`));
  expect(start, `找不到 ${path}`).toBeGreaterThan(-1);
  // 切到下一個 aiRoutes.<任何方法>，不是只切 .post——新增一個 .get 端點時，
  // 只認 .post 會讓前一個處理函式的切片一路吃到檔尾，掃描範圍悄悄失準。
  const next = source.slice(start + 1).search(/aiRoutes\.(post|get|put|patch|delete)\(/);
  return source.slice(start, next === -1 ? source.length : start + 1 + next);
}

describe("AI 小幫手不能自己改資料", () => {
  it("問答端點沒有任何寫入語句", () => {
    const body = handler(routes, "/assistant");
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("整理專案的端點也沒有任何寫入語句——它只回變更清單", () => {
    // 寫入一律由使用者勾選、按下確認後，經 /agent/execute 以本人身分跑 MCP 工具，
    // 權限、稽核與自動進度才會照原本的路徑跑。
    const body = handler(routes, "/organize");
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("側邊欄的寫入只走確認後的執行端點，沒有其他寫入路徑", () => {
    // /ai/ 開頭的端點只能是讀取、產清單，或執行使用者按過確認的 MCP 工具。
    const aiCalls = [...sidebar.matchAll(/api(?:<[^>]*>)?\("(\/ai\/[a-z/-]+)"/g)].map((match) => match[1]);
    expect([...new Set(aiCalls)].sort()).toEqual(["/ai/agent", "/ai/agent/execute", "/ai/assistant", "/ai/organize"]);
    expect(sidebar).not.toMatch(/method: "(PATCH|PUT|DELETE)"/);
  });

  it("操作模式：提問端點只回確認卡；執行端點只走 MCP 工具，不自己寫 SQL", () => {
    expect(handler(routes, "/agent")).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    const execute = handler(routes, "/agent/execute");
    expect(execute).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(execute).toContain("executeAssistantAction(");
    // 執行只在使用者按下確認卡的按鈕時發生。
    expect(sidebar).toMatch(/onConfirm=\{\(cards\) => void confirm\(cards\)\}/);
  });
});

describe("整理專案在任何頁面都要能用", () => {
  it("不在專案內頁時，面板裡要有專案選單，而不是只留一句提示", () => {
    // 回報：「建立內容與時程（現在的整理專案）那頁不能輸入任何的東西」。第一版只在網址是 /projects/:id
    // 時才渲染輸入框，其他頁面連一個輸入框都沒有——分頁點得到卻是死路。
    // 泛型裡有 Array<…>，用 [^>]* 切會在第一個 > 就停，所以直接比對字串。
    expect(sidebar).toContain('"/projects?summary=1"');
    expect(sidebar).toContain('t("ai.planPick")');
    expect(sidebar).toContain("const projectId = openProjectId || chosen;");
  });

  it("草稿與寫入都用選定的專案，不是網址上的", () => {
    // 兩者在專案內頁相同，但從選單選的時候必須是選單那個。
    expect(sidebar).not.toMatch(/api\(`\/projects\/\$\{openProjectId\}/);
    expect(sidebar).toMatch(/project_id: projectId/);
  });
});

describe("連線診斷", () => {
  it("只有管理員能用", () => {
    const body = handler(routes, "/diagnostics");
    expect(body).toMatch(/user\.role !== "admin"/);
  });

  it("只回報金鑰在不在，不回報金鑰本身", () => {
    const body = handler(routes, "/diagnostics");
    expect(body).toContain("key_present: !!c.env.LLM_API_KEY");
    expect(body).not.toMatch(/reply: c\.env\.LLM_API_KEY|result\.key =|api_key:/);
  });
});

describe("AI 小幫手的可見範圍不能比使用者大", () => {
  it("問答只餵使用者看得到的專案", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/projectRows\(c\.env\.DB\)\)\.filter\(\(row\) => canViewProject\(user, accessFrom\(row\)\)\)/);
  });

  it("開著的專案要重新確認可見性，不能因為前端說得出 id 就相信", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/visible\.find\(\(row\) => row\.id === projectId\)/);
  });

  it("整理專案要同時有檢視與編輯權", () => {
    // 清單的用途就是要寫進去，只讀得到的人不必產。專案經 get_project 讀出，看不到就是找不到。
    const body = handler(routes, "/organize");
    expect(body).toMatch(/loadProjectForAgent\(ctx, projectId\)/);
    expect(body).toMatch(/if \(!current\.permissions\.can_edit\) return c\.json\(\{ error: "沒有編輯權限" \}, 403\)/);
  });
});

describe("上下文有上限", () => {
  it("專案數與對話輪數都受限，成本不會隨資料量與對話長度無限成長", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/MAX_CONTEXT_PROJECTS/);
    expect(body).toMatch(/MAX_HISTORY_TURNS/);
  });
});
