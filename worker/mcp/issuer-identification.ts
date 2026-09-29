/**
 * 不宣告、也不送 RFC 9207 的授權回應 iss。
 *
 * OAuth 套件在授權伺服器說明寫死 authorization_response_iss_parameter_supported: true，
 * 導回 AI 工具時也一律附上 iss。宣告之後，ChatGPT 改用所有伺服器共用的固定回呼網址
 * https://chatgpt.com/connector_platform_oauth_redirect，而這條路在使用者按了「允許」之後，
 * ChatGPT 那端顯示「缺少 OAuth 回呼資料」、連不上（2026-09）。Codex 0.143 起也會在回呼時
 * 丟掉 iss 又要求一定要有，一樣失敗。
 *
 * 不宣告時，ChatGPT 改用每個連線各自的回呼網址 https://chatgpt.com/connector/oauth/{callback_id}；
 * 回呼網址本身就分得出是哪個授權伺服器，不需要 iss 也能防範混淆攻擊（mix-up）。
 * 宣告拿掉之後就不送 iss，免得用戶端看到沒宣告的參數又拿去比對。
 */

export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";

/** 導回 AI 工具的網址（授權碼、拒絕、錯誤）去掉 iss，其餘參數不動。 */
export function withoutIssuerParameter(location: string): string {
  const url = new URL(location);
  if (!url.searchParams.has("iss")) return location;
  url.searchParams.delete("iss");
  return url.toString();
}

/** 授權伺服器說明去掉 authorization_response_iss_parameter_supported。 */
export async function withoutIssuerIdentification(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) return response;
  const metadata = await response.json() as Record<string, unknown>;
  delete metadata.authorization_response_iss_parameter_supported;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(metadata), { status: response.status, headers });
}
