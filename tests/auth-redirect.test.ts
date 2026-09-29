import { describe, expect, it } from "vitest";
import { oauthReturnPath } from "../src/auth-redirect";

describe("登入後回到 AI 連接器的授權頁", () => {
  it("站內的授權頁照原樣回去，查詢字串保留", () => {
    const next = "/oauth/authorize?response_type=code&client_id=abc&state=x%2By";
    expect(oauthReturnPath(`?next=${encodeURIComponent(next)}`)).toBe(next);
  });

  it.each([
    ["別的站", "https://evil.example/oauth/authorize?x=1"],
    ["協定相對網址", "//evil.example/oauth/authorize?x=1"],
    ["站內其他頁", "/projects?x=1"],
    ["看起來像但路徑不同", "/oauth/authorize-evil?x=1"],
    ["反斜線", "/oauth/authorize?x=1\\@evil.example"],
    ["沒有查詢字串", "/oauth/authorize"],
  ])("%s不收", (_, next) => {
    const result = oauthReturnPath(`?next=${encodeURIComponent(next)}`);
    expect(result === null || result.startsWith("/oauth/authorize?")).toBe(true);
    if (result) expect(new URL(result, "https://projects.uic-ai.com").origin).toBe("https://projects.uic-ai.com");
  });

  it("沒有 next 就不跳", () => {
    expect(oauthReturnPath("")).toBeNull();
  });
});
