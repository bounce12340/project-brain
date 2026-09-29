/**
 * 登入後要回到哪裡。只接受站內的 AI 連接器授權頁（/oauth/authorize?…）：
 * 那一頁由 Worker 產生、不在前端路由裡，必須整頁跳轉；其他網址一律不收，
 * 免得 ?next= 被拿來把人導去別的網站。
 */
export function oauthReturnPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/oauth/authorize?")) return null;
  // 換成完整網址再比一次來源，擋掉 /oauth/authorize?…\\evil.com 之類的怪寫法。
  const url = new URL(next, "https://placeholder.invalid");
  return url.origin === "https://placeholder.invalid" && url.pathname === "/oauth/authorize" ? `${url.pathname}${url.search}` : null;
}
