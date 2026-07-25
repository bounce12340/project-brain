import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TFDA_TEXT_LIMIT,
  buildTfdaDraft,
  decodeHtmlEntities,
  extractTfdaSourceRef,
  parseTfdaRss,
  tfdaDuplicateReason,
  tfdaHtmlToText,
  tfdaPubDateToTaipeiDate,
} from "../worker/services/tfda";
import { regwatchListStatus } from "../worker/services/regwatch";
import { runDailyWorkflow } from "../worker/services/cron";
import type { AuthUser } from "../worker/types";
import { en, zh } from "../src/i18n/translations";

const fixture = readFileSync(new URL("./fixtures/tfda-rss-sample.xml", import.meta.url), "utf8");
const items = parseTfdaRss(fixture);
const user = (role: AuthUser["role"], group_id: string): Pick<AuthUser, "role" | "group_id"> => ({ role, group_id });

describe("SPEC-V11 TFDA RSS parser", () => {
  it("使用真實擷取 fixture 解析全部 20 則 item", () => {
    expect(items).toHaveLength(20);
    expect(items.every((item) => item.title && item.link && item.pubDate && item.descriptionHtml)).toBe(true);
  });

  it("解開 fixture 中 entity 包裝的 CDATA 與 HTML", () => {
    expect(items[0].descriptionHtml).toContain("<h1>");
    expect(items[0].descriptionHtml).not.toContain("<![CDATA[");
  });

  it("正確解碼 named、decimal 與 hex entity", () => {
    expect(decodeHtmlEntities("&lt;&amp;&quot;&#65372;&#x4E2D;&nbsp;")).toBe("<&\"｜中 ");
    expect(decodeHtmlEntities("&#99999999;")).toBe("&#99999999;");
  });

  it("從真實 TFDA link 抽出穩定 news id", () => {
    expect(extractTfdaSourceRef(items[0].link)).toBe("31671");
    expect(extractTfdaSourceRef("https://example.com/news?id=abc")).toBeNull();
  });

  it("pubDate 依 Asia/Taipei 換日", () => {
    expect(tfdaPubDateToTaipeiDate("Fri, 24 Jul 2026 16:30:00 GMT")).toBe("2026-07-25");
    expect(tfdaPubDateToTaipeiDate("not-a-date")).toBeNull();
  });

  it("description 表格逐列轉為全形直線分隔", () => {
    const text = tfdaHtmlToText(items[0].descriptionHtml);
    expect(text).toContain("時間｜主題");
    expect(text).toContain("13:30 - 14:00｜報到簽到");
  });

  it("剝除其餘 HTML、解碼內容 entity 並限制 24k", () => {
    expect(tfdaHtmlToText("<p>A&amp;B</p><div>下一行</div>")).toBe("A&B\n下一行");
    expect(tfdaHtmlToText(`<p>${"字".repeat(TFDA_TEXT_LIMIT + 10)}</p>`)).toHaveLength(TFDA_TEXT_LIMIT);
  });

  it("source_ref 已存在優先判為 ref 去重", () => {
    expect(tfdaDuplicateReason("31671", "2026-07-25", "公告", new Set(["31671"]), new Set(["2026-07-25\u0000公告"]))).toBe("source_ref");
  });

  it("不同 source_ref 仍以日期與標題做第二層去重", () => {
    expect(tfdaDuplicateReason("99999", "2026-07-25", "公告", new Set(), new Set(["2026-07-25\u0000公告"]))).toBe("entry");
    expect(tfdaDuplicateReason("99999", "2026-07-25", "新公告", new Set(), new Set())).toBeNull();
  });

  it("AI fallback 固定其他、保留 RSS 日期標題與前 500 字", () => {
    const draft = buildTfdaDraft(items[0], "31671", "2026-07-25", "內".repeat(700));
    expect(draft).toMatchObject({
      sourceRef: "31671",
      entryDate: "2026-07-25",
      title: items[0].title,
      productLine: "其他",
      usedFallback: true,
    });
    expect(draft.keyPoints).toHaveLength(500);
  });

  it("AI 加值不得覆寫 RSS 日期、標題與連結", () => {
    const draft = buildTfdaDraft(items[0], "31671", "2026-07-25", "原文", {
      entry_date: "2000-01-01",
      entry_type: "meeting",
      product_line: "藥品",
      category: "公告",
      title: "AI 標題",
      key_points: "AI 重點",
    });
    expect(draft).toMatchObject({
      entryDate: "2026-07-25",
      title: items[0].title,
      link: items[0].link,
      productLine: "藥品",
      category: "公告",
      keyPoints: "AI 重點",
      usedFallback: false,
    });
  });

  it("migration 0009 含欄位約束、partial unique index 與 system created_by 語意", () => {
    const migration = readFileSync(new URL("../migrations/0009_v11.sql", import.meta.url), "utf8");
    expect(migration).toContain("CHECK (status IN ('published', 'draft'))");
    expect(migration).toContain("CHECK (source IN ('manual', 'tfda_rss'))");
    expect(migration).toContain("WHERE source_ref IS NOT NULL");
    expect(migration).toContain("ADD COLUMN created_by TEXT REFERENCES users(id)");
  });

  it("draft 可見性矩陣只讓 admin 與 RA/PV member 切換草稿", () => {
    expect(regwatchListStatus(user("admin", "grp_bd"), "drafts")).toBe("draft");
    expect(regwatchListStatus(user("member", "grp_general"), "drafts")).toBe("draft");
    expect(regwatchListStatus(user("member", "grp_bd"), "drafts")).toBe("published");
    expect(regwatchListStatus(user("intern", "grp_general"), "drafts")).toBe("published");
    expect(regwatchListStatus(user("intern", "grp_bd"), "drafts")).toBe("published");
    expect(regwatchListStatus(user("admin", "grp_general"), undefined)).toBe("published");
  });

  it("TFDA cron 前置步驟拋錯時仍執行 reminders/digest", async () => {
    let remindersRan = false;
    const result = await runDailyWorkflow({} as Env, {
      tfdaFetch: async () => { throw new Error("offline"); },
      reminders: async () => {
        remindersRan = true;
        return { notifications: 3, emails: 2, archived: 0, license_notifications: 0 };
      },
    });
    expect(remindersRan).toBe(true);
    expect(result.tfda.errors).toEqual(["cron: offline"]);
    expect(result.reminders).toMatchObject({ notifications: 3, emails: 2 });
  });

  it("審核 UI、Help 與新字串維持中英 parity", () => {
    const page = readFileSync(new URL("../src/pages/RegwatchPage.tsx", import.meta.url), "utf8");
    const help = readFileSync(new URL("../src/pages/HelpPage.tsx", import.meta.url), "utf8");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(page).toContain('t("regwatch.pending", { count: data.pending_count })');
    expect(page).toContain('t("regwatch.tfdaDraft")');
    expect(page).toContain('void approve(item)');
    expect(page).toContain('void approveAll()');
    expect(page).toContain('void fetchTfda()');
    expect(help).toContain('"help.tfdaReviewText"');
  });
});
