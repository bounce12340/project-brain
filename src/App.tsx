import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, Protected } from "./auth";
import { Layout } from "./components/Layout";
import { PageErrorBoundary } from "./components/ErrorBoundary";
import { useT } from "./i18n/LangContext";

const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const ArchivePage = lazy(() => import("./pages/ArchivePage").then((m) => ({ default: m.ArchivePage })));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage").then((m) => ({ default: m.ChangePasswordPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const ImportPage = lazy(() => import("./pages/ImportPage").then((m) => ({ default: m.ImportPage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage").then((m) => ({ default: m.ProjectDetailPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const RegisterPage = lazy(() => import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })));
const RegwatchPage = lazy(() => import("./pages/RegwatchPage").then((m) => ({ default: m.RegwatchPage })));
const TimelinePage = lazy(() => import("./pages/TimelinePage").then((m) => ({ default: m.TimelinePage })));
const TodosPage = lazy(() => import("./pages/TodosPage").then((m) => ({ default: m.TodosPage })));

export function App() {
  const t = useT();
  const location = useLocation();
  const page = (content: React.ReactNode, admin = false) => <Protected admin={admin}><Layout><PageErrorBoundary resetKey={location.pathname}>{content}</PageErrorBoundary></Layout></Protected>;
  return <AuthProvider><Suspense fallback={<div className="grid min-h-screen place-items-center bg-void text-star-dim">{t("common.loading")}</div>}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="/change-password" element={<Protected><ChangePasswordPage /></Protected>} /><Route path="/" element={page(<DashboardPage />)} /><Route path="/projects" element={page(<ProjectsPage />)} /><Route path="/projects/:id" element={page(<ProjectDetailPage />)} /><Route path="/archive" element={page(<ArchivePage />)} /><Route path="/import" element={page(<ImportPage />)} /><Route path="/timeline" element={page(<TimelinePage />)} /><Route path="/reports" element={page(<ReportsPage />)} /><Route path="/todos" element={page(<TodosPage />)} /><Route path="/notifications" element={page(<NotificationsPage />)} /><Route path="/regwatch" element={page(<RegwatchPage />)} /><Route path="/help" element={page(<HelpPage />)} /><Route path="/admin" element={page(<AdminPage />, true)} /><Route path="/profile" element={page(<ProfilePage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></AuthProvider>;
}
