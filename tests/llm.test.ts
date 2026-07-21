import { describe, expect, it } from "vitest";
import { parseLooseJson } from "../worker/services/llm";

describe("JSON 寬鬆解析", () => {
  it("解析標準 JSON", () => expect(parseLooseJson<{ ok: boolean }>("{\"ok\":true}")).toEqual({ ok: true }));
  it("剝除 json fence", () => expect(parseLooseJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 }));
  it("取說明文字中的第一個物件", () => expect(parseLooseJson("以下是結果： {\"a\":1} 完畢")).toEqual({ a: 1 }));
  it("無物件時回 null", () => expect(parseLooseJson("沒有 JSON")).toBeNull());
  it("語法錯誤回 null", () => expect(parseLooseJson("{broken}")).toBeNull());
});
