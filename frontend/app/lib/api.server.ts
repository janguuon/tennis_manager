// FastAPI 백엔드 호출 래퍼 (서버 사이드 전용).
// 모든 백엔드 통신은 Remix 로더/액션에서 이 함수를 통해 이루어진다.

const API_BASE = process.env.API_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string | null;
  /** JSON 본문 */
  body?: unknown;
  /** x-www-form-urlencoded 본문 (OAuth2 로그인 등) */
  form?: URLSearchParams;
  /** multipart/form-data 본문 (파일 업로드). Content-Type은 자동 설정됨. */
  multipart?: FormData;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { method = "GET", token, body, form, multipart } = options;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (multipart) {
    // Content-Type은 fetch가 boundary와 함께 자동 설정 (직접 지정 금지)
    payload = multipart;
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    let message = res.statusText;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      // pydantic 검증 에러 배열
      message = detail
        .map((d: { msg?: string }) => d.msg ?? JSON.stringify(d))
        .join(", ");
    }
    throw new ApiError(res.status, message);
  }

  return data as T;
}

/** 바이너리 응답(예: 엑셀 다운로드)을 위해 원본 Response를 그대로 반환. */
export async function apiRaw(
  path: string,
  options: { token?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
  return res;
}
