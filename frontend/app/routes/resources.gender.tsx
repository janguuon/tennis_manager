import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { Me } from "~/lib/types";

// 로그인 후 성별 묻기 창에서 고른 성별 저장 → 백엔드로 전달
export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const gender = String((await request.formData()).get("gender") ?? "");
  if (gender !== "male" && gender !== "female") {
    return json({ ok: false, error: "성별을 골라 주세요." }, { status: 400 });
  }
  try {
    await api<Me>("/users/me", { method: "PATCH", token, body: { gender } });
    return json({ ok: true, error: null as string | null });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "저장하지 못했어요.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
