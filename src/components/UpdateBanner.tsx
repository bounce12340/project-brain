import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/LangContext";
import { CHECK_INTERVAL_MS, MIN_GAP_MS, newerVersionAvailable } from "../version-check";

/**
 * 網站部署了新版本時，在畫面下方提示「重新整理」。
 * 分頁開著時每 5 分鐘查一次，切回這個分頁或視窗時也查（最少隔 1 分鐘）。
 * 不自動重整：手邊可能有還沒儲存的編輯，由使用者決定什麼時候按。按「稍後」就不再提醒同一個版本。
 */
export function UpdateBanner() {
  const t = useT();
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = Date.now();
      const served = await newerVersionAvailable();
      if (!cancelled && served) setAvailable(served);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);

  if (!available || available === dismissed) return null;
  return <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-20 z-50 flex flex-wrap items-center gap-3 rounded-card border border-psi bg-nexus p-4 text-sm text-star shadow-2xl sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-md">
    <div className="min-w-0 flex-1 basis-56">
      <p className="font-semibold">{t("update.available")}</p>
      <p className="mt-0.5 text-xs leading-5 text-star-dim">{t("update.hint")}</p>
    </div>
    <div className="flex gap-2">
      <button type="button" className="btn" onClick={() => window.location.reload()}>{t("update.reload")}</button>
      <button type="button" className="btn-secondary" onClick={() => setDismissed(available)}>{t("update.later")}</button>
    </div>
  </div>;
}
