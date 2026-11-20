/**
 * 憑證或帳號狀態改變時，把這個人其他的存取一次收回：登入 session 與 AI 連接器（OAuth/MCP）授權。
 * 為什麼要集中：改密碼、重設、停用、換 Email 都要收，漏掉一處就等於留一扇後門
 * （例如密碼外洩後改了密碼，攻擊者手上的 session 或 MCP token 仍然有效）。
 */
export async function revokeUserAccess(env: Env, userId: string, options: { keepSessionId?: string } = {}): Promise<void> {
  if (options.keepSessionId) await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(userId, options.keepSessionId).run();
  else await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId).run();
  // 沒有 OAuth 輔助函式（測試或未啟用）就只清 session。
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return;
  try {
    let cursor: string | undefined;
    do {
      const page = await oauth.listUserGrants(userId, cursor ? { cursor } : undefined);
      await Promise.all(page.items.map((grant) => oauth.revokeGrant(grant.id, userId)));
      cursor = page.cursor;
    } while (cursor);
  } catch (error) {
    console.error(JSON.stringify({ message: "revoke oauth grants failed", error: error instanceof Error ? error.message : String(error) }));
  }
}
