import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";

import { ApiError, api } from "~/lib/api.server";
import { createUserSession, getToken } from "~/lib/session.server";
import type { LoginResponse } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "로그인 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  if (await getToken(request)) throw redirect("/app");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "아이디와 비밀번호를 입력하세요." };
  }

  try {
    const res = await api<LoginResponse>("/auth/login", {
      method: "POST",
      form: new URLSearchParams({ username, password }),
    });
    return createUserSession(res.access_token, "/app");
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "로그인에 실패했습니다.";
    return { error: message };
  }
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-court-700">🎾 테니스 매니저</h1>
          <p className="mt-1 text-sm text-slate-500">테니스 팀 매니지먼트</p>
        </div>

        <Form method="post" className="card space-y-4">
          <div>
            <label className="label" htmlFor="username">아이디</label>
            <input id="username" name="username" className="input" autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="password">비밀번호</label>
            <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
          </div>

          {actionData?.error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
          ) : null}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </button>
        </Form>

        <p className="mt-4 text-center text-sm text-slate-500">
          아직 회원이 아니신가요?{" "}
          <Link to="/signup" className="font-semibold text-court-600 hover:underline">
            가입 신청
          </Link>
        </p>
      </div>
    </div>
  );
}
