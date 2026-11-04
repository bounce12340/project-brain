import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { deleteRegwatchEntry } from "../worker/services/regwatch";
import { extractNhiSourceRef, fetchNhiDrafts, NHI_RSS_URL, parseTfdaRss } from "../worker/services/tfda";
import type { RegwatchExtractedEntry } from "../worker/services/regwatch-ai";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 健保署「法規公告」RSS：和 TFDA 一樣每天抓、AI 整理成待審草稿。
 * 樣本取自 https://www.nhi.gov.tw/ch/rss-3258-1.xml（2026-11-02 版）的前兩則，欄位原樣保留。
 */
const FEED = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
<channel>
<title>衛生福利部中央健康保險署,NHI - 法規公告</title>
<link>https://www.nhi.gov.tw/ch/np-3258-1.html</link>
<item>
<title>
<![CDATA[ 公告修訂僵直性脊椎炎、類風濕性關節炎、克隆氏症、潰瘍性結腸炎、乾癬、化膿性汗腺炎及葡萄膜炎之藥品給付規定。 ]]>
</title>
<link>https://www.nhi.gov.tw/ch/cp-20687-74a57-3258-1.html</link>
<description>
<![CDATA[ <p>一、「全民健康保險藥品已收載項目異動明細表」如附件1。</p>

<p>二、修訂「全民健康保險藥物給付項目及支付標準－第六編第八十三條之藥品給付規定第8節免疫製劑Immunologic agents 8.2.4.3.」部分規定，給付規定修訂對照表如附件2。</p> ]]>
</description>
<author/>
<pubDate>Fri, 30 Oct 2026 08:46:00 GMT</pubDate>
<dc:title>
<![CDATA[ dc 標題不該被當成標題 ]]>
</dc:title>
<dc:description>
<![CDATA[ dc 說明不該被當成內文 ]]>
</dc:description>
</item>
<item>
<title>
<![CDATA[ 公告異動含diazoxide成分口服液劑Proglycem 50mg/mL, 30mL/bot之罕見疾病用藥共1項目之支付價格。 ]]>
</title>
<link>https://www.nhi.gov.tw/ch/cp-20677-23d9b-3258-1.html</link>
<description>
<![CDATA[ <p>「全民健康保險藥物給付項目及支付標準特殊藥品及罕見疾病用藥『尊重市場價格』之執行原則藥物名單」如附件1。</p> ]]>
</description>
<pubDate>Thu, 29 Oct 2026 06:46:00 GMT</pubDate>
</item>
</channel>
</rss>`;

const extracted = (category: string): RegwatchExtractedEntry => ({ entry_date: "2026-10-30", title: "x", product_line: "藥品", category, key_points: `- ${category}重點` } as RegwatchExtractedEntry);

describe("健保署 RSS 解析", () => {
  it("標題與內文取 <title>／<description>（不是 dc:*），去掉 CDATA 前後空白；來源編號取文章號並加 nhi- 前綴", () => {
    const items = parseTfdaRss(FEED);
    expect(items.map((item) => item.title)).toEqual([
      "公告修訂僵直性脊椎炎、類風濕性關節炎、克隆氏症、潰瘍性結腸炎、乾癬、化膿性汗腺炎及葡萄膜炎之藥品給付規定。",
      "公告異動含diazoxide成分口服液劑Proglycem 50mg/mL, 30mL/bot之罕見疾病用藥共1項目之支付價格。",
    ]);
    expect(items[0]).toMatchObject({ link: "https://www.nhi.gov.tw/ch/cp-20687-74a57-3258-1.html", pubDate: "Fri, 30 Oct 2026 08:46:00 GMT" });
    expect(items[0].descriptionHtml).toContain("全民健康保險藥品已收載項目異動明細表");
    expect(items[0].descriptionHtml).not.toContain("dc 說明");
    expect(extractNhiSourceRef(items[0].link)).toBe("nhi-20687");
    expect(extractNhiSourceRef("https://www.fda.gov.tw/ch/cp-20687-74a57-3258-1.html")).toBeNull();
    expect(extractNhiSourceRef("https://www.nhi.gov.tw/ch/np-3258-1.html")).toBeNull();
    expect(extractNhiSourceRef("not a url")).toBeNull();
  });
});

describe("健保署 RSS 抓取", () => {
  const setup = () => {
    const { db } = createTestD1();
    const env = { DB: db, FILES: { delete: async () => undefined } } as unknown as Env;
    return { db, env };
  };

  it("新公告存成 nhi_rss 待審草稿（台北日期、AI 拿到標題＋內文）；通知寫健保署；再抓一次依來源編號略過", async () => {
    const { db, env } = setup();
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(FEED));
    const extract = vi.fn(async (_env: Env, text: string) => [extracted(text.includes("diazoxide") ? "藥價" : "健保給付")]);
    const stats = await fetchNhiDrafts(env, { fetcher, extract });
    expect((fetcher.mock.calls[0] as unknown[])[0]).toBe(NHI_RSS_URL);
    expect(stats).toMatchObject({ fetched: 2, new_drafts: 2, ai_fallback: 0, errors: [] });
    expect(String(extract.mock.calls[0][1])).toMatch(/^公告修訂僵直性脊椎炎.*\n一、「全民健康保險藥品已收載項目異動明細表」/s);
    const rows = (await db.prepare("SELECT entry_date,title,source,source_ref,status,product_line,category,link FROM reg_entries ORDER BY source_ref").all()).results;
    expect(rows).toEqual([
      expect.objectContaining({ entry_date: "2026-10-29", source: "nhi_rss", source_ref: "nhi-20677", status: "draft", product_line: "藥品", category: "藥價", link: "https://www.nhi.gov.tw/ch/cp-20677-23d9b-3258-1.html" }),
      expect.objectContaining({ entry_date: "2026-10-30", source: "nhi_rss", source_ref: "nhi-20687", status: "draft", category: "健保給付" }),
    ]);
    expect((await db.prepare("SELECT DISTINCT title FROM notifications WHERE type='tfda_draft'").all()).results).toEqual([{ title: "健保署 新公告 2 則待審核" }]);
    expect(await fetchNhiDrafts(env, { fetcher, extract })).toMatchObject({ new_drafts: 0, skipped_ref: 2 });
  });

  it("刪掉的健保署草稿留下墓碑，之後不會再抓回來", async () => {
    const { db, env } = setup();
    const extract = async () => [extracted("健保給付")];
    await fetchNhiDrafts(env, { fetcher: async () => new Response(FEED), extract });
    const id = await db.prepare("SELECT id FROM reg_entries WHERE source_ref='nhi-20687'").first<string>("id");
    await deleteRegwatchEntry(env, id!, "usr_admin");
    expect(await db.prepare("SELECT source_ref FROM tfda_rejected").all()).toMatchObject({ results: [{ source_ref: "nhi-20687" }] });
    expect(await fetchNhiDrafts(env, { fetcher: async () => new Response(FEED), extract })).toMatchObject({ new_drafts: 0, skipped_ref: 1, skipped_rejected: 1 });
  });

  it("網站擋下（例如 403 驗證頁）只記錯誤、不建草稿", async () => {
    const { db, env } = setup();
    const stats = await fetchNhiDrafts(env, { fetcher: async () => new Response("<html>Just a moment...</html>", { status: 403 }) });
    expect(stats).toMatchObject({ fetched: 0, new_drafts: 0, errors: ["fetch: RSS_HTTP_403"] });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM reg_entries").first<number>("n")).toBe(0);
  });
});

describe("migration 0028：reg_entries 重建", () => {
  it("既有條目、TFDA 草稿與附件關聯都保留；之後可以存 nhi_rss", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = ON");
    const dir = new URL("../migrations/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const before = files.filter((name) => name < "0028");
    for (const file of before) raw.exec(readFileSync(new URL(file, dir), "utf8"));
    raw.exec(`INSERT INTO files (id,filename,size,content_type,storage_key,uploaded_by) VALUES ('f1','a.pdf',1,'application/pdf','k','usr_admin');
      INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref,created_by,file_id) VALUES
        ('r1','2026-10-29','藥品','手動公告','published','manual',NULL,'usr_admin','f1'),
        ('r2','2026-10-30','藥品','TFDA 草稿','draft','tfda_rss','31671',NULL,NULL);
      INSERT INTO reg_entry_files (entry_id,file_id,position) VALUES ('r1','f1',0);`);
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source) VALUES ('x','2026-11-01','藥品','x','draft','nhi_rss')")).toThrow();
    for (const file of files.filter((name) => name >= "0028")) raw.exec(readFileSync(new URL(file, dir), "utf8"));
    expect(raw.prepare("SELECT id,source,source_ref,file_id,created_by FROM reg_entries ORDER BY id").all()).toEqual([
      { id: "r1", source: "manual", source_ref: null, file_id: "f1", created_by: "usr_admin" },
      { id: "r2", source: "tfda_rss", source_ref: "31671", file_id: null, created_by: null },
    ]);
    expect(raw.prepare("SELECT entry_id,file_id,position FROM reg_entry_files").all()).toEqual([{ entry_id: "r1", file_id: "f1", position: 0 }]);
    raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref) VALUES ('r3','2026-11-01','藥品','健保署公告','draft','nhi_rss','nhi-1')");
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref) VALUES ('r4','2026-11-02','藥品','重複','draft','nhi_rss','nhi-1')")).toThrow(/UNIQUE/);
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source) VALUES ('r5','2026-11-01','藥品','健保署公告','draft','manual')")).toThrow(/UNIQUE/);
    // 刪除條目時附件關聯照舊一起刪（ON DELETE CASCADE 仍指向新表）。
    raw.exec("DELETE FROM reg_entries WHERE id='r1'");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM reg_entry_files").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%backup%' OR name='reg_entries_new'").all()).toEqual([]);
  });
});
