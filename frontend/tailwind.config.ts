import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 차분한 중립 회색 (앱 전체의 slate-* 클래스가 이 톤으로 바뀐다)
        slate: {
          50: "#F7F8FA",
          100: "#F1F3F5",
          200: "#E5E8EB",
          300: "#D1D6DB",
          400: "#B0B8C1",
          500: "#8B95A1",
          600: "#6B7684",
          700: "#4E5968",
          800: "#333D4B",
          900: "#191F28",
          950: "#101318",
        },
        // 브랜드 포인트: 테니스공 라임. 바탕·주요 버튼은 차콜(slate-900)이고,
        // 라임은 선택·활성·강조에만 쓴다. 흰 바탕 위 글자는 800 이상(대비 4.5:1↑).
        ball: {
          50: "#FAFDEB",
          100: "#F3FBCF",
          200: "#E8F7A3",
          300: "#DDF86B",
          400: "#D4F53C",
          500: "#BADC1E",
          600: "#93B012",
          700: "#6E840F",
          800: "#526310",
          900: "#3F4C10",
          950: "#222A05",
        },
      },
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04)",
        pop: "0 12px 32px -8px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        // backwards: 끝난 뒤 transform을 남기지 않는다(남으면 안쪽 position:fixed 모달의 기준이 틀어짐)
        "fade-in": "fade-in 0.18s ease-out backwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
