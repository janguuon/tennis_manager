import type { LoaderFunctionArgs } from "@remix-run/node";

import { ApiError, apiRaw } from "~/lib/api.server";
import { publicOrigin } from "~/lib/origin.server";

// 참석 일정 구독 (폰 캘린더가 주기적으로 받아 간다). 캘린더 앱은 로그인할 수 없어 로그인 없이 열리고,
// 주소 속 비밀 토큰이 열쇠다 (서버 app/routers/calendar_feed.py). 일정마다 모임 화면 링크를 넣도록 접속 주소를 넘긴다.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = encodeURIComponent(params.token ?? "");
  const base = encodeURIComponent(publicOrigin(request));
  try {
    const upstream = await apiRaw(`/calendar-feed/${token}.ics?base=${base}`);
    return new Response(await upstream.text(), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="otesik.ics"',
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response("구독 주소를 찾을 수 없어요. 마이페이지에서 다시 만들어 주세요.", {
        status: err.status === 404 ? 404 : 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw err;
  }
}
