import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(new URL("../worker/routes/reports.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../src/components/AiSidebar.tsx", import.meta.url), "utf8");

/** 取出某個端點的處理函式內容，避免掃到隔壁端點的字串。 */
function handler(source: string, path: string): string {
  const start = source.indexOf(`aiRoutes.post("${path}"`);
  expect(start, `找不到 ${path}`).toBeGreaterThan(-1);
  const next = source.indexOf("aiRoutes.post(", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("AI 小幫手不能自己改資料", () => {
  it("問答端點沒有任何寫入語句", () => {
    const body = handler(routes, "/assistant");
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("建立草稿的端點也沒有任何寫入語句——它只回草稿", () => {
    // 寫入一律由使用者按下確認後，前端拿草稿去打既有的建立端點，
    // 權限、稽核與自動進度才會照原本的路徑跑。
    const body = handler(routes, "/plan-project");
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("側邊欄的寫入只走既有的建立端點，沒有另開 AI 專用的寫入路徑", () => {
    expect(sidebar).toMatch(/api\(`\/projects\/\$\{projectId\}\/tasks`/);
    expect(sidebar).toMatch(/api\(`\/projects\/\$\{projectId\}\/milestones`/);
    // 任何 /ai/ 開頭的 POST 都只能是讀取或產草稿，不能是寫入。
    const aiCalls = [...sidebar.matchAll(/api<[^>]*>\("(\/ai\/[a-z-]+)"/g)].map((match) => match[1]);
    expect(aiCalls.sort()).toEqual(["/ai/assistant", "/ai/plan-project"]);
  });
});

describe("建立內容與時程在任何頁面都要能用", () => {
  it("不在專案內頁時，面板裡要有專案選單，而不是只留一句提示", () => {
    // 回報：「建立內容與時程那頁不能輸入任何的東西」。第一版只在網址是 /projects/:id
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

describe("AI 小幫手的可見範圍不能比使用者大", () => {
  it("問答只餵使用者看得到的專案", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/projectRows\(c\.env\.DB\)\)\.filter\(\(row\) => canViewProject\(user, accessFrom\(row\)\)\)/);
  });

  it("開著的專案要重新確認可見性，不能因為前端說得出 id 就相信", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/visible\.find\(\(row\) => row\.id === projectId\)/);
  });

  it("產草稿要同時有檢視與編輯權", () => {
    // 草稿的用途就是要寫進去，只讀得到的人不必產。
    const body = handler(routes, "/plan-project");
    expect(body).toMatch(/canViewProject\(c\.get\("user"\), access\)/);
    expect(body).toMatch(/canEditProgress\(c\.get\("user"\), access\)/);
  });
});

describe("上下文有上限", () => {
  it("專案數與對話輪數都受限，成本不會隨資料量與對話長度無限成長", () => {
    const body = handler(routes, "/assistant");
    expect(body).toMatch(/MAX_CONTEXT_PROJECTS/);
    expect(body).toMatch(/MAX_HISTORY_TURNS/);
  });
});
