// 在畫面繪製前套用已存的主題與語言，避免閃一下白底。
// 原本是 index.html 的行內 script；搬成檔案是為了讓 CSP 的 script-src 不必開 'unsafe-inline'。
try{var t=localStorage.getItem("AIUR_THEME");document.documentElement.dataset.theme=t==="dark"?"dark":"light";var l=localStorage.getItem("AIUR_LANG");document.documentElement.lang=l==="en"?"en":"zh-Hant-TW"}catch(e){document.documentElement.dataset.theme="light"}
