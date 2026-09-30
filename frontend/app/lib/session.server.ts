import { createCookieSessionStorage, redirect } from "@remix-run/node";

const sessionSecret = process.env.SESSION_SECRET ?? "dev-secret-change-me";

const storage = createCookieSessionStorage({
  cookie: {
    name: "tb_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7일
  },
});

export async function getSession(request: Request) {
  return storage.getSession(request.headers.get("Cookie"));
}

/** 토큰을 반환 (없으면 null). */
export async function getToken(request: Request): Promise<string | null> {
  const session = await getSession(request);
  return session.get("token") ?? null;
}

/**
 * 로그인 후 돌아갈 경로로 쓸 수 있는 값인지 검사한다.
 * 같은 사이트 내부 경로("/...")만 허용해 외부 사이트로 튕기는 오픈 리다이렉트를 막는다.
 */
export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  fallback = "/app",
): string {
  if (!to || typeof to !== "string") return fallback;
  if (!to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) return fallback;
  return to;
}

/**
 * 지금 보던 페이지 경로(로그인 후 복귀용). 없거나 쓸 수 없으면 null.
 * - GET: 요청 URL. 폼 전송(POST 등): 폼이 있던 페이지(Referer).
 * - Remix 내부 쿼리(_routes, index)와 리소스 라우트는 제외.
 */
export function getReturnPath(request: Request): string | null {
  let url: URL;
  if (request.method === "GET") {
    url = new URL(request.url);
  } else {
    const referer = request.headers.get("Referer");
    if (!referer) return null;
    url = new URL(referer);
    if (url.host !== new URL(request.url).host) return null;
  }
  url.searchParams.delete("_routes");
  url.searchParams.delete("index");
  if (url.pathname === "/" || url.pathname.startsWith("/resources/")) return null;
  return url.pathname + url.search;
}

function loginUrl(returnPath: string | null): string {
  return returnPath ? `/login?${new URLSearchParams({ redirectTo: returnPath })}` : "/login";
}

/** 토큰이 없으면 /login 으로 리다이렉트(보던 페이지를 redirectTo로 기억). */
export async function requireToken(request: Request): Promise<string> {
  const token = await getToken(request);
  if (!token) throw redirect(loginUrl(getReturnPath(request)));
  return token;
}

/** 로그인 성공 시 토큰을 세션에 저장하고 이동. */
export async function createUserSession(token: string, redirectTo: string) {
  const session = await storage.getSession();
  session.set("token", token);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/** 세션을 지우고 /login 으로. returnPath를 주면 다시 로그인한 뒤 그 페이지로 돌아간다. */
export async function logout(request: Request, returnPath: string | null = null) {
  const session = await getSession(request);
  return redirect(loginUrl(returnPath), {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}
