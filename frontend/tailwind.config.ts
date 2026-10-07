import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 따뜻한 중립색 (크림 바탕). 앱 전체의 slate-* 클래스가 이 톤으로 바뀐다.
        slate: {
          50: "#F3EAE2",
          100: "#EBE1D7",
          200: "#DED2C6",
          300: "#C9BBAE",
          400: "#A3968A",
          500: "#74685C",
          600: "#5E554C",
          700: "#4A423B",
          800: "#2D2824",
          900: "#1B1816",
          950: "#121110",
        },
        // 하우스 원색: 메뉴 타일·카드 배경. 이 위의 글자는 다크 모드에서도 항상 ink(검정).
        house: {
          blue: "#3F6CE1",
          yellow: "#F7C32E",
          orange: "#EF6A30",
          green: "#4CB35A",
          lav: "#B596F5",
          red: "#E4513A",
          ball: "#DCEB45",
        },
        ink: "#121212",
        // 중립 카드(폼·목록) 바탕
        paper: "#FFFBF7",
      },
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", ...defaultTheme.fontFamily.sans],
        // 제목·큰 숫자·로고: 라틴/숫자는 Bricolage, 한글은 Pretendard로 이어진다
        display: ["Bricolage Grotesque", "Pretendard Variable", "Pretendard", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        pop: "0 16px 40px -12px rgba(18, 18, 18, 0.35)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // 소식 띠: 같은 내용을 두 번 이어 붙이고 절반만큼 흘려 끊김 없이 반복
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        // backwards: 끝난 뒤 transform을 남기지 않는다(남으면 안쪽 position:fixed 모달의 기준이 틀어짐)
        "fade-in": "fade-in 0.18s ease-out backwards",
        marquee: "marquee 40s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
