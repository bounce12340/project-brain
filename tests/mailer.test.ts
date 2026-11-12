import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailSuppressedError, sendMail } from "../worker/services/mailer";
import { sendNotificationMail } from "../worker/services/notification-mail";
import { runDailyReminders } from "../worker/services/cron";
import { taipeiDate } from "../worker/services/time";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * 寄信先用 Cloudflare Email Service，沒設定或寄失敗時改用 AgentMail；
 * 收件人在 Cloudflare 的封鎖名單上時不改用 AgentMail 硬寄。
 */

type Builder = { from: { email: string; name: string }; to: string; subject: string; text: string; headers?: Record<string, string> };
let cfSent: Builder[];
let cfError: (Error & { code?: string }) | null;
let agentSent: Array<Record<string, unknown>>;
let env: Env;

const cfFail = (code: string) => Object.assign(new Error(`failed: ${code}`), { code });

beforeEach(async () => {
  const { db } = createTestD1();
  cfSent = [];
  cfError = null;
  agentSent = [];
  env = {
    DB: db,
    APP_BASE_URL: "https://brain.test",
    MAIL_FROM_ADDRESS: "notify@projects.uic-ai.com",
    MAIL_FROM_NAME: "艾爾水晶-專案進度",
    AGENTMAIL_API_KEY: "test-key",
    AGENTMAIL_INBOX_ID: "team@agentmail.test",
    EMAIL: {
      send: async (message: Builder) => {
        if (cfError) throw cfError;
        cfSent.push(message);
        return { messageId: `cf${cfSent.length}` };
      },
    },
  } as unknown as Env;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain("api.agentmail.to");
    agentSent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: `am${agentSent.length}` }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("sendMail", () => {
  it("有 send_email 綁定與寄件地址時用 Cloudflare 寄，寄件人帶名稱", async () => {
    const result = await sendMail(env, "a@example.com", "主旨", "內文", { html: "<p>內文</p>" });
    expect(result).toEqual({ sent: true, provider: "cloudflare", message_id: "cf1" });
    expect(cfSent).toEqual([{ from: { email: "notify@projects.uic-ai.com", name: "艾爾水晶-專案進度" }, to: "a@example.com", subject: "主旨", text: "內文", html: "<p>內文</p>" }]);
    expect(agentSent).toHaveLength(0);
  });

  it("Cloudflare 寄失敗（例如網域還沒驗證）時改用 AgentMail，並記下原因", async () => {
    cfError = cfFail("E_SENDER_NOT_VERIFIED");
    const result = await sendMail(env, "a@example.com", "主旨", "內文");
    expect(result).toMatchObject({ sent: true, provider: "agentmail", message_id: "am1", fallback_reason: "E_SENDER_NOT_VERIFIED" });
    expect(agentSent).toHaveLength(1);
  });

  it("收件人在 Cloudflare 的封鎖名單上：不改用 AgentMail", async () => {
    cfError = cfFail("E_RECIPIENT_SUPPRESSED");
    await expect(sendMail(env, "a@example.com", "主旨", "內文")).rejects.toBeInstanceOf(MailSuppressedError);
    expect(agentSent).toHaveLength(0);
  });

  it("Cloudflare 寄失敗又沒有 AgentMail 金鑰：拋出錯誤", async () => {
    cfError = cfFail("E_DAILY_LIMIT_EXCEEDED");
    env = { ...env, AGENTMAIL_API_KEY: "" } as Env;
    await expect(sendMail(env, "a@example.com", "主旨", "內文")).rejects.toThrow("E_DAILY_LIMIT_EXCEEDED");
  });

  it("沒有 send_email 綁定或寄件地址時照舊用 AgentMail", async () => {
    expect(await sendMail({ ...env, EMAIL: undefined } as unknown as Env, "a@example.com", "主旨", "內文")).toMatchObject({ provider: "agentmail" });
    expect(await sendMail({ ...env, MAIL_FROM_ADDRESS: "" } as unknown as Env, "a@example.com", "主旨", "內文")).toMatchObject({ provider: "agentmail" });
    expect(cfSent).toHaveLength(0);
  });

  it("兩邊都沒設定：略過，不拋錯", async () => {
    expect(await sendMail({ ...env, EMAIL: undefined, AGENTMAIL_API_KEY: "" } as unknown as Env, "a@example.com", "主旨", "內文")).toEqual({ sent: false, skipped: true });
  });
});

describe("通知信經 Cloudflare 寄出", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM todos").run();
    await env.DB.prepare("INSERT INTO users (id,email,name,password_hash,role,group_id,must_change_password,email_notifications) VALUES ('u1','u1@example.com','甲','x','member','grp_general',0,1),('u2','u2@example.com','乙','x','member','grp_general',0,1)").run();
  });

  it("一鍵取消訂閱標頭照樣帶上", async () => {
    await sendNotificationMail(env, { id: "u1", email: "u1@example.com" }, "[艾爾水晶] 今日提醒", "內容");
    const token = await env.DB.prepare("SELECT email_token FROM users WHERE id='u1'").first<string>("email_token");
    expect(cfSent[0].headers).toEqual({ "List-Unsubscribe": `<https://brain.test/email/unsubscribe?token=${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("每日提醒：一個人寄失敗不影響其他人", async () => {
    await env.DB.prepare("INSERT INTO todos (id,user_id,title,due_date) VALUES ('t1','u1','交文件',?),('t2','u2','交文件',?)").bind(taipeiDate(), taipeiDate()).run();
    const send = env.EMAIL.send.bind(env.EMAIL);
    (env.EMAIL as unknown as { send: (m: Builder) => Promise<unknown> }).send = async (message: Builder) => {
      if (message.to === "u1@example.com") throw cfFail("E_RECIPIENT_SUPPRESSED");
      return send(message as never);
    };
    const result = await runDailyReminders(env);
    const recipients = cfSent.map((mail) => mail.to);
    expect(recipients).toContain("u2@example.com");
    expect(recipients).not.toContain("u1@example.com");
    expect(result.emails).toBe(cfSent.length);
    expect(agentSent).toHaveLength(0);
  });
});
