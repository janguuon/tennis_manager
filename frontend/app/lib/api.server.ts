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
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { method = "GET", token, body, form } = options;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (form) {
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
