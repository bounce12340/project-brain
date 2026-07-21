import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, Protected } from "./auth";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/AdminPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TodosPage } from "./pages/TodosPage";

const page = (content: React.ReactNode, admin = false) => <Protected admin={admin}><Layout>{content}</Layout></Protected>;

export function App() {
  return <AuthProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/change-password" element={<Protected><ChangePasswordPage /></Protected>} /><Route path="/" element={page(<DashboardPage />)} /><Route path="/projects" element={page(<ProjectsPage />)} /><Route path="/projects/:id" element={page(<ProjectDetailPage />)} /><Route path="/reports" element={page(<ReportsPage />)} /><Route path="/todos" element={page(<TodosPage />)} /><Route path="/notifications" element={page(<NotificationsPage />)} /><Route path="/admin" element={page(<AdminPage />, true)} /><Route path="/profile" element={page(<ProfilePage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></AuthProvider>;
}
