import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdownBlocks, plainMarkdown } from "../src/markdown";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** 全站長文字可以用 Markdown 輸入，畫面上看到的是轉譯後的格式，不會出現記號；資料本身不改。 */
describe("Markdown 轉譯顯示", () => {
  it("一兩行的預覽拿掉記號：標題的 #、粗體的 ** 去掉，項目符號換成「・」", () => {
    expect(plainMarkdown("# 進度\n- **10/5** 已遞交\n  - 待補 CEP\n1. 下一步")).toBe("進度\n・10/5 已遞交\n  ・待補 CEP\n1. 下一步");
    expect(plainMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("區塊解析：標題、項目、編號、段落", () => {
    expect(markdownBlocks("## 結論\n- **CEP** 待補\n1. 送件").map((block) => block.kind)).toEqual(["heading", "bullet", "numbered"]);
  });

  it("長文字的顯示都經過 Markdown 元件，不再直接印原文", () => {
    const uses: Array<[string, string]> = [
      ["src/components/EditableText.tsx", "markdown = true"], // 專案背景與目標
      ["src/components/ProjectGlance.tsx", "<MarkdownPreview content={note}"], // 最新進度
      ["src/components/AiSidebar.tsx", "<Markdown content={message.content} />"], // AI 小幫手回答
      ["src/components/AiSidebar.tsx", "<Markdown content={reply} />"], // 整理專案摘要
      ["src/pages/MeetingsPage.tsx", "<MarkdownPreview content={record.summary}"], // 會議與外訓摘要
      ["src/pages/ContactsPage.tsx", "<Markdown content={contact.notes}"], // 聯絡人備註
      ["src/pages/RegwatchPage.tsx", "<Markdown content={item.key_points}"], // 法規重點
      ["src/pages/ImportPage.tsx", "<Markdown content={item.summary} />"],
      ["src/components/TaskDrawer.tsx", "<Markdown content={summary.summary} />"], // 任務 AI 摘要
      ["src/components/TaskDrawer.tsx", "<Markdown content={item.content} />"], // 任務留言
      ["src/pages/ProjectDetailPage.tsx", "<MarkdownInline text={data.project.risk_summary} />"], // AI 風險摘要
      ["src/components/RiskReview.tsx", "<MarkdownInline text={result.summary} />"],
      ["src/pages/DashboardPage.tsx", "plainMarkdown(item.content)"], // 儀表板最近動態（兩行預覽）
    ];
    for (const [path, snippet] of uses) expect(read(path), path).toContain(snippet);
    expect(read("src/pages/MeetingsPage.tsx")).not.toContain("{record.summary}</p>");
    expect(read("src/pages/ContactsPage.tsx")).not.toContain("{contact.notes}</p>");
  });

  it("資料不動：沒有任何 migration 把 ** 從文字裡清掉", () => {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))) expect(read(`migrations/${file}`), file).not.toContain("'**'");
  });
});
