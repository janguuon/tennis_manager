import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { themeCookie } from "~/lib/theme.server";

// 테마 토글: 폼으로 받은 theme 값을 쿠키에 저장하고 원래 페이지로 돌아간다.
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const theme = form.get("theme") === "dark" ? "dark" : "light";
  const redirectTo = form.get("redirectTo")?.toString() || "/app";
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await themeCookie.serialize(theme) },
  });
}

export async function loader() {
  return redirect("/app");
}
