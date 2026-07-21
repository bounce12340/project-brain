export type Role = "admin" | "member" | "intern";
export type Visibility = "all" | "group" | "private";
export type GroupType = "clinical" | "bd" | "general";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  group_id: string;
  group_name: string;
  group_type: GroupType;
  must_change_password: number;
  email_notifications: number;
}

export interface ProjectAccess {
  id: string;
  owner_id: string;
  group_id: string;
  visibility: Visibility;
  member_ids: string[];
}

export type AppContext = {
  Bindings: Env;
  Variables: { user: AuthUser; sessionToken: string };
};

export interface NotificationItem {
  user_id: string;
  email: string;
  title: string;
  body: string;
  link: string;
}
