export type MailProvider = "cloudflare" | "agentmail";

export interface MailResult {
  sent: boolean;
  message_id?: string;
  skipped?: boolean;
  /** 實際寄出這封信的服務。 */
  provider?: MailProvider;
  /** Cloudflare 沒寄成、改由 AgentMail 寄出時，Cloudflare 的錯誤代碼。 */
  fallback_reason?: string;
  response?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface MailOptions {
  html?: string;
  /** 額外的信件標頭，例如通知信的 List-Unsubscribe。 */
  headers?: Record<string, string>;
}

/**
 * Cloudflare 判定這位收件人不該再收信（退信、垃圾信檢舉或手動加入的封鎖名單）。
 * 這種情況不改用 AgentMail 硬寄，否則封鎖名單就形同虛設，寄信網域的信譽也會受損。
 */
const NO_FALLBACK_CODES = new Set(["E_RECIPIENT_SUPPRESSED"]);

export class MailSuppressedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MailSuppressedError";
    this.code = code;
  }
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code) return error.code;
  return error instanceof Error ? error.name : "UNKNOWN";
}

/** 有 send_email 綁定、也設了寄件地址，才用 Cloudflare Email Service。 */
function cloudflareReady(env: Env): boolean {
  return Boolean(env.EMAIL && env.MAIL_FROM_ADDRESS);
}

async function sendViaCloudflare(env: Env, to: string, subject: string, text: string, options: MailOptions): Promise<MailResult> {
  const result = await env.EMAIL.send({
    from: { email: env.MAIL_FROM_ADDRESS, name: env.MAIL_FROM_NAME || "艾爾水晶" },
    to,
    subject,
    text,
    ...(options.html ? { html: options.html } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  return { sent: true, provider: "cloudflare", message_id: result.messageId };
}

async function sendViaAgentMail(env: Env, to: string, subject: string, text: string, options: MailOptions): Promise<MailResult> {
  const response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(env.AGENTMAIL_INBOX_ID)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, text, html: options.html, headers: options.headers }),
  });
  const parsed: unknown = await response.json().catch(() => ({}));
  const body = isRecord(parsed) ? parsed : {};
  if (!response.ok) throw new Error(`AgentMail HTTP ${response.status}`);
  const messageId = typeof body.message_id === "string" ? body.message_id : undefined;
  return { sent: true, provider: "agentmail", message_id: messageId, response: body };
}

/**
 * 寄信：先用 Cloudflare Email Service（寄件人 MAIL_FROM_ADDRESS），
 * 沒設定或寄失敗（例如網域還沒驗證、超過額度）時改用 AgentMail；兩邊都沒設定就略過，只留站內通知。
 */
export async function sendMail(env: Env, to: string, subject: string, text: string, options: MailOptions = {}): Promise<MailResult> {
  let fallbackReason: string | undefined;
  if (cloudflareReady(env)) {
    try {
      return await sendViaCloudflare(env, to, subject, text, options);
    } catch (error) {
      const code = errorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({ message: "Cloudflare Email 寄送失敗", code, error: message }));
      if (NO_FALLBACK_CODES.has(code)) throw new MailSuppressedError(code, `收件人在 Cloudflare 的封鎖名單上（${code}）`);
      if (!env.AGENTMAIL_API_KEY) throw error;
      fallbackReason = code;
    }
  }
  if (!env.AGENTMAIL_API_KEY) {
    console.log(JSON.stringify({ message: "沒有可用的寄信服務（Cloudflare Email 未設定、AGENTMAIL_API_KEY 未設定），略過 Email" }));
    return { sent: false, skipped: true };
  }
  const result = await sendViaAgentMail(env, to, subject, text, options);
  return fallbackReason ? { ...result, fallback_reason: fallbackReason } : result;
}
