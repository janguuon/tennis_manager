import { createCookie } from "@remix-run/node";

export type Theme = "light" | "dark";

// 테마 설정 쿠키 (1년 유지)
export const themeCookie = createCookie("theme", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365,
});

export async function getTheme(request: Request): Promise<Theme> {
  const value = await themeCookie.parse(request.headers.get("Cookie"));
  return value === "dark" ? "dark" : "light";
}
