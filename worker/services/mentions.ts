export interface Mentionable { id: string; name: string }

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW");
}

export function parseMentionedUserIds(content: string, users: Mentionable[]): string[] {
  const normalized = normalize(content);
  return users.filter((user) => {
    const name = normalize(user.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`@${name}(?=$|[\\s.,，。!！?？、:：;；()（）\\[\\]{}])`, "u").test(normalized);
  }).map((user) => user.id);
}
