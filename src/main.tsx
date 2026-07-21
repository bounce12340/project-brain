import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { applyFontSizePreference, readFontSizePreference } from "./fontsize";
import { LangProvider } from "./i18n/LangContext";
import { ThemeProvider } from "./theme/ThemeContext";
import "./styles.css";

applyFontSizePreference(readFontSizePreference());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider><LangProvider><BrowserRouter><App /></BrowserRouter></LangProvider></ThemeProvider>
  </React.StrictMode>,
);
