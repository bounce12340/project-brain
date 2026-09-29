import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { runDailyReminders } from "../worker/services/cron";
import { sendNotificationMail } from "../worker/services/notification-mail";
import { taipeiDate } from "../worker/services/time";
import { createTestD1 } from "./helpers/d1-sqlite";
import { createMemoryKV } from "./helpers/memory-kv";

/**
 * 通知信可以在系統裡關掉，信末有關閉連結，並帶一鍵取消訂閱的標頭：
 * 收件人在 Gmail 按「取消訂閱」關掉的是艾爾水晶的設定，不會變成寄信服務的封鎖。
 */

const BASE = "https://brain.test";
let env: Env;
let sent: Array<{ to: string; subject: string; text: string; headers?: Record<string, string> }>;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const fetchWorker = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);
const tokenOf = async (id: string) => (await env.DB.prepare("SELECT email_token FROM users WHERE id=?").bind(id).first<string>("email_token"))!;
const notificationsOn = async (id: string) => (await env.DB.prepare("SELECT email_notifications FROM users WHERE id=?").bind(id).first<number>("email_notifications"));

beforeEach(async () => {
  const { db } = createTestD1();
  env = { DB: db, OAUTH_KV: createMemoryKV(), APP_BASE_URL: BASE, AGENTMAIL_API_KEY: "test-key", AGENTMAIL_INBOX_ID: "team@agentmail.test" } as unknown as Env;
  await db.prepare("DELETE FROM projects").run();
  await db.prepare("DELETE FROM todos").run();
  await db.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications) VALUES ('on','on@example.com','想收信','x','member','grp_general',0,1),('off','off@example.com','不收信','x','member','grp_general',0,0)").run();
  sent = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain("api.agentmail.to");
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: `m${sent.length}` }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("通知信的關閉連結與一鍵取消訂閱標頭", () => {
  it("信末附關閉連結，標頭指向同一個連結；同一個人每封信的連結相同", async () => {
    await sendNotificationMail(env, { id: "on", email: "on@example.com" }, "[艾爾水晶] 今日提醒", "內容");
    await sendNotificationMail(env, { id: "on", email: "on@example.com" }, "[艾爾水晶] 今日提醒", "內容");
    const url = `${BASE}/email/unsubscribe?token=${await tokenOf("on")}`;
    expect(sent).toHaveLength(2);
    expect(sent[0].headers).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(sent[0].text).toContain(`點這個連結關閉：${url}`);
    expect(sent[1].headers).toEqual(sent[0].headers);
  });

  it("每日提醒只寄給沒關掉通知信的人，而且帶關閉連結", async () => {
    await env.DB.prepare("INSERT INTO todos (id,user_id,title,due_date) VALUES ('t1','on','交文件',?),('t2','off','交文件',?)").bind(taipeiDate(), taipeiDate()).run();
    const result = await runDailyReminders(env);
    expect(result.emails).toBe(1);
    expect(sent.map((mail) => mail.to)).toEqual(["on@example.com"]);
    expect(sent[0].headers?.["List-Unsubscribe"]).toBe(`<${BASE}/email/unsubscribe?token=${await tokenOf("on")}>`);
    // 關掉通知信的人仍然在系統裡看得到提醒。
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='off'").first()).toEqual({ n: 1 });
  });
});

describe("/email/unsubscribe", () => {
  beforeEach(async () => { await sendNotificationMail(env, { id: "on", email: "on@example.com" }, "s", "b"); });

  it("直接打開連結只顯示確認頁，不會關掉（信箱的安全掃描會先點過連結）", async () => {
    const page = await fetchWorker(`/email/unsubscribe?token=${await tokenOf("on")}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("要關閉艾爾水晶的通知信嗎？");
    expect(html).toContain("o***@example.com");
    expect(html).not.toContain("on@example.com");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await notificationsOn("on")).toBe(1);
  });

  it("Gmail 的一鍵取消訂閱（不帶 cookie、不帶 Origin）會關掉通知信並記稽核", async () => {
    const response = await fetchWorker(`/email/unsubscribe?token=${await tokenOf("on")}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("已關閉通知信");
    expect(await notificationsOn("on")).toBe(0);
    expect(await env.DB.prepare("SELECT user_id, action, summary FROM audit_log").all().then((result) => result.results)).toEqual([{ user_id: "on", action: "email_unsubscribe", summary: "從通知信的連結關閉通知信" }]);
    // 再按一次也沒問題，不重複記稽核。
    expect((await fetchWorker(`/email/unsubscribe?token=${await tokenOf("on")}`, { method: "POST" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({ n: 1 });
    expect(await (await fetchWorker(`/email/unsubscribe?token=${await tokenOf("on")}`)).text()).toContain("通知信已經關閉");
  });

  it("代碼不對或沒帶代碼時什麼都不改", async () => {
    for (const path of ["/email/unsubscribe?token=nope", "/email/unsubscribe"]) {
      expect((await fetchWorker(path, { method: "POST" })).status).toBe(404);
      expect((await fetchWorker(path)).status).toBe(404);
    }
    expect(await notificationsOn("on")).toBe(1);
  });

  it("在個人設定可以重新開啟", async () => {
    await fetchWorker(`/email/unsubscribe?token=${await tokenOf("on")}`, { method: "POST" });
    const token = `session-${Math.random()}`;
    const { sha256 } = await import("../worker/services/crypto");
    await env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), "on", new Date(Date.now() + 86_400_000).toISOString()).run();
    const response = await fetchWorker("/api/profile", { method: "PATCH", headers: { Cookie: `sid=${token}`, Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ email_notifications: true }) });
    expect(response.status).toBe(200);
    expect(await notificationsOn("on")).toBe(1);
  });
});
