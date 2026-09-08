import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProgressLinksPrompt } from "../worker/services/progress-links";
import { buildPlanPrompt } from "../worker/services/assistant";

/**
 * DeepSeek 的 JSON 輸出模式有一條硬性要求：提詞裡必須出現 "json" 這個字，
 * 否則「API 可能偶爾回空內容」。而空內容在 llmChat 是丟例外、重試一次、再丟出——
 * 也就是功能直接壞掉，不是降級。這種要求日後改提詞時最容易漏掉，所以釘起來。
 * 參考：https://api-docs.deepseek.com/guides/json_mode
 */

const routes = readFileSync(new URL("../worker/routes/reports.ts", import.meta.url), "utf8");

/**
 * 取出每一個帶 `json: true` 的 llmChat 呼叫的提詞部分。
 * 不能用「找第一個 ]」來切——提詞裡本來就有 `string[]`、`suggestions:string[]` 這種字元，
 * 第一版就是這樣只抓到 5 個裡的 3 個，變成一個抓不全、卻永遠會通過的假保護。
 */
function jsonModePrompts(source: string): string[] {
  const prompts: string[] = [];
  const starts = [...source.matchAll(/llmChat\(/g)].map((match) => match.index ?? 0);
  starts.forEach((start, index) => {
    const slice = source.slice(start, starts[index + 1] ?? source.length);
    const options = slice.indexOf("json: true");
    if (options !== -1) prompts.push(slice.slice(0, options));
  });
  return prompts;
}

describe("JSON 模式的提詞一定要含 json 這個字", () => {
  it("reports.ts 裡每個 json: true 的呼叫，提詞都提到 json", () => {
    const calls = jsonModePrompts(routes);
    // 少於 5 個代表抓取方式跟著程式碼漂掉了，測試會變成永遠通過的假保護。
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      // 用 builder 組提詞的呼叫，字面上看不到 json，改由下面各自的測試涵蓋。
      const usesBuilder = /build[A-Za-z]*Prompt\(/.test(call);
      if (!usesBuilder) expect(call, `這個 llmChat 呼叫的提詞沒有提到 json：\n${call.slice(0, 200)}`).toMatch(/json/i);
    }
  });

  it("buildProgressLinksPrompt 提到 json", () => {
    for (const lang of ["zh", "en"] as const) expect(buildProgressLinksPrompt(lang)).toMatch(/json/i);
  });

  it("buildPlanPrompt 提到 json", () => {
    for (const lang of ["zh", "en"] as const) expect(buildPlanPrompt(lang, ["待辦"], "2026-09-08")).toMatch(/json/i);
  });

  it("法規動態的擷取提詞也提到 json", () => {
    const regwatch = readFileSync(new URL("../worker/services/regwatch-ai.ts", import.meta.url), "utf8");
    expect(regwatch).toMatch(/JSON/);
  });
});

describe("LLM 端點設定", () => {
  it("wrangler.jsonc 的 base URL 指向一個 OpenAI 相容端點", () => {
    // llmChat 會在後面接 /chat/completions，所以這裡不能自己帶路徑尾巴。
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const base = /"LLM_BASE_URL":\s*"([^"]+)"/.exec(config)?.[1] ?? "";
    expect(base).toMatch(/^https:\/\//);
    expect(base).not.toMatch(/\/chat\/completions$/);
    expect(base).not.toMatch(/\/$/);
  });
});
