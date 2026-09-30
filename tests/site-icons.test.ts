import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serverIcons } from "../worker/mcp/handler";

/** 圖示是靜態檔：index.html 與 MCP serverInfo 指到的每一個檔案都要真的在 public/ 裡，否則上線後是破圖。 */
const publicFile = (path: string) => resolve(__dirname, "../public", path.replace(/^\//, ""));

describe("網站圖示", () => {
  it("index.html 引用的圖示都存在", () => {
    const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]);
    for (const href of hrefs) expect(existsSync(publicFile(href)), href).toBe(true);
  });

  it("MCP 回給 AI 工具的圖示網址跟著網域走，檔案也都存在", () => {
    const icons = serverIcons("https://projects.uic-ai.com/mcp");
    expect(icons.map((icon) => icon.src)).toEqual(["https://projects.uic-ai.com/icon-512.png", "https://projects.uic-ai.com/favicon.svg"]);
    for (const icon of icons) expect(existsSync(publicFile(new URL(icon.src).pathname)), icon.src).toBe(true);
  });

  it("PNG 圖示的實際尺寸和宣告的一致", () => {
    const size = (path: string) => { const png = readFileSync(publicFile(path)); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };
    expect(size("icon-512.png")).toEqual([512, 512]);
    expect(size("apple-touch-icon.png")).toEqual([180, 180]);
  });
});
