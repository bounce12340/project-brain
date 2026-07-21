import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, type TransKey } from "./translations";
export type Lang = "zh" | "en";
export const LANG_STORAGE_KEY = "AIUR_LANG";
export function normalizeLang(value: string | null | undefined): Lang { return value === "en" ? "en" : "zh"; }
export function readStoredLang(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Lang { return normalizeLang(storage?.getItem(LANG_STORAGE_KEY)); }
export function interpolate(template: string, values: Record<string, string | number> = {}): string { return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key])); }
type Translate = (key: TransKey, values?: Record<string, string | number>) => string;
interface LangValue { lang: Lang; setLang(lang: Lang): void; toggleLang(): void; t: Translate }
const LangContext = createContext<LangValue | null>(null);
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const setLang = (value: Lang) => { setLangState(value); localStorage.setItem(LANG_STORAGE_KEY, value); };
  useEffect(() => { document.documentElement.lang = lang === "zh" ? "zh-Hant-TW" : "en"; }, [lang]);
  const value = useMemo<LangValue>(() => ({ lang, setLang, toggleLang: () => setLang(lang === "zh" ? "en" : "zh"), t: (key, values) => interpolate(translations[lang][key], values) }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
export function useLang() { const value = useContext(LangContext); if (!value) throw new Error("LangProvider missing"); return value; }
export function useT(): Translate { return useLang().t; }
