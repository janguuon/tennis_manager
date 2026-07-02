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

import { getTheme } from "~/lib/theme.server";
import stylesheet from "~/tailwind.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  // 🎾 이모지 파비콘 (별도 파일 없이 /favicon.ico 자동요청 404 방지)
  {
    rel: "icon",
    href:
      "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎾</text></svg>",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    theme: await getTheme(request),
    // 카카오 공유용 JavaScript 키 (공개 키라 클라이언트 노출 OK)
    kakaoJsKey: process.env.KAKAO_JS_KEY ?? "",
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
