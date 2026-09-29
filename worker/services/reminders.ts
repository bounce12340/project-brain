import type { NotificationItem } from "../types";

export interface EmailDigest {
  /** 收件人（信末的關閉連結是這個人的）。 */
  user_id: string;
  email: string;
  items: Array<Pick<NotificationItem, "title" | "body" | "link">>;
}

export function groupEmailNotifications(items: NotificationItem[]): EmailDigest[] {
  const grouped = new Map<string, EmailDigest>();
  for (const item of items) {
    const digest = grouped.get(item.email) ?? { user_id: item.user_id, email: item.email, items: [] };
    digest.items.push({ title: item.title, body: item.body, link: item.link });
    grouped.set(item.email, digest);
  }
  return [...grouped.values()];
}
