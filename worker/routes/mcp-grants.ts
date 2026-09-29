import { Hono } from "hono";
import type { AppContext } from "../types";
import { writeAudit } from "../services/db";

/** 個人設定頁的「AI 連接器」：看自己連了哪些 AI 工具，隨時中斷。 */
export const mcpGrantRoutes = new Hono<AppContext>();

/** grant 的時間是 Unix 秒；保險起見也接受毫秒。 */
const isoFrom = (value: number | undefined) => value ? new Date(value < 1e12 ? value * 1000 : value).toISOString() : null;

mcpGrantRoutes.get("/mcp/connections", async (c) => {
  const endpoint = `${new URL(c.env.APP_BASE_URL).origin}/mcp`;
  const oauth = c.env.OAUTH_PROVIDER;
  if (!oauth) return c.json({ endpoint, connections: [] });
  const user = c.get("user");
  const grants = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(user.id, cursor ? { cursor } : undefined);
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  const connections = await Promise.all(grants.map(async (grant) => {
    const stored = typeof grant.metadata?.clientName === "string" ? grant.metadata.clientName : null;
    const client = stored ? null : await oauth.lookupClient(grant.clientId).catch(() => null);
    return {
      id: grant.id, client_name: stored ?? client?.clientName ?? grant.clientId,
      can_write: grant.scope.includes("mcp:write"), connected_at: isoFrom(grant.createdAt), expires_at: isoFrom(grant.expiresAt),
    };
  }));
  connections.sort((a, b) => String(b.connected_at).localeCompare(String(a.connected_at)));
  return c.json({ endpoint, connections });
});

mcpGrantRoutes.delete("/mcp/connections/:id", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  if (!oauth) return c.json({ error: "AI 連接器未啟用" }, 404);
  const user = c.get("user");
  const id = c.req.param("id");
  // revokeGrant 以 userId 限定範圍：拿到別人的 grant id 也撤銷不了別人的連線。
  const mine = (await oauth.listUserGrants(user.id)).items.find((grant) => grant.id === id);
  if (!mine) return c.json({ error: "找不到這個連線" }, 404);
  await oauth.revokeGrant(id, user.id);
  const name = typeof mine.metadata?.clientName === "string" ? mine.metadata.clientName : mine.clientId;
  await writeAudit(c.env.DB, user, "mcp_disconnect", "user", user.id, `中斷 AI 工具「${name}」的連線`);
  return c.json({ ok: true });
});
