import { Hono } from "hono";
import type { AppContext } from "../types";
import { documentPage, escapeHtml } from "../mcp/consent-page";
import { CONNECTOR_TOOLS } from "../mcp/tools";
import { toolIsDestructive } from "../mcp/protocol";

/**
 * 不用登入就看得到的說明頁：Claude 連接器目錄要求公開的使用說明與隱私權政策。
 * /privacy：隱私權政策；/connector：AI 連接器（MCP）的連接方式、權限與工具清單。
 * 工具清單直接從連接器實際提供的工具產生，不會和程式不一致。
 */
export const publicPageRoutes = new Hono<AppContext>();

export const PRIVACY_UPDATED = "2026-11-14";

const html = (body: string) => new Response(body, {
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'", "Referrer-Policy": "strict-origin-when-cross-origin" },
});

/** 聯絡窗口：有設定 SUPPORT_EMAIL 就列出，否則請使用者洽公司內的管理員。 */
function contact(env: Env): { zh: string; en: string } {
  const email = String(env.SUPPORT_EMAIL ?? "").trim();
  if (!email) return { zh: "請洽你所屬公司的艾爾水晶管理員。", en: "Contact your company's 艾爾水晶 administrator." };
  const link = `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
  return { zh: `請寄信至 ${link}，或洽你所屬公司的艾爾水晶管理員。`, en: `Email ${link}, or contact your company's 艾爾水晶 administrator.` };
}

const footer = `<nav class="links"><a href="/">艾爾水晶首頁 / Home</a><a href="/connector">AI 連接器說明 / Connector guide</a><a href="/privacy">隱私權政策 / Privacy policy</a></nav>`;

