import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";

import { ApiError, api } from "~/lib/api.server";
import { getToken } from "~/lib/session.server";
import type { SignupResponse } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "가입 신청 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  if (await getToken(request)) throw redirect("/app");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const get = (k: string) => {
    const v = formData.get(k);
    return v ? String(v) : undefined;
  };

  const body = {
    username: get("username"),
    password: get("password"),
    name: get("name"),
    nickname: get("nickname"),
    gender: get("gender") || null,
    ntrp: get("ntrp") ? Number(get("ntrp")) : null,
    email: get("email") || null,
  };

  try {
    const res = await api<SignupResponse>("/auth/signup", { method: "POST", body });
    return { message: res.message };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "가입 신청에 실패했습니다.";
    return { error: message };
  }
}

export default function SignupPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-court-700">🎾 가입 신청</h1>
          <p className="mt-1 text-sm text-slate-500">관리자 승인 후 로그인할 수 있어요.</p>
        </div>

        {actionData?.message ? (
          <div className="card text-center">
            <p className="text-sm text-slate-700">{actionData.message}</p>
            <Link to="/login" className="btn-primary mt-4 inline-flex">로그인 화면으로</Link>
          </div>
        ) : (
          <Form method="post" className="card space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="username">아이디 *</label>
                <input id="username" name="username" className="input" required minLength={3} placeholder="영문/숫자" />
              </div>
              <div>
                <label className="label" htmlFor="name">이름 *</label>
                <input id="name" name="name" className="input" required />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">비밀번호 * (8자 이상)</label>
              <input id="password" name="password" type="password" className="input" required minLength={8} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="nickname">닉네임</label>
                <input id="nickname" name="nickname" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="gender">성별</label>
                <select id="gender" name="gender" className="input">
                  <option value="">선택 안 함</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ntrp">NTRP (1.0~7.0)</label>
                <input id="ntrp" name="ntrp" type="number" step="0.5" min="1" max="7" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="email">이메일 (선택)</label>
                <input id="email" name="email" type="email" className="input" />
              </div>
            </div>

            {actionData?.error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? "신청 중…" : "가입 신청"}
            </button>
          </Form>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          이미 회원이신가요?{" "}
          <Link to="/login" className="font-semibold text-court-600 hover:underline">로그인</Link>
        </p>
      </div>
    </div>
  );
}
