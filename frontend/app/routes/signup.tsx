import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { Check } from "lucide-react";

import { AuthLayout } from "~/components/AuthLayout";
import { ApiError, api } from "~/lib/api.server";
import { getToken } from "~/lib/session.server";
import type { SignupResponse } from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "가입 신청 · 오테식 매니저" },
];

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
    const res = await api<SignupResponse>("/auth/signup", {
      method: "POST",
      body,
    });
    return { message: res.message, error: null as string | null };
  } catch (err) {
    const msg =
      err instanceof ApiError ? err.message : "가입 신청에 실패했습니다.";
    return { message: null as string | null, error: msg };
  }
}

export default function SignupPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <AuthLayout>
      {actionData?.message ? (
        <div className="card flex flex-col items-center gap-4 py-10 text-center">
          <span className="avatar h-16 w-16 bg-house-yellow text-ink">
            <Check size={30} strokeWidth={3} />
          </span>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {actionData.message}
          </p>
          <Link to="/login" className="btn-primary">
            로그인 화면으로
          </Link>
        </div>
      ) : (
        <Form method="post" className="card space-y-4 sm:!p-8">
          <div>
            <p className="eyebrow mb-3 text-slate-500">JOIN OUR CLUBHOUSE</p>
            <h1 className="page-title">
              새로운 식구를 기다려요<span className="text-house-blue">.</span>
            </h1>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              관리자가 승인하면 로그인할 수 있어요.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="username">
                아이디
              </label>
              <input
                id="username"
                name="username"
                className="input"
                required
                minLength={3}
                placeholder="영문/숫자 3자 이상"
              />
            </div>
            <div>
              <label className="label" htmlFor="name">
                이름
              </label>
              <input id="name" name="name" className="input" required />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              required
              minLength={4}
              placeholder="4자 이상"
            />
          </div>

          <div className="border-t-[1.5px] border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-3 text-xs font-bold text-slate-500">선택 정보</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="nickname">
                  닉네임
                </label>
                <input id="nickname" name="nickname" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="gender">
                  성별
                </label>
                <select id="gender" name="gender" className="input">
                  <option value="">선택 안 함</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ntrp">
                  NTRP
                </label>
                <input
                  id="ntrp"
                  name="ntrp"
                  type="number"
                  step="0.5"
                  min="1"
                  max="7"
                  className="input"
                  placeholder="1.0 ~ 7.0"
                />
              </div>
              <div>
                <label className="label" htmlFor="email">
                  이메일
                </label>
                <input id="email" name="email" type="email" className="input" />
              </div>
            </div>
          </div>

          {actionData?.error ? (
            <p className="alert-error">{actionData.error}</p>
          ) : null}

          <button
            type="submit"
            className="btn-primary h-12 w-full text-[15px]"
            disabled={submitting}
          >
            {submitting ? "신청 중…" : "가입 신청"}
          </button>
        </Form>
      )}

      <p className="mt-5 text-center text-sm font-medium text-slate-500">
        이미 회원이신가요?{" "}
        <Link
          to="/login"
          className="font-extrabold text-ink underline decoration-2 underline-offset-4 dark:text-white"
        >
          로그인
        </Link>
      </p>
    </AuthLayout>
  );
}
