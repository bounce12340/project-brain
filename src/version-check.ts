/**
 * 偵測網站有沒有新版本：每次部署，index.html 引用的 /assets/ 檔名（內容雜湊）都會變。
 * 分頁開著時定期抓一次首頁，和這個分頁載入時的檔名比對；不同就表示已經部署新版。
 * 這和 CI「確認正式站已換成這一版」用的是同一個判斷。
 */

const ASSET_REF = /\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g;

/** 一段 HTML 引用了哪些 /assets/ 檔案，排序後串成一個字串；沒有就是空字串（開發模式）。 */
export function assetFingerprint(html: string): string {
  return [...new Set(html.match(ASSET_REF) ?? [])].sort().join(" ");
}

/**
 * 這個分頁載入時的版本。必須在任何頁面以動態 import 載入之前讀取，
 * 否則之後插進 head 的 modulepreload／CSS 連結會混進來。main.tsx 一開始就 import 這個檔，所以模組載入時就記下來。
 */
export const LOADED_FINGERPRINT = typeof document === "undefined" ? "" : assetFingerprint(document.head.innerHTML);

/** 正式站有新版本嗎？開發模式（沒有 /assets/）或抓不到首頁時一律當作沒有。 */
export async function newerVersionAvailable(loaded = LOADED_FINGERPRINT, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!loaded) return null;
  try {
    const response = await fetcher("/", { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" } });
    if (!response.ok) return null;
    const served = assetFingerprint(await response.text());
    return served && served !== loaded ? served : null;
  } catch {
    return null;
  }
}

/** 定期檢查的間隔，以及切回分頁時最少隔多久才再查一次。 */
export const CHECK_INTERVAL_MS = 5 * 60_000;
export const MIN_GAP_MS = 60_000;

/**
 * 舊分頁點進還沒載過的頁面時，那一頁的 JS 已經被新部署換掉，動態 import 會失敗。
 * 這時自動重新整理一次就會載到新版；30 秒內已經重整過就不再重整，避免檔案真的壞掉時無限重整。
 */
const RELOAD_KEY = "AIUR_CHUNK_RELOAD_AT";
export function shouldAutoReload(storage: Pick<Storage, "getItem" | "setItem"> | undefined, now = Date.now()): boolean {
  try {
    const last = Number(storage?.getItem(RELOAD_KEY) ?? 0);
    if (now - last < 30_000) return false;
    storage?.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
