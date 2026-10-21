import { describe, expect, it } from "vitest";
import { GUIDE_TOOLS, MCP_GUIDE } from "../src/pages/McpGuidePage";
import { MCP_TOOLS } from "../worker/mcp/tools";

/** 網站裡的「AI 連接器說明」要和伺服器實際提供的工具、權限一致，指令要帶正確的網址。 */
describe("AI 連接器說明", () => {
  it("工具清單與權限和伺服器的 MCP_TOOLS 一致，中英文都有說明", () => {
    const server = MCP_TOOLS.map((tool) => [tool.name, Boolean(tool.write)]).sort();
    expect([...GUIDE_TOOLS].map(([name, write]) => [name, write]).sort()).toEqual(server);
    for (const lang of ["zh", "en"] as const) for (const [name] of GUIDE_TOOLS) expect(MCP_GUIDE[lang].toolText[name], `${lang}.${name}`).toBeTruthy();
  });

  it("每個工具都有 Claude、Claude Code、Codex、ChatGPT、其他 Agent 五段，中英文段落一致", () => {
    for (const lang of ["zh", "en"] as const) expect(MCP_GUIDE[lang].clients.map((client) => client.id)).toEqual(["claude", "claude-code", "codex", "chatgpt", "other"]);
  });

  it("指令帶入目前網站的連接器網址，JSON 設定是合法的 JSON", () => {
    const url = "https://projects.uic-ai.com/mcp";
    const blocks = MCP_GUIDE.zh.clients.flatMap((client) => ("blocks" in client && client.blocks ? client.blocks : []).map((block) => block.code(url, "https://projects.uic-ai.com")));
    expect(blocks).toContain("claude mcp add --transport http --scope user project-brain https://projects.uic-ai.com/mcp");
    expect(blocks).toContain("codex mcp add project-brain --url https://projects.uic-ai.com/mcp --oauth-client-registration dcr");
    for (const block of blocks.filter((code) => code.startsWith("{"))) expect(JSON.stringify(JSON.parse(block))).toContain(url);
  });

  it("英文版不含中文字，給 Agent 的規則提到寫入前要確認", () => {
    expect(JSON.stringify(MCP_GUIDE.en.clients) + MCP_GUIDE.en.rules()).not.toMatch(/\p{Script=Han}/u);
    expect(MCP_GUIDE.zh.rules()).toContain("先列出來讓我確認");
  });
});
