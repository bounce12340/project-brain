/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "rgb(var(--color-void) / <alpha-value>)",
        nexus: { DEFAULT: "rgb(var(--color-nexus) / <alpha-value>)", raised: "rgb(var(--color-nexus-raised) / <alpha-value>)", line: "rgb(var(--color-nexus-line) / <alpha-value>)" },
        gold: { DEFAULT: "rgb(var(--color-gold) / <alpha-value>)", bright: "rgb(var(--color-gold-bright) / <alpha-value>)", dim: "rgb(var(--color-gold-dim) / <alpha-value>)" },
        psi: { DEFAULT: "rgb(var(--color-psi) / <alpha-value>)", deep: "rgb(var(--color-psi-deep) / <alpha-value>)", glow: "rgb(var(--color-psi) / .35)" },
        star: { DEFAULT: "rgb(var(--color-star) / <alpha-value>)", dim: "rgb(var(--color-star-dim) / <alpha-value>)" },
        ok: "rgb(var(--color-ok) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)"
      },
      fontFamily: {
        // 一律用電腦內建的字型，不必下載：Windows 是微軟正黑體，Mac／iPhone 沒有時用蘋方，Android 用思源黑體。
        sans: ["Microsoft JhengHei", "微軟正黑體", "PingFang TC", "Heiti TC", "Noto Sans TC", "Noto Sans CJK TC", "system-ui", "sans-serif"]
      },
      // 圓角分四級，越大的紙越圓：紙頁、卡片、按鈕與欄位、小標籤。數值在 styles.css 的 --radius-*。
      borderRadius: {
        sheet: "var(--radius-sheet)",
        card: "var(--radius-card)",
        control: "var(--radius-control)",
        tag: "var(--radius-tag)"
      },
      fontSize: {
        xs: ["13px", { lineHeight: "18px" }],
        sm: ["15px", { lineHeight: "22px" }]
      }
    }
  },
  plugins: []
};
