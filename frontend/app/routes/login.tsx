import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "@remix-run/react";

import { Logo } from "~/components/Logo";
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
    <div className="min-h-screen">
      <div className="bg-slate-900 px-4 pb-28 pt-16 text-center text-white dark:border-b dark:border-slate-800 sm:pt-24">
        <div className="flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="mt-4 text-[28px] font-bold tracking-tight">오테식 매니저</h1>
        <p className="mt-1.5 text-sm text-white/60">오순도순 테니스 식구의 일정 · 전적 · 회비</p>
      </div>
      <div className="mx-auto -mt-16 w-full max-w-sm animate-fade-in px-4 pb-10 motion-reduce:animate-none">
        <Form method="post" className="card space-y-4 sm:!p-6">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div>
            <label className="label" htmlFor="username">아이디</label>
            <input id="username" name="username" className="input" autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="password">비밀번호</label>
            <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
          </div>

          {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

          <button type="submit" className="btn-primary h-11 w-full" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </button>
        </Form>

        <p className="mt-5 text-center text-sm text-slate-500">
          아직 회원이 아니신가요?{" "}
          <Link to="/signup" className="font-semibold text-slate-900 underline-offset-4 hover:underline dark:text-white">
            가입 신청
          </Link>
        </p>
      </div>
    </div>
  );
}
