import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 테니스 코트 그린 계열 브랜드 컬러 (full scale)
        court: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
        },
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Pretendard Variable",
          ...defaultTheme.fontFamily.sans,
        ],
      },
      boxShadow: {
        // 다층의 은은한 그림자 — 카드/버튼에 깊이감을 준다
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)",
        "soft-lg": "0 6px 20px rgba(15,23,42,0.08), 0 16px 40px rgba(15,23,42,0.08)",
        focus: "0 0 0 3px rgba(34,197,94,0.18)",
      },
      borderRadius: {
        xl: "0.85rem",
        "2xl": "1.1rem",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.3s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
