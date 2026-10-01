import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "AIUR_THEME";
// 預設淺色（送審卷宗的紙頁）；明確選過深色的人保留深色。
export function normalizeTheme(value: string | null | undefined): Theme { return value === "dark" ? "dark" : "light"; }
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Theme { return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY)); }
interface ThemeValue { theme: Theme; setTheme(theme: Theme): void; toggleTheme(): void }
const ThemeContext = createContext<ThemeValue | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => normalizeTheme(document.documentElement.dataset.theme ?? readStoredTheme()));
  const setTheme = (value: Theme) => { document.documentElement.dataset.theme = value; localStorage.setItem(THEME_STORAGE_KEY, value); setThemeState(value); };
  const value = useMemo(() => ({ theme, setTheme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() { const value = useContext(ThemeContext); if (!value) throw new Error("ThemeProvider missing"); return value; }
