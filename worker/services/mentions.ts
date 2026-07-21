export interface Mentionable { id: string; name: string }

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW");
}

export function parseMentionedUserIds(content: string, users: Mentionable[]): string[] {
  const normalized = normalize(content);
  return users.filter((user) => normalized.includes(`@${normalize(user.name)}`)).map((user) => user.id);
}

