import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getToken } from "~/lib/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await getToken(request);
  return redirect(token ? "/app" : "/login");
}