publicPageRoutes.get("/privacy", (c) => {
  const support = contact(c.env);
  return html(documentPage("隱私權政策 Privacy Policy｜艾爾水晶", `
<h1>隱私權政策 <span class="en">Privacy Policy</span></h1>
<p class="dim">最後更新 Last updated：${PRIVACY_UPDATED}</p>
<p>艾爾水晶（Project Brain，<code>projects.uic-ai.com</code>）是 UIC 內部使用的專案追蹤系統，只開放經管理員核准的公司成員登入。本政策說明網站與 AI 連接器（MCP，<code>https://projects.uic-ai.com/mcp</code>）如何處理資料。</p>
<p class="en">艾爾水晶 (Project Brain) is UIC's internal project-tracking system; only company members approved by an administrator can sign in. This policy covers the website and its AI connector (MCP server at <code>https://projects.uic-ai.com/mcp</code>).</p>

<h2>1. 收集哪些資料 <span class="en">Data we collect</span></h2>
<ul>
  <li><strong>帳號資料</strong>：姓名、公司 Email、組別、角色，以及雜湊後的密碼（PBKDF2-SHA256，不保存明碼）。<span class="en">Account data: name, work email, team, role and a salted password hash.</span></li>
  <li><strong>工作資料</strong>：使用者自行輸入的專案、任務、里程碑、進度紀錄、會議、聯絡人、法規動態與上傳的檔案。<span class="en">Work data that users enter: projects, tasks, milestones, progress updates, meetings, contacts, regulatory updates and uploaded files.</span></li>
  <li><strong>登入與安全</strong>：登入 session、AI 連接器的授權紀錄（連接的 AI 工具名稱、權限、到期時間）、稽核紀錄（誰在何時做了哪些修改），以及註冊防濫用用的 IP 雜湊值。<span class="en">Sign-in sessions, AI connector grants (client name, scopes, expiry), an audit log of changes, and hashed IP addresses used only for sign-up rate limits.</span></li>
</ul>
<p>AI 連接器只接收 AI 工具呼叫工具時送來的參數（例如要查哪個專案、要新增的任務內容），<strong>不讀取也不保存你與 AI 的對話內容</strong>、聊天紀錄、AI 記憶或你在 AI 工具裡的檔案。<span class="en">The AI connector only receives the arguments of each tool call. It never reads or stores your conversations, chat history, AI memory or files kept in the AI app.</span></p>

<h2>2. 資料用途 <span class="en">How we use data</span></h2>
<ul>
  <li>提供專案追蹤功能、權限控管、每日提醒與通知信。<span class="en">To run project tracking, permissions, reminders and notification emails.</span></li>
  <li>AI 功能（週報／月報、風險分析、站內 AI 小幫手、法規摘要）會把相關的專案資料送給下列 AI 服務處理。<span class="en">AI features (reports, risk analysis, the in-app assistant, regulatory summaries) send the relevant project data to the AI providers listed below.</span></li>
  <li>不做廣告、不販售資料，也不用來訓練我們自己的模型。<span class="en">No advertising, no sale of data, and no training of our own models.</span></li>
</ul>

<h2>3. 第三方服務 <span class="en">Third parties</span></h2>
<table>
  <tr><th>服務 Service</th><th>用途 Purpose</th></tr>
  <tr><td>Cloudflare</td><td>網站主機、資料庫（D1）、檔案（R2）、授權資料（KV）、寄信（Email Service）<span class="en"> — hosting, database, file storage, OAuth data, email sending</span></td></tr>
  <tr><td>AgentMail</td><td>Cloudflare 寄信失敗時的備援寄信服務<span class="en"> — fallback email delivery</span></td></tr>
  <tr><td>DeepSeek、Ollama Cloud</td><td>站內 AI 功能的語言模型<span class="en"> — language models for in-app AI features</span></td></tr>
  <tr><td>你連接的 AI 工具（例如 Claude）<br><span class="en">The AI app you connect (e.g. Claude)</span></td><td>你透過 AI 連接器查詢或修改的資料會回傳給該 AI 工具，並依該工具的隱私權政策處理。<span class="en"> Data you read or change through the connector is returned to that AI app and handled under its own privacy policy.</span></td></tr>
</table>
<p>除上述服務與法律要求外，不會把資料提供給其他第三方。<span class="en">We share data with no one else, except where the law requires it.</span></p>

<h2>4. 保存期間 <span class="en">Retention</span></h2>
<ul>
  <li>帳號與工作資料在帳號或專案存在期間保存；管理員停用帳號或刪除專案後即不再提供。<span class="en">Account and work data are kept while the account or project exists.</span></li>
  <li>登入 session 到期即失效；AI 連接器的授權閒置 30 天後失效，過期資料每日清除。<span class="en">Sessions expire; AI connector grants expire after 30 days without use and expired data is purged daily.</span></li>
  <li>稽核紀錄依公司內部規定保存，用於追查資料變更。<span class="en">The audit log is kept under company policy to trace changes.</span></li>
</ul>

<h2>5. 你的權利與控制 <span class="en">Your choices</span></h2>
<ul>
  <li>隨時可在「個人設定 → AI 連接器」中斷任何 AI 工具的連線；授權時也可以只給讀取權限。<span class="en">Disconnect any AI app under Profile → AI connectors at any time, or grant read-only access when connecting.</span></li>
  <li>可在「個人設定」關閉通知信，或使用信中的一鍵取消訂閱。<span class="en">Turn off notification emails in your profile or with the one-click unsubscribe link.</span></li>
  <li>要查閱、更正或刪除個人資料，請聯絡下方窗口。<span class="en">To access, correct or delete your personal data, use the contact below.</span></li>
</ul>

<h2>6. 安全 <span class="en">Security</span></h2>
<p>全程 HTTPS；AI 連接器採 OAuth 2.1（PKCE），每次呼叫都以使用者本人的權限執行，看不到也改不了使用者在網站上沒有權限的資料。<span class="en">HTTPS everywhere. The connector uses OAuth 2.1 with PKCE, and every call runs with the signed-in user's own permissions.</span></p>

<h2>7. 聯絡我們 <span class="en">Contact</span></h2>
<p>${support.zh}<br><span class="en">${support.en}</span></p>
<p class="dim">本政策若有修改，會更新本頁的日期。<span class="en">Changes to this policy are reflected by the date above.</span></p>
${footer}`, "艾爾水晶（Project Brain）網站與 AI 連接器的隱私權政策 / Privacy policy for 艾爾水晶 and its AI connector."));
});

