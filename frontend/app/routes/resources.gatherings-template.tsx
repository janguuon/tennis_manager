import type { LoaderFunctionArgs } from "@remix-run/node";

import { apiRaw } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";

// 백엔드에서 엑셀 양식을 받아 다운로드로 프록시한다.
// (백엔드는 Bearer 토큰이 필요한데 토큰은 httpOnly 쿠키라 브라우저가 직접 못 받음)
export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const upstream = await apiRaw("/gatherings/import/template", { token });
  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="gathering_template.xlsx"',
    },
  });
}
