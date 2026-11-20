import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../worker/index";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, applySecurityHeaders } from "../worker/services/security-headers";
import { csvCell } from "../worker/routes/v6";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

const BASE = "http://127.0.0.1:8787";
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe("全站安全標頭", () => {
  const env = async () => ({ DB: await createTestD1(), OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE }) as unknown as Env;

  it("/api 的 JSON 回應（含 401）與伺服器端頁面都帶標頭，且 CSP 不含 script 的 unsafe-inline", async () => {
    const e = await env();
    for (const path of ["/api/me", "/privacy", "/connector", "/api/不存在"]) {
      const response = await worker.fetch(new Request(`${BASE}${path}`), e, ctx);
      for (const name of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Content-Security-Policy"]) {
        expect(response.headers.get(name), `${path} ${name}`).toBeTruthy();
      }
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    }
    const api = await worker.fetch(new Request(`${BASE}/api/me`), e, ctx);
    expect(api.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src 'self'(;|$)/);
  });

  it("路由自己設的標頭不被覆蓋（公開說明頁的 CSP 與 Referrer-Policy）", async () => {
    const response = await worker.fetch(new Request(`${BASE}/privacy`), await env(), ctx);
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    const headers = new Headers({ "Referrer-Policy": "no-referrer" });
    applySecurityHeaders(headers);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("OAuthProvider 自己產生的回應（/mcp 401）也帶標頭", async () => {
    const response = await worker.fetch(new Request(`${BASE}/mcp`, { method: "POST" }), await env(), ctx);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("public/_headers 與 Worker 的設定一致，index.html 沒有行內 script", () => {
    const text = readFileSync("public/_headers", "utf8");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(text).toContain(`  ${name}: ${value}`);
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});

describe("CSV 公式注入", () => {
  it("以 = + - @ Tab CR 開頭的儲存格加單引號，一般文字與中間出現的符號不動，引號照舊加倍", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const lead of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"]) expect(csvCell(lead)).toBe(`"'${lead}"`);
    expect(csvCell("正常 = 文字")).toBe(`"正常 = 文字"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });
});
