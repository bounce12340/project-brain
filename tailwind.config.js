/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#070B14",
        nexus: { DEFAULT: "#0D1526", raised: "#131E36", line: "#1C2A47" },
        gold: { DEFAULT: "#C8A24A", bright: "#E8C878", dim: "#8A7133" },
        psi: { DEFAULT: "#35C8FF", deep: "#1A6FA8", glow: "rgba(53,200,255,.35)" },
        star: { DEFAULT: "#E6EDF7", dim: "#93A4C0" },
        ok: "#46E0A0",
        warn: "#F0B44C",
        danger: "#FF5A6A"
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
