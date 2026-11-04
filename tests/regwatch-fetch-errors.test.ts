import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeFetchError, summarizeFetchErrors } from "../src/regwatch-fetch";

/** 「立即抓取」的結果要說出為什麼失敗，而不是只有「錯誤 1」。 */
describe("抓取錯誤原因", () => {
  it("把錯誤代碼歸成看得懂的原因：403／429 是被擋、其他 HTTP、不是 RSS、逾時、太大、個別公告", () => {
    expect(describeFetchError("fetch: RSS_HTTP_403")).toEqual({ reason: "blocked", status: 403, raw: "fetch: RSS_HTTP_403" });
    expect(describeFetchError("fetch: RSS_HTTP_429").reason).toBe("blocked");
    expect(describeFetchError("fetch: RSS_HTTP_502")).toMatchObject({ reason: "http", status: 502 });
    expect(describeFetchError("parse: no RSS items").reason).toBe("not_rss");
    expect(describeFetchError("fetch: The operation was aborted").reason).toBe("timeout");
    expect(describeFetchError("fetch: RSS_TOO_LARGE").reason).toBe("too_large");
    expect(describeFetchError("item 31671: D1 error").reason).toBe("item");
    expect(describeFetchError("notification: boom").reason).toBe("other");
  });

  it("同一種原因只列一次，最多兩則", () => {
    expect(summarizeFetchErrors(["item a: x", "item b: y", "fetch: RSS_HTTP_403", "notification: z"]).map((item) => item.reason)).toEqual(["item", "blocked"]);
    expect(summarizeFetchErrors([])).toEqual([]);
  });

  it("畫面與稽核紀錄都帶出原因；通知中心可以直接到通知信設定；手機版也有個人設定入口", () => {
    const page = readFileSync(new URL("../src/pages/RegwatchPage.tsx", import.meta.url), "utf8");
    const routes = readFileSync(new URL("../worker/routes/v7.ts", import.meta.url), "utf8");
    const notifications = readFileSync(new URL("../src/pages/NotificationsPage.tsx", import.meta.url), "utf8");
    const layout = readFileSync(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
    expect(page.match(/setToast\(fetchResultText\(result\)\)/g)).toHaveLength(1);
    expect(routes.match(/\$\{firstError\(stats\)\}/g)).toHaveLength(1);
    expect(notifications).toContain('to="/profile#email-notifications"');
    expect(layout).toMatch(/to="\/profile"[^>]*className="[^"]*sm:hidden"/);
  });
});
