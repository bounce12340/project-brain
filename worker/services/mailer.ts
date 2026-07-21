export interface MailResult {
  sent: boolean;
  message_id?: string;
  skipped?: boolean;
  response?: Record<string, unknown>;
}

export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  if (!env.AGENTMAIL_API_KEY) {
    console.log(JSON.stringify({ message: "AGENTMAIL_API_KEY 未設定，略過 Email" }));
    return { sent: false, skipped: true };
  }
  const response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(env.AGENTMAIL_INBOX_ID)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, text, html }),
  });
  const body: Record<string, unknown> = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AgentMail HTTP ${response.status}`);
  const messageId = typeof body.message_id === "string" ? body.message_id : undefined;
  return { sent: true, message_id: messageId, response: body };
}