publicPageRoutes.get("/connector", (c) => {
  const origin = new URL(c.env.APP_BASE_URL).origin;
  const support = contact(c.env);
  const row = (tool: (typeof CONNECTOR_TOOLS)[number]) => {
    const kind = !tool.write ? "讀取 Read" : toolIsDestructive(tool) ? (tool.destructive ? "刪除 Delete" : "修改 Update") : "新增 Create";
    return `<tr><td><code>${escapeHtml(tool.name)}</code></td><td>${escapeHtml(tool.title)}</td><td>${kind}</td></tr>`;
  };
  const reads = CONNECTOR_TOOLS.filter((tool) => !tool.write);
  const writes = CONNECTOR_TOOLS.filter((tool) => tool.write);
  return html(documentPage("AI 連接器說明 Connector guide｜艾爾水晶", `
<h1>艾爾水晶 AI 連接器 <span class="en">AI connector (MCP)</span></h1>
<p>讓 Claude 等 AI 工具直接查詢與更新你在艾爾水晶的專案：列出專案與風險、查看看板與里程碑、整理待辦、新增進度紀錄與任務、記錄會議與法規動態。AI 只能做你在網站上本來就能做的事，每一筆修改都記在稽核紀錄裡。</p>
<p class="en">Lets Claude and other AI apps read and update your 艾爾水晶 projects: list projects and risks, read boards and milestones, review your to-dos, post progress updates and tasks, and record meetings and regulatory updates. The AI can do only what you can do on the website, and every change is recorded in the audit log.</p>

<h2>使用前提 <span class="en">Requirements</span></h2>
<p>需要一個經公司管理員核准的艾爾水晶帳號。<span class="en">You need a 艾爾水晶 account approved by your company's administrator.</span></p>

<h2>連接方式 <span class="en">Connect</span></h2>
<p>伺服器網址 <span class="en">Server URL</span>：<code>${escapeHtml(origin)}/mcp</code>（Streamable HTTP，OAuth 2.1）</p>
<ol>
  <li><strong>Claude（網頁、桌面、手機）</strong>：設定 → 連接器 → 新增自訂連接器，貼上上面的網址；Client ID／Secret 留空。<span class="en">Claude apps: Settings → Connectors → Add custom connector, paste the URL and leave the client ID and secret empty.</span></li>
  <li><strong>Claude Code</strong>：<code>claude mcp add --transport http project-brain ${escapeHtml(origin)}/mcp</code>，再執行 <code>/mcp</code> 登入。<span class="en">Then run /mcp to sign in.</span></li>
  <li>瀏覽器會開啟艾爾水晶的登入與授權頁。可以只允許讀取，或另外勾選「新增與修改」。<span class="en">Sign in to 艾爾水晶 and choose read-only, or also allow “create and update”.</span></li>
</ol>

<h2>權限 <span class="en">Permissions</span></h2>
<ul>
  <li><code>mcp:read</code>：查看你看得到的專案、任務、里程碑、進度、待辦、會議、聯絡人與已發布法規。<span class="en">Read what you can see.</span></li>
  <li><code>mcp:write</code>：以你的名義新增與修改。沒有勾選時，寫入工具不會出現。<span class="en">Create and update as you; write tools are hidden without it.</span></li>
</ul>
<p>修改或刪除既有資料的工具都標示為 destructive，Claude 每次執行前會請你確認；刪除無法復原。<span class="en">Tools that change or delete existing data are annotated as destructive, so Claude asks before each call; deletions cannot be undone.</span></p>

<h2>工具 <span class="en">Tools</span></h2>
<h3>讀取 <span class="en">Read-only</span>（${reads.length}）</h3>
<table><tr><th>Tool</th><th>名稱</th><th>類型 Type</th></tr>${reads.map(row).join("")}</table>
<h3>寫入 <span class="en">Write</span>（${writes.length}）</h3>
<table><tr><th>Tool</th><th>名稱</th><th>類型 Type</th></tr>${writes.map(row).join("")}</table>

<h2>使用範例 <span class="en">Example prompts</span></h2>
<ul>
  <li>「列出 RA/PV 組 AI 風險為高的專案，並說明原因。」<span class="en">List RA/PV projects rated high risk and explain why.</span></li>
  <li>「我這週有哪些到期或逾期的任務？」<span class="en">What tasks of mine are due or overdue this week?</span></li>
  <li>「幫這個查驗登記專案新增一筆進度紀錄：已補件，等候 TFDA 核准。」<span class="en">Add a progress update to this registration project: documents resubmitted, awaiting TFDA approval.</span></li>
</ul>

<h2>中斷連線 <span class="en">Disconnect</span></h2>
<p>在艾爾水晶的「個人設定 → AI 連接器」中斷，或在 AI 工具裡移除連接器。授權閒置 30 天也會自動失效。<span class="en">Disconnect under Profile → AI connectors, or remove the connector in your AI app. Grants also expire after 30 days without use.</span></p>

<h2>疑難排解 <span class="en">Troubleshooting</span></h2>
<ul>
  <li>授權頁顯示「請先變更密碼」：先登入網站改掉預設密碼。<span class="en">“Change your password first”: sign in to the website and change your initial password.</span></li>
  <li>工具回覆「只有讀取權限」：中斷後重新連接，並勾選「新增與修改」。<span class="en">“Read-only connection”: reconnect and allow create and update.</span></li>
  <li>工具回覆含追蹤碼的錯誤：把追蹤碼提供給管理員。<span class="en">An error with a trace id: give the trace id to your administrator.</span></li>
</ul>

<h2>支援 <span class="en">Support</span></h2>
<p>${support.zh}<br><span class="en">${support.en}</span></p>
<p>資料處理方式請見<a href="/privacy">隱私權政策</a>。<span class="en">See the <a href="/privacy">privacy policy</a> for how data is handled.</span></p>
${footer}`, "艾爾水晶 AI 連接器（MCP）的連接方式、權限與工具清單 / How to connect the 艾爾水晶 MCP connector to Claude."));
});
