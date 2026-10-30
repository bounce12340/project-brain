import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../worker/types";
import { internalApi } from "../worker/mcp/internal-api";
import { MCP_TOOLS, type ToolContext } from "../worker/mcp/tools";
import { createTestD1 } from "./helpers/d1-sqlite";

/** create_regulation：AI 連接器新增法規動態，一律存成待審草稿，核准後才發布。 */

let db: D1Database;
const person = (id: string, group: string) => ({ id, email: `${id}@example.com`, name: id, role: "member", group_id: group, group_name: group, group_type: "general", must_change_password: 0 }) as AuthUser;
const ra = person("ra", "grp_general"); // RA/PV 組
const bd = person("bd", "grp_bd");
const ctx = (user: AuthUser): ToolContext => ({ user, db, baseUrl: "https://projects.example", clientName: "Claude", api: internalApi({ DB: db, APP_BASE_URL: "https://projects.example" } as unknown as Env, undefined, user) });
const run = (args: Record<string, unknown>, user = ra) => MCP_TOOLS.find((tool) => tool.name === "create_regulation")!.run(args, ctx(user)) as Promise<Record<string, any>>;
const notice = { title: "藥品上市後變更共同審查作業原則", entry_date: "2026-10-29", product_line: "藥品", category: "上市後變更", key_points: "- FDA藥字第1151410558號\n- 可附參考國審查報告申請共同審查" };

beforeEach(async () => {
  ({ db } = createTestD1());
  for (const user of [ra, bd]) await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES (?,?,?,?,?,?,0)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
});

describe("create_regulation", () => {
  it("存成待審草稿：一般清單看不到，list_regulations 也查不到；核准後才出現", async () => {
    const result = await run(notice);
    expect(result).toMatchObject({ ok: true, status: "待審草稿", url: "https://projects.example/regwatch?view=drafts" });
    expect(await db.prepare("SELECT status,source,created_by,category FROM reg_entries WHERE id=?").bind(result.id).first()).toEqual({ status: "draft", source: "manual", created_by: "ra", category: "上市後變更" });
    const list = MCP_TOOLS.find((tool) => tool.name === "list_regulations")!;
    expect(((await list.run({ keyword: "共同審查" }, ctx(ra))) as { total: number }).total).toBe(0);
    await ctx(ra).api.send("POST", `/api/regwatch/${result.id}/approve`);
    expect(((await list.run({ keyword: "共同審查" }, ctx(bd))) as { total: number }).total).toBe(1);
    expect(await db.prepare("SELECT summary FROM audit_log WHERE action='mcp_create_regulation'").first()).toEqual({ summary: "經 AI 連接器（Claude）新增法規動態草稿「藥品上市後變更共同審查作業原則」" });
  });

  it("只有 RA/PV 組與管理員可新增；同日期同標題不能重複；網站手動新增仍直接發布", async () => {
    await expect(run(notice, bd)).rejects.toThrow("僅 RA/PV 組成員與管理員");
    await run(notice);
    await expect(run(notice)).rejects.toThrow("相同日期與標題已存在");
    const manual = await ctx(ra).api.send<{ id: string; status: string }>("POST", "/api/regwatch", { ...notice, title: "另一則" });
    expect(manual.status).toBe("published");
  });

  it("欄位檢查：日期與產品線", async () => {
    await expect(run({ ...notice, entry_date: "2026-02-30" })).rejects.toThrow();
    const tool = MCP_TOOLS.find((item) => item.name === "create_regulation")!;
    expect(tool.inputSchema.required).toEqual(["title", "entry_date", "product_line"]);
    expect(tool.write).toBe(true);
  });
});
