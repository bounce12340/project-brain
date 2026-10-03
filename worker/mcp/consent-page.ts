import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import type { AuthUser } from "../types";

/**
 * AI 工具連接艾爾水晶時的授權頁。由 Worker 直接輸出，不經前端 SPA：
 * 表單要帶一次性的 handle，而且這一頁不能被嵌進別人的頁框。
 * 來自 AI 工具的名稱、網域都是對方自己填的，一律跳脫。
 */
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
:root { color-scheme: light dark; --void:#eceff1; --nexus:#fafbfb; --line:#cdd3d9; --star:#1e2638; --dim:#5b6577; --gold:#1e2638; --psi:#2a5da8; --warn:#9a5b0e; --ink:#1f2a44; --tab:#e3dcc8; }
@media (prefers-color-scheme: dark) { :root { --void:#12161d; --nexus:#1a2029; --line:#333d4b; --star:#dde2ea; --dim:#9aa3b2; --gold:#e9e4d6; --psi:#8fb6f2; --warn:#e3a852; --ink:#3d65a8; --tab:#34322c; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--void); color: var(--star); font: 15px/1.7 "Microsoft JhengHei", "微軟正黑體", "PingFang TC", "Heiti TC", "Noto Sans TC", system-ui, sans-serif; display: grid; place-items: center; padding: 24px 16px; }
main { width: 100%; max-width: 520px; background: var(--nexus); border: 1px solid var(--line); border-top: 6px solid var(--tab); padding: 28px 24px; box-shadow: 0 10px 24px -18px rgba(31, 42, 68, .45); }
.brand { display: flex; align-items: center; gap: 8px; color: var(--gold); font-weight: 700; letter-spacing: .04em; font-size: 14px; }
.brand img { width: 24px; height: 24px; }
h1 { font-size: 20px; line-height: 1.5; margin: 8px 0 16px; }
p { margin: 0 0 12px; }
.dim { color: var(--dim); font-size: 13px; }
.warn { border: 1px solid var(--warn); color: var(--warn); padding: 10px 12px; font-size: 14px; margin: 0 0 16px; }
fieldset { border: 1px solid var(--line); padding: 12px 14px; margin: 16px 0; }
legend { padding: 0 6px; color: var(--dim); font-size: 13px; }
label { display: flex; gap: 10px; align-items: flex-start; margin: 6px 0; }
input[type=checkbox] { margin-top: 5px; width: 16px; height: 16px; accent-color: var(--psi); flex: none; }
.actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
button { font: inherit; padding: 10px 20px; border: 1px solid var(--psi); cursor: pointer; min-height: 44px; }
.allow { background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 700; }
.deny { background: transparent; color: var(--star); border-color: var(--line); }
strong { color: var(--star); }
a { color: var(--psi); }`;

/** Worker 直接輸出的單頁（授權頁、取消通知信），和網站同一套配色。body 由呼叫端負責跳脫。 */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${STYLE}</style></head><body><main><div class="brand"><img src="/favicon.svg" alt="" width="24" height="24">艾爾水晶</div>${body}</main></body></html>`;
}

export function consentPage(details: ConsentDescription, handle: string, user: Pick<AuthUser, "name" | "email">): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `由 <strong>${escapeHtml(details.clientDomain)}</strong> 發行。`
    : "這個 AI 工具是自行註冊的，名稱未經驗證。";
  const loopback = details.redirectIsLoopback
    ? `<p class="warn">授權會送到這台電腦上的程式（${escapeHtml(details.redirectHost)}）。只有在你剛剛從那個程式開始連接時才繼續。</p>`
    : "";
  return page(`授權 ${details.clientName}`, `
<h1>「${name}」想要連接你的艾爾水晶帳號</h1>
<p class="dim">${origin}授權完成後會回到 <strong>${escapeHtml(details.redirectHost)}</strong>。</p>
${loopback}
<p>目前登入：<strong>${escapeHtml(user.name)}</strong>（${escapeHtml(user.email)}）</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <fieldset>
    <legend>允許這個 AI 工具</legend>
    <label><input type="checkbox" checked disabled> <span>查看你看得到的專案、任務、里程碑與進度紀錄</span></label>
    <label><input type="checkbox" name="write" value="on" checked> <span>以你的名義新增與修改：進度紀錄、任務、里程碑、專案背景</span></label>
  </fieldset>
  <p class="dim">AI 只能做你在網站上本來就能做的事，每一筆修改都會記在稽核紀錄裡。隨時可以在「個人設定 → AI 連接器」中斷連線。</p>
  <div class="actions">
    <button class="allow" name="decision" value="approve">允許</button>
    <button class="deny" name="decision" value="deny">拒絕</button>
  </div>
</form>`);
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link ? `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>` : ""}`);
}
