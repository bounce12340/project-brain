import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import type { User } from "./types";
import { useT } from "./i18n/LangContext";

interface AuthValue { user: User | null; loading: boolean; login(email: string, password: string): Promise<User>; logout(): Promise<void>; refresh(): Promise<void> }
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { try { setUser((await api<{ user: User }>("/auth/me")).user); } catch { setUser(null); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const login = async (email: string, password: string) => { const result = await api<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); setUser(result.user); return result.user; };
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider missing"); return value; }

export function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth(); const location = useLocation();
  const t = useT();
  if (loading) return <div className="grid min-h-screen place-items-center text-star-dim">{t("common.loading")}</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.must_change_password && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
