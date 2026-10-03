import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { zh, type TransKey } from "./translations";
export type Lang = "zh" | "en";
export const LANG_STORAGE_KEY = "AIUR_LANG";
export function normalizeLang(value: string | null | undefined): Lang { return value === "en" ? "en" : "zh"; }
export function readStoredLang(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Lang { return normalizeLang(storage?.getItem(LANG_STORAGE_KEY)); }
export function interpolate(template: string, values: Record<string, string | number> = {}): string { return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key])); }
type Translate = (key: TransKey, values?: Record<string, string | number>) => string;
type Dictionary = Record<TransKey, string>;

/** 中文一定在首頁的程式裡；英文另成一個檔，第一次切到英文時才下載，載好之前先顯示中文。 */
const dictionaries: Partial<Record<Lang, Dictionary>> = { zh };
let loadingEn: Promise<void> | null = null;
export function loadLanguage(lang: Lang): Promise<void> {
  if (dictionaries[lang]) return Promise.resolve();
  loadingEn ??= import("./translations-en").then((module) => { dictionaries.en = module.en; }).finally(() => { loadingEn = null; });
  return loadingEn;
}
export const isLanguageLoaded = (lang: Lang) => Boolean(dictionaries[lang]);
export const dictionary = (lang: Lang): Dictionary => dictionaries[lang] ?? zh;
interface LangValue { lang: Lang; setLang(lang: Lang): void; toggleLang(): void; t: Translate }
const LangContext = createContext<LangValue | null>(null);
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  // 英文檔下載完成時加一，讓畫面換成英文。
  const [loaded, setLoaded] = useState(0);
  useEffect(() => { if (!isLanguageLoaded(lang)) loadLanguage(lang).then(() => setLoaded((count) => count + 1)).catch(() => undefined); }, [lang]);
  const setLang = (value: Lang) => { setLangState(value); localStorage.setItem(LANG_STORAGE_KEY, value); };
  useEffect(() => { document.documentElement.lang = lang === "zh" ? "zh-Hant-TW" : "en"; }, [lang]);
  const value = useMemo<LangValue>(() => ({ lang, setLang, toggleLang: () => setLang(lang === "zh" ? "en" : "zh"), t: (key, values) => interpolate(dictionary(lang)[key], values) }), [lang, loaded]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
export function useLang() { const value = useContext(LangContext); if (!value) throw new Error("LangProvider missing"); return value; }
export function useT(): Translate { return useLang().t; }
