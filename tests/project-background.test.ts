import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppContext, AuthUser } from "../worker/types";
import { projectsRoutes } from "../worker/routes/projects";
import { markdownBlocks } from "../src/markdown";
import { needsClamp, PROJECT_TEXT_LIMITS, textLength } from "../src/project-text";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 專案背景（projects.description）：建立專案時就寫得進去，專案頁卻從來沒顯示、也改不了；
 * 專案目標同樣沒有地方改。現在兩者都能在總覽就地編輯，也能清空。
 */

let db: D1Database;
const users: Record<string, AuthUser> = {};
const person = (id: string, role: AuthUser["role"], group: string) =>
  ({ id, email: `${id}@example.com`, name: id, role, group_id: group, group_name: group, group_type: "general" }) as AuthUser;

function app() {
  const server = new Hono<AppContext>();
  server.use("*", async (c, next) => { c.set("user", users[c.req.header("x-user") ?? ""]); await next(); });
  server.route("/api/projects", projectsRoutes);
  return server;
}

async function call(as: string, method: string, path: string, body?: unknown) {
  const response = await app().request(path, { method, headers: { "x-user": as, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
const project = () => db.prepare("SELECT description, goal_summary FROM projects WHERE id='p1'").first<{ description: string; goal_summary: string }>();

beforeEach(async () => {
  ({ db } = createTestD1());
  await db.prepare("DELETE FROM projects").run();
  for (const user of [person("owner", "member", "grp_general"), person("mate", "member", "grp_general"), person("boss", "admin", "grp_general")]) {
    users[user.id] = user;
    await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id) VALUES (?,?,?,?,?,?)").bind(user.id, user.email, user.name, "x", user.role, user.group_id).run();
  }
  await db.prepare("INSERT INTO projects (id,name,group_id,owner_id,visibility,status,description,goal_summary) VALUES ('p1','全素低渣代餐包','grp_general','owner','group','active','舊說明','')").run();
});

describe("編輯專案背景與目標", () => {
  const background = "# 專案背景\n取代現行味噌湯米粉。\n\n# 硬性規格\n- 效期：常溫 24 個月以上\n  - 原料 30 個月以上";

  it("擁有者可以寫多行背景，換行原樣保存", async () => {
    expect((await call("owner", "PATCH", "/api/projects/p1", { description: background })).status).toBe(200);
    expect(await project()).toEqual({ description: background, goal_summary: "" });
  });

  it("Windows 的換行統一成 \\n，前後空白去掉", async () => {
    await call("owner", "PATCH", "/api/projects/p1", { description: "  第一行\r\n第二行\r\n  " });
    expect((await project())?.description).toBe("第一行\n第二行");
  });

  it("可以清空——以前送空字串會被當成沒填，寫錯的背景刪不掉", async () => {
    await call("owner", "PATCH", "/api/projects/p1", { description: "", goal_summary: "" });
    expect(await project()).toEqual({ description: "", goal_summary: "" });
  });

  it("只改目標時不動背景", async () => {
    await call("owner", "PATCH", "/api/projects/p1", { goal_summary: "2026 Q4 前三款上市" });
    expect(await project()).toEqual({ description: "舊說明", goal_summary: "2026 Q4 前三款上市" });
  });

  it("超過上限時擋下，什麼都不改", async () => {
    const result = await call("owner", "PATCH", "/api/projects/p1", { description: "字".repeat(PROJECT_TEXT_LIMITS.description + 1) });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("專案背景最多 10,000 字");
    expect((await project())?.description).toBe("舊說明");
    // 上限以字計，不是位元組：一萬個中文字剛好可以。
    expect((await call("owner", "PATCH", "/api/projects/p1", { description: "字".repeat(PROJECT_TEXT_LIMITS.description) })).status).toBe(200);
  });

  it("不是文字就擋下", async () => {
    expect((await call("owner", "PATCH", "/api/projects/p1", { goal_summary: 42 })).status).toBe(422);
  });

  it("同組成員看得到但不能改，和其他專案設定一樣只限擁有者與管理員", async () => {
    expect((await call("mate", "PATCH", "/api/projects/p1", { description: "亂改" })).status).toBe(403);
    expect((await call("boss", "PATCH", "/api/projects/p1", { description: "管理員補上" })).status).toBe(200);
    expect((await project())?.description).toBe("管理員補上");
  });

  it("稽核紀錄寫明改的是背景還是目標", async () => {
    await call("owner", "PATCH", "/api/projects/p1", { description: background, goal_summary: "三款上市" });
    await call("owner", "PATCH", "/api/projects/p1", { goal_summary: "三款上市" });
    const rows = await db.prepare("SELECT summary FROM audit_log WHERE entity_id='p1' ORDER BY rowid").all<{ summary: string }>();
    expect(rows.results.map((row) => row.summary)).toEqual(["更新專案背景與專案目標", "更新專案設定"]);
  });

  it("建立專案時就可以寫背景", async () => {
    const created = await call("owner", "POST", "/api/projects", { name: "新案", group_id: "grp_general", description: "緣起\n- 原因一" });
    expect(created.status).toBe(201);
    expect(await db.prepare("SELECT description FROM projects WHERE id=?").bind(created.body.id).first()).toEqual({ description: "緣起\n- 原因一" });
  });
});

describe("背景的 Markdown", () => {
  it("標題、項目、縮排的子項目、編號清單都認得", () => {
    expect(markdownBlocks("# 硬性規格\n- 效期\n  - 原料 30 個月\n1. 供應商意願\n2) 效期規格\n一般段落\n")).toEqual([
      { kind: "heading", level: 1, text: "硬性規格" },
      { kind: "bullet", depth: 0, text: "效期" },
      { kind: "bullet", depth: 1, text: "原料 30 個月" },
      { kind: "numbered", depth: 0, number: "1", text: "供應商意願" },
      { kind: "numbered", depth: 0, number: "2", text: "效期規格" },
      { kind: "paragraph", text: "一般段落" },
      { kind: "blank" },
    ]);
  });

  it("縮排最多算三層，Tab 算四格", () => {
    expect(markdownBlocks("\t- a\n            - b")).toEqual([{ kind: "bullet", depth: 2, text: "a" }, { kind: "bullet", depth: 3, text: "b" }]);
  });

  it("不是清單的數字不會被誤認：2026.9.30、1.4 到 6 g", () => {
    expect(markdownBlocks("2026.9.30 開會\n1.4 到 6 g/100 g")).toEqual([
      { kind: "paragraph", text: "2026.9.30 開會" }, { kind: "paragraph", text: "1.4 到 6 g/100 g" },
    ]);
  });

  it("「#標題」少了空白不算標題", () => {
    expect(markdownBlocks("#hashtag")).toEqual([{ kind: "paragraph", text: "#hashtag" }]);
  });
});

describe("長文字先摺起來", () => {
  it("短的直接全顯示，超過六行或三百字才摺", () => {
    expect(needsClamp("一句話")).toBe(false);
    expect(needsClamp("1\n2\n3\n4\n5\n6")).toBe(false);
    expect(needsClamp("1\n2\n3\n4\n5\n6\n7")).toBe(true);
    expect(needsClamp("字".repeat(301))).toBe(true);
  });

  it("字數以字元計：中文與表情符號各算一個", () => {
    expect(textLength("全素🌱")).toBe(3);
  });
});
