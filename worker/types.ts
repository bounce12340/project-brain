export type Role = "admin" | "member" | "intern";
export type Visibility = "all" | "group" | "private";
export type GroupType = "clinical" | "bd" | "general" | "qa";

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
  onboarding_done: number;
  approval_status: "pending" | "approved" | "rejected";
  /** 所屬公司（由組別決定）。 */
  company_id: string;
  company_name: string;
  /** 系統管理員：可以建立公司、發邀請。和公司內的 admin 角色分開。 */
  is_system_admin: number;
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
