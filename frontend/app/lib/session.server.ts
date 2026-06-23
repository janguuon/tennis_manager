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

/** 토큰이 없으면 /login 으로 리다이렉트. */
export async function requireToken(request: Request): Promise<string> {
  const token = await getToken(request);
  if (!token) throw redirect("/login");
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

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}
