import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "@remix-run/react";

import { AuthLayout } from "~/components/AuthLayout";
import { ApiError, api } from "~/lib/api.server";
import { createUserSession, getToken, safeRedirect } from "~/lib/session.server";
import type { LoginResponse } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "로그인 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  // 이미 로그인 상태면 원래 가려던 페이지(없으면 /app)로
  if (await getToken(request)) {
    const redirectTo = new URL(request.url).searchParams.get("redirectTo");
    throw redirect(safeRedirect(redirectTo));
  }
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirect(formData.get("redirectTo"));

  if (!username || !password) {
    return { error: "아이디와 비밀번호를 입력하세요." };
  }

  try {
    const res = await api<LoginResponse>("/auth/login", {
      method: "POST",
      form: new URLSearchParams({ username, password }),
    });
    return createUserSession(res.access_token, redirectTo);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "로그인에 실패했습니다.";
    return { error: message };
  }
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "";

  return (
    <AuthLayout>
      <Form method="post" className="card space-y-4 sm:!p-8">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.05em]">로그인</h1>
        <div>
          <label className="label" htmlFor="username">아이디</label>
          <input id="username" name="username" className="input" autoComplete="username" required />
        </div>
        <div>
          <label className="label" htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>

        {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

        <button type="submit" className="btn-primary h-12 w-full text-[15px]" disabled={submitting}>
          {submitting ? "로그인 중…" : "로그인"}
        </button>
      </Form>

      <p className="mt-5 text-center text-sm font-medium text-slate-500">
        아직 회원이 아니신가요?{" "}
        <Link to="/signup" className="font-extrabold text-ink underline decoration-2 underline-offset-4 dark:text-white">
          가입 신청
        </Link>
      </p>
    </AuthLayout>
  );
}
