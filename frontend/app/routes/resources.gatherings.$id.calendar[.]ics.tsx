import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { ApiError, apiRaw } from "~/lib/api.server";
import { publicOrigin } from "~/lib/origin.server";
import { requireToken } from "~/lib/session.server";

// 모임 일정 .ics 파일 (아이폰·맥 캘린더, 삼성 캘린더 등). 백엔드가 만든 파일을 그대로 넘긴다.
// 설명에 모임 화면 주소를 넣도록 접속한 주소(origin)를 함께 보낸다.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = Number(params.id);
  const link = `${publicOrigin(request)}/app/gatherings/${id}`;
  try {
    const upstream = await apiRaw(
      `/gatherings/${id}/calendar.ics?link=${encodeURIComponent(link)}`,
      { token }
    );
    return new Response(await upstream.text(), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="otesik-${id}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // 아직 공개 전이거나 지워진 모임: 모임 화면이 안내한다
    if (err instanceof ApiError) throw redirect(`/app/gatherings/${id}`);
    throw err;
  }
}
