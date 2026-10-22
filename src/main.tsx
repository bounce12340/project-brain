import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// 第一個載入：在任何頁面動態載入之前，記下這個分頁是哪一版（見 version-check.ts）。
import { shouldAutoReload } from "./version-check";
import { App } from "./App";
import { applyFontSizePreference, readFontSizePreference } from "./fontsize";
import { LangProvider, loadLanguage, readStoredLang } from "./i18n/LangContext";
import { ThemeProvider } from "./theme/ThemeContext";
import "./styles.css";

applyFontSizePreference(readFontSizePreference());

// 部署新版後，舊分頁點進還沒載過的頁面會找不到那一頁的檔案：自動重新整理一次，載到新版。
window.addEventListener("vite:preloadError", (event) => {
  if (shouldAutoReload(typeof sessionStorage === "undefined" ? undefined : sessionStorage)) { event.preventDefault(); window.location.reload(); }
});

const render = () => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider><LangProvider><BrowserRouter><App /></BrowserRouter></LangProvider></ThemeProvider>
  </React.StrictMode>,
);
// 上次用英文的人，先載好英文再畫，不會先閃一下中文；中文不用等。載不到也照樣畫（先顯示中文）。
loadLanguage(readStoredLang()).catch(() => undefined).finally(render);
