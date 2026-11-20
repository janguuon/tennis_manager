/**
 * 홈 화면 앱(PWA) 매니페스트: /manifest.webmanifest
 *
 * public/ 폴더의 파일은 remix-serve 가 1년 동안 바뀌지 않는 파일(immutable)로 내보내서, 폰이 예전 매니페스트를
 * 오래 들고 있을 수 있다. 그래서 라우트로 내보내고 캐시는 1시간만 둔다.
 */
const MANIFEST = {
  id: "/app",
  name: "오테식 매니저",
  short_name: "오테식",
  description: "오순도순 테니스 식구의 일정 · 전적 · 회비",
  lang: "ko",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  background_color: "#F3ECE3",
  theme_color: "#F3ECE3",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
};

export function loader() {
  return new Response(JSON.stringify(MANIFEST, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
