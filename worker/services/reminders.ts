import type { NotificationItem } from "../types";

export interface EmailDigest {
  email: string;
  items: Array<Pick<NotificationItem, "title" | "body" | "link">>;
}

export function groupEmailNotifications(items: NotificationItem[]): EmailDigest[] {
  const grouped = new Map<string, EmailDigest>();
  for (const item of items) {
    const digest = grouped.get(item.email) ?? { email: item.email, items: [] };
    digest.items.push({ title: item.title, body: item.body, link: item.link });
    grouped.set(item.email, digest);
  }
  return [...grouped.values()];
}
