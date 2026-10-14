import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { Me } from "~/lib/types";

// 내 프로필 사진 올리기(POST, 브라우저에서 줄인 사진) / 지우기(DELETE) → 백엔드로 전달
export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);

  if (request.method === "DELETE") {
    try {
      const me = await api<Me>("/users/me/avatar", { method: "DELETE", token });
      return json({ ok: true, error: null as string | null, avatar_url: me.avatar_url });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "사진을 지우지 못했어요.";
      return json({ ok: false, error: message, avatar_url: null }, { status: 400 });
    }
  }

  let form: FormData;
  try {
    form = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: 8_000_000 })
    );
  } catch {
    return json(
      { ok: false, error: "사진이 너무 커요. 8MB 이하로 올려 주세요.", avatar_url: null },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "사진을 선택하세요.", avatar_url: null }, { status: 400 });
  }
  const fd = new FormData();
  fd.append("file", file, file.name || "avatar.jpg");
  try {
    const me = await api<Me>("/users/me/avatar", { method: "POST", token, multipart: fd });
    return json({ ok: true, error: null as string | null, avatar_url: me.avatar_url });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "사진을 올리지 못했어요.";
    return json({ ok: false, error: message, avatar_url: null }, { status: 400 });
  }
}
