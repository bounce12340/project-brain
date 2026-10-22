import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetFingerprint, newerVersionAvailable, shouldAutoReload } from "../src/version-check";

/** 有新版本時提醒重新整理：用首頁引用的 /assets/ 檔名判斷，和 CI 確認部署的方法相同。 */
const html = (js: string, css: string) => `<!doctype html><head><script>theme()</script><script type="module" crossorigin src="/assets/index-${js}.js"></script><link rel="stylesheet" crossorigin href="/assets/index-${css}.css"></head><body><div id="root"></div></body>`;
const fetchReturning = (body: string, ok = true) => (async () => ({ ok, text: async () => body })) as unknown as typeof fetch;

describe("判斷有沒有新版本", () => {
  it("取出首頁引用的 JS 與 CSS 檔名，排序後比對", () => {
    expect(assetFingerprint(html("AAA", "BBB"))).toBe("/assets/index-AAA.js /assets/index-BBB.css");
    expect(assetFingerprint("<script src=\"/src/main.tsx\"></script>")).toBe("");
  });

  it("檔名不同才算新版本；相同、抓不到或開發模式都不提醒", async () => {
    const loaded = assetFingerprint(html("AAA", "BBB"));
    expect(await newerVersionAvailable(loaded, fetchReturning(html("AAA", "BBB")))).toBeNull();
    expect(await newerVersionAvailable(loaded, fetchReturning(html("CCC", "BBB")))).toBe("/assets/index-BBB.css /assets/index-CCC.js");
    expect(await newerVersionAvailable(loaded, fetchReturning(html("CCC", "BBB"), false))).toBeNull();
    expect(await newerVersionAvailable(loaded, fetchReturning("<html>維護中</html>"))).toBeNull();
    expect(await newerVersionAvailable(loaded, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await newerVersionAvailable("", fetchReturning(html("CCC", "BBB")))).toBeNull();
  });

  it("和 CI「確認正式站已換成這一版」用同樣的入口檔名格式", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toContain("assets/index-[A-Za-z0-9_-]*\\.js");
  });
});

describe("舊分頁載不到新頁面時自動重新整理", () => {
  it("第一次重整；30 秒內再失敗就不重整，避免無限重整", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(shouldAutoReload(storage, 1_000_000)).toBe(true);
    expect(shouldAutoReload(storage, 1_010_000)).toBe(false);
    expect(shouldAutoReload(storage, 1_040_000)).toBe(true);
    expect(shouldAutoReload(undefined, 1_000_000)).toBe(true);
  });

  it("main.tsx 在載入 App 之前先記下版本，並處理 vite:preloadError", () => {
    const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    expect(main.indexOf('from "./version-check"')).toBeLessThan(main.indexOf('from "./App"'));
    expect(main).toContain('addEventListener("vite:preloadError"');
  });
});
