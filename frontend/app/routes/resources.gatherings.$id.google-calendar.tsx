import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { publicOrigin } from "~/lib/origin.server";
import { requireToken } from "~/lib/session.server";

// 구글 캘린더 '일정 추가' 화면으로 보낸다 (안드로이드). 내용은 백엔드가 만든다.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = Number(params.id);
  const link = `${publicOrigin(request)}/app/gatherings/${id}`;
  try {
    const { url } = await api<{ url: string }>(
      `/gatherings/${id}/calendar/google?link=${encodeURIComponent(link)}`,
      { token }
    );
    return redirect(url);
  } catch (err) {
    if (err instanceof ApiError) throw redirect(`/app/gatherings/${id}`);
    throw err;
  }
}
