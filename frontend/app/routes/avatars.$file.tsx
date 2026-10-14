import type { LoaderFunctionArgs } from "@remix-run/node";

import { apiRaw } from "~/lib/api.server";
import { getToken } from "~/lib/session.server";

// 프로필 사진: 브라우저는 백엔드에 직접 닿지 않으므로 여기서 받아 넘겨 준다(로그인한 회원만).
// 사진을 바꾸면 파일 이름이 바뀌어 오래 캐시해도 된다.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await getToken(request);
  if (!token) return new Response(null, { status: 401 });
  try {
    const res = await apiRaw(`/avatars/${encodeURIComponent(params.file ?? "")}`, { token });
    return new Response(res.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
