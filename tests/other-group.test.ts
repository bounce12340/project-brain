import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { sha256 } from "../worker/services/crypto";
import { canEditProgress, canViewProject } from "../worker/services/permissions";
import type { AuthUser, ProjectAccess } from "../worker/types";
import { OTHER_GROUP_ID, defaultVisibility, isOtherGroup } from "../src/project-groups";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/** 「其他」組：放不進任何一組的專案。預設全公司可見；加進來的成員不分組別都能看、能改。 */
const BASE = "http://127.0.0.1:8787";
let env: Env;
let db: D1Database;
const sessions: Record<string, string> = {};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const as = (userId: string, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}/api${path}`, { ...init, headers: { Cookie: sessions[userId], Origin: BASE, "Content-Type": "application/json" } }), env, ctx);
const create = async (body: Record<string, unknown>) => {
  const response = await as("ra", "/projects", { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };
  return db.prepare("SELECT group_id,visibility FROM projects WHERE id=?").bind(id).first<{ group_id: string; visibility: string }>();
};

beforeEach(async () => {
  ({ db } = createTestD1());
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE } as unknown as Env;
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password) VALUES ('ra','ra@example.com','RA','x','member','grp_general',0)").run();
  const token = `session-ra-${Math.random()}`;
  await db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), "ra", new Date(Date.now() + 86_400_000).toISOString()).run();
  sessions.ra = `sid=${token}`;
});

describe("內建「其他」組", () => {
  it("migration 建好「其他」組（一般類型）", async () => {
    expect(await db.prepare("SELECT id,name,type FROM groups WHERE id=?").bind(OTHER_GROUP_ID).first()).toEqual({ id: "grp_other", name: "其他", type: "general" });
  });

  it("管理員已經自己建過叫「其他」的組時，不重複建立", async () => {
    await db.prepare("DELETE FROM groups WHERE id='grp_other'").run();
    await db.prepare("INSERT INTO groups (id,name,type) VALUES ('grp_manual',' 其他 ','general')").run();
    const sql = readFileSync(new URL("../migrations/0024_other_group.sql", import.meta.url), "utf8").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    await db.prepare(sql).run();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM groups WHERE TRIM(name)='其他'").first()).toEqual({ n: 1 });
  });

  it("認內建 id，也認管理員自己取名「其他／其它」的組", () => {
    expect(isOtherGroup({ id: "grp_other", name: "雜項" })).toBe(true);
    expect(isOtherGroup({ id: "grp_x", name: " 其它 " })).toBe(true);
    expect(isOtherGroup({ id: "grp_x", name: "Other" })).toBe(true);
    expect(isOtherGroup({ id: "grp_bd", name: "BD組" })).toBe(false);
    expect(defaultVisibility({ id: "grp_other", name: "其他" })).toBe("all");
    expect(defaultVisibility({ id: "grp_bd", name: "BD組" })).toBe("group");
    expect(defaultVisibility(undefined)).toBe("group");
  });

  it("新專案放在「其他」組、沒指定可見性時預設全公司；其他組維持同組；明確指定的照指定", async () => {
    expect(await create({ name: "跨部門採購評估", group_id: "grp_other" })).toEqual({ group_id: "grp_other", visibility: "all" });
    expect(await create({ name: "BD 案", group_id: "grp_bd" })).toEqual({ group_id: "grp_bd", visibility: "group" });
    expect(await create({ name: "保密案", group_id: "grp_other", visibility: "private" })).toEqual({ group_id: "grp_other", visibility: "private" });
  });

  it("新增專案表單：選到「其他」組時可見性自動切成全公司", () => {
    const page = readFileSync(new URL("../src/pages/ProjectsPage.tsx", import.meta.url), "utf8");
    expect(page).toContain("visibility: defaultVisibility(metadata.groups.find((g) => g.id === e.target.value))");
  });
});

describe("專案成員不分組別都能看、能改", () => {
  const person = (id: string, group: string, role: AuthUser["role"] = "member") => ({ id, role, group_id: group }) as AuthUser;
  const project = (visibility: ProjectAccess["visibility"], members: string[] = []): ProjectAccess => ({ id: "p", owner_id: "owner", group_id: "grp_other", visibility, member_ids: members });

  it("「其他」組專案即使可見性是同組或私人，加進來的成員（BD 組、臨床組、實習生）都看得到、改得了", () => {
    for (const visibility of ["group", "private", "all"] as const) {
      for (const member of [person("bd", "grp_bd"), person("cl", "grp_clinical"), person("intern", "grp_bd", "intern")]) {
        const access = project(visibility, [member.id]);
        expect(canViewProject(member, access), `${member.id} ${visibility}`).toBe(true);
        expect(canEditProgress(member, access), `${member.id} ${visibility}`).toBe(true);
      }
    }
  });

  it("沒加進來的人：全公司可見時看得到但不能改；同組可見時連看都看不到（所以預設全公司）", () => {
    const outsider = person("bd", "grp_bd");
    expect(canViewProject(outsider, project("all"))).toBe(true);
    expect(canEditProgress(outsider, project("all"))).toBe(false);
    expect(canViewProject(outsider, project("group"))).toBe(false);
  });
});
