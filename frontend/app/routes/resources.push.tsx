import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { publicOrigin } from "~/lib/origin.server";
import { requireToken } from "~/lib/session.server";
import type { PushSettings } from "~/lib/types";

/**
 * 폰 알림 설정의 서버 단계 (브라우저가 fetch 로 부른다, JSON). lib/push.ts 가 쓴다.
 * - GET: 알림 설정 (공개 키·종류별 켜짐·기기 수)
 * - POST intent: subscribe(이 폰 켜기) · unsubscribe(이 폰 끄기) · test(시험 알림) · kinds(종류별 켜기/끄기)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  return json(await api<PushSettings>("/push/settings", { token }));
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    switch (body?.intent) {
      case "subscribe": {
        const sub = body.subscription as { endpoint?: string; keys?: unknown } | undefined;
        const result = await api<PushSettings>("/push/subscriptions", {
          method: "POST",
          token,
          body: {
            endpoint: sub?.endpoint,
            keys: sub?.keys,
            user_agent: String(body.user_agent ?? "").slice(0, 300) || null,
            // VAPID 'sub' 로 쓸 앱 주소 (애플 푸시는 https 주소가 있어야 받는다)
            origin: publicOrigin(request),
          },
        });
        return json({ result });
      }
      case "unsubscribe":
        return json({
          result: await api<PushSettings>("/push/unsubscribe", { method: "POST", token, body: { endpoint: body.endpoint } }),
        });
      case "test":
        return json({
          result: await api("/push/test", { method: "POST", token, body: { endpoint: body.endpoint ?? null } }),
        });
      case "kinds":
        return json({
          result: await api<PushSettings>("/push/settings", { method: "PUT", token, body: { kinds: body.kinds } }),
        });
      default:
        return json({ error: "잘못된 요청이에요." }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "잠시 뒤 다시 해 주세요.";
    return json({ error: message }, { status: err instanceof ApiError ? err.status : 500 });
  }
}
