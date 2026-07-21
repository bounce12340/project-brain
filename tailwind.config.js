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
        sans: ["Noto Sans TC", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"]
      },
      fontSize: {
        xs: ["13px", { lineHeight: "18px" }],
        sm: ["15px", { lineHeight: "22px" }]
      }
    }
  },
  plugins: []
};
