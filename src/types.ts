export interface User {
  id: string; email: string; name: string; role: "admin" | "member" | "intern"; group_id: string; group_name: string; group_type: "clinical" | "bd" | "general"; must_change_password: number; email_notifications: number; onboarding_done: number;
}

export interface Project {
  id: string; name: string; description: string; group_id: string; group_name: string; group_type: "clinical" | "bd" | "general"; owner_id: string; owner_name: string; visibility: "all" | "group" | "private"; status: "active" | "paused" | "done" | "archived"; progress: number; progress_mode: "manual" | "auto"; goal_summary: string; start_date: string | null; target_date: string | null; auto_archive: number; last_activity_at: string; risk_level: "low" | "medium" | "high" | null; risk_summary: string | null; risk_suggestions: string | null; risk_updated_at: string | null;
}

export interface Metadata {
  groups: Array<{ id: string; name: string; type: string }>;
  templates: Array<{ id: string; name: string; group_id: string | null; stages_json: string }>;
  users: Array<{ id: string; name: string; email: string; role: string; group_id: string }>;
}

export interface Stage { id: string; project_id: string; name: string; color: string; position: number }
export interface Task { id: string; project_id: string; stage_id: string; title: string; description: string; assignee_id: string | null; assignee_name?: string; start_date: string | null; due_date: string | null; position: number; done: number; done_at: string | null; created_at: string; dependency_ids: string[]; comment_count: number; attachment_count: number }
export interface Milestone { id: string; title: string; due_date: string | null; done: number; position: number }
export interface ProgressUpdate { id: string; content: string; progress_snapshot: number | null; author_name: string; is_support: number; created_at: string }
export interface Enrollment { id: string; record_date: string; site: string | null; count: number; note: string; created_by_name: string }
export interface BdCase { id: string; case_name: string; product_name: string; case_type: string; submission_no: string | null; current_status: string; submitted_at: string | null; expected_approval: string | null; note: string }
export interface BdEvent { id: string; case_id: string; event_date: string; event_type: string; description: string; created_by_name: string }
export interface BdFee { id: string; case_id: string | null; fee_date: string; category: string; amount: number; currency: string; note: string }
export interface ProjectFile { id: string; project_id: string; task_id: string | null; filename: string; size: number; content_type: string; uploaded_by: string; uploaded_by_name: string; task_title: string | null; created_at: string; can_delete: boolean }
export interface TaskComment { id: string; task_id: string; author_id: string; author_name: string; content: string; created_at: string }
export interface AutomationRule { id: string; project_id: string; name: string; trigger_type: string; trigger_param: string | null; action_type: string; action_param_user: string | null; action_param_text: string | null; enabled: number }

export interface ProjectDetail {
  project: Project; permissions: { can_edit: boolean; can_manage: boolean; can_view_fees: boolean };
  members: Array<{ id: string; name: string; email: string; role: string; group_name: string }>;
  stages: Stage[]; tasks: Task[]; milestones: Milestone[]; progress_updates: ProgressUpdate[];
  clinical_settings: { project_id: string; target_n: number } | null; enrollments: Enrollment[];
  bd_cases: BdCase[]; bd_events: BdEvent[]; bd_fees?: BdFee[];
}
