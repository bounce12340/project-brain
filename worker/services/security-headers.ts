/**
 * 全站安全標頭。Worker 產生的每一個回應（/api、/mcp、/oauth、公開說明頁）都套用；
 * 前端靜態檔案由 assets binding 直接回應、不經過 Worker，所以同一份設定也要放在 public/_headers
 * （tests/security-headers.test.ts 會檢查兩邊一致）。
 *
 * CSP 依實際載入的資源訂定：
 * - script-src 'self'：前端全是同網域打包的 module script；index.html 的主題初始化原本是行內 script，
 *   已搬到 /theme-init.js，所以不需要 'unsafe-inline'。
 * - style-src：React 會寫 style 屬性、伺服器端頁面有行內 <style>，必須 'unsafe-inline'；
 *   另外要載入 Google Fonts 的 CSS（fonts.googleapis.com）。
 * - font-src：字型檔本體在 fonts.gstatic.com。
 * - img-src：data:（內嵌小圖、SVG）與 blob:（本機預覽檔案）。
 * - connect-src 'self'：前端只呼叫同網域的 /api。
 * - frame-ancestors 'none'、object-src 'none'、base-uri 'self'、form-action 'self'：防嵌入、外掛、改 base 與表單外送。
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

/**
 * 補上沒有設定的安全標頭；路由自己設的（例如授權頁、通知信頁面的 Referrer-Policy: no-referrer 與較嚴的 CSP）不覆蓋。
 * 授權同意頁的 CSP 刻意不含 form-action：表單 POST 之後會 302 到 AI 用戶端的 redirect_uri（外部網域），
 * Chrome 等瀏覽器把 form-action 也套用在表單送出後的轉址，加了會讓授權完成後被擋；
 * 那一頁維持自己的 `frame-ancestors 'none'`，全站預設的 CSP 因此不會再套上去。
 */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

/** 回應的標頭可能是唯讀的（fetch 結果、Response.redirect），所以複製一份再補。 */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const copy = new Response(response.body, response);
  applySecurityHeaders(copy.headers);
  return copy;
}
