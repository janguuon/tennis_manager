import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { Check } from "lucide-react";

import { Logo } from "~/components/Logo";
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
    return { message: res.message, error: null as string | null };
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "가입 신청에 실패했습니다.";
    return { message: null as string | null, error: msg };
  }
}

export default function SignupPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen">
      <div className="bg-slate-900 px-4 pb-28 pt-16 text-center text-white dark:border-b dark:border-slate-800 sm:pt-24">
        <div className="flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="mt-4 text-[28px] font-bold tracking-tight">가입 신청</h1>
        <p className="mt-1.5 text-sm text-white/60">관리자가 승인하면 로그인할 수 있어요.</p>
      </div>
      <div className="mx-auto -mt-16 w-full max-w-md animate-fade-in px-4 pb-10 motion-reduce:animate-none">
        {actionData?.message ? (
          <div className="card flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ball-400 text-slate-900">
              <Check size={28} strokeWidth={2.5} />
            </span>
            <p className="text-sm text-slate-700 dark:text-slate-300">{actionData.message}</p>
            <Link to="/login" className="btn-primary">로그인 화면으로</Link>
          </div>
        ) : (
          <Form method="post" className="card space-y-4 sm:!p-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="username">아이디</label>
                <input id="username" name="username" className="input" required minLength={3} placeholder="영문/숫자 3자 이상" />
              </div>
              <div>
                <label className="label" htmlFor="name">이름</label>
                <input id="name" name="name" className="input" required />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">비밀번호</label>
              <input id="password" name="password" type="password" className="input" required minLength={4} placeholder="4자 이상" />
            </div>

            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="mb-3 text-xs font-semibold text-slate-400">선택 정보</p>
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
                <div>
                  <label className="label" htmlFor="ntrp">NTRP</label>
                  <input id="ntrp" name="ntrp" type="number" step="0.5" min="1" max="7" className="input" placeholder="1.0 ~ 7.0" />
                </div>
                <div>
                  <label className="label" htmlFor="email">이메일</label>
                  <input id="email" name="email" type="email" className="input" />
                </div>
              </div>
            </div>

            {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

            <button type="submit" className="btn-primary h-11 w-full" disabled={submitting}>
              {submitting ? "신청 중…" : "가입 신청"}
            </button>
          </Form>
        )}

        <p className="mt-5 text-center text-sm text-slate-500">
          이미 회원이신가요?{" "}
          <Link to="/login" className="font-semibold text-slate-900 underline-offset-4 hover:underline dark:text-white">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
