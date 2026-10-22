/**
 * 「其他」組：放不進任何一組的專案。這一組通常沒有組員，可見性若是「同組」，
 * 實際上只有擁有者、成員與管理員看得到，所以新專案預設改成「全公司」。
 * 認名稱也認內建 id：管理員可能已經在管理中心自己建過一個叫「其他」的組。
 */
export const OTHER_GROUP_ID = "grp_other";
const OTHER_GROUP_NAMES = new Set(["其他", "其它", "other", "others"]);

export const isOtherGroup = (group: { id: string; name: string } | null | undefined): boolean =>
  !!group && (group.id === OTHER_GROUP_ID || OTHER_GROUP_NAMES.has(group.name.trim().toLowerCase()));

/** 新專案沒有指定可見性時用哪一個。 */
export const defaultVisibility = (group: { id: string; name: string } | null | undefined): "all" | "group" =>
  isOtherGroup(group) ? "all" : "group";
