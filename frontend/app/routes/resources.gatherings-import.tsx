import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";

// 엑셀 업로드 → 백엔드 /gatherings/import 로 멀티파트 전달.
export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 5_000_000 });
  let form: FormData;
  try {
    form = await unstable_parseMultipartFormData(request, uploadHandler);
  } catch {
    return json({ ok: false, error: "파일 크기가 너무 크거나 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "엑셀 파일을 선택하세요." }, { status: 400 });
  }

  const fd = new FormData();
  fd.append("file", file, file.name);

  try {
    const result = await api<{ created: number; failed: number; errors: { row: number; error: string }[] }>(
      "/gatherings/import",
      { method: "POST", token, multipart: fd },
    );
    return json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "업로드에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
