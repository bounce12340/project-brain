import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { applyFontSizePreference, readFontSizePreference } from "./fontsize";
import { LangProvider, loadLanguage, readStoredLang } from "./i18n/LangContext";
import { ThemeProvider } from "./theme/ThemeContext";
import "./styles.css";

applyFontSizePreference(readFontSizePreference());

const render = () => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider><LangProvider><BrowserRouter><App /></BrowserRouter></LangProvider></ThemeProvider>
  </React.StrictMode>,
);
// 上次用英文的人，先載好英文再畫，不會先閃一下中文；中文不用等。載不到也照樣畫（先顯示中文）。
loadLanguage(readStoredLang()).catch(() => undefined).finally(render);
