import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "@remix-run/react";

import { LOGO_FAVICON } from "~/components/Logo";
import { getTheme } from "~/lib/theme.server";
import stylesheet from "~/tailwind.css?url";

export const links: LinksFunction = () => [
  // 한글 웹폰트 Pretendard (가변 폰트, 쓰는 글자만 받는 dynamic subset)
  { rel: "preconnect", href: "https://cdn.jsdelivr.net", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css",
    crossOrigin: "anonymous",
  },
  { rel: "stylesheet", href: stylesheet },
  // 로고 마크 파비콘 (별도 파일 없이 /favicon.ico 자동요청 404 방지)
  { rel: "icon", href: LOGO_FAVICON },
];

/** 링크 미리보기(카톡 등) 문구 */
const SITE_NAME = "오테식 매니저";
const SITE_DESCRIPTION = "오순도순 테니스 식구의 일정 · 전적 · 회비";

/** 접속한 주소의 origin. nginx 뒤에서는 X-Forwarded-Proto로 https를 알아낸다. */
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    theme: await getTheme(request),
    // 카카오 공유용 JavaScript 키 (공개 키라 클라이언트 노출 OK)
    kakaoJsKey: process.env.KAKAO_JS_KEY ?? "",
    // og:image는 절대 주소여야 미리보기에 뜬다
    ogImage: `${publicOrigin(request)}/og-image.png`,
  });
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const theme = data?.theme ?? "light";
  return (
    <html lang="ko" className={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 링크 미리보기: 라우트 meta는 부모 것을 덮어쓰므로 모든 페이지 공통으로 여기에 둔다 */}
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={SITE_NAME} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        {data?.ogImage ? <meta property="og:image" content={data.ogImage} /> : null}
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        {/* 카카오 공유: JS 키를 window.ENV로 전달 + SDK 로드 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.ENV=${JSON.stringify({ KAKAO_JS_KEY: data?.kakaoJsKey ?? "" })}`,
          }}
        />
        <script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js" crossOrigin="anonymous" />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
