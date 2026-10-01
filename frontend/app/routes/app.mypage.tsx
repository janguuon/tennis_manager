import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { PageBody, PageHero } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "마이페이지 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const user = await api<User>("/users/me", { token });
  return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const get = (k: string) => {
    const v = formData.get(k);
    return v != null ? String(v) : undefined;
  };
  const ok = (message: string) => json({ intent, ok: true, message, error: null as string | null });
  const fail = (error: string) => json({ intent, ok: false, message: null as string | null, error });

  if (intent === "profile") {
    const body = {
      name: get("name"),
      nickname: get("nickname") || null,
      gender: get("gender") || null,
      ntrp: get("ntrp") ? Number(get("ntrp")) : null,
      phone: get("phone") || null,
      bio: get("bio") || null,
    };
    try {
      await api<User>("/users/me", { method: "PATCH", token, body });
      return ok("내 정보를 저장했습니다.");
    } catch (err) {
      return fail(err instanceof ApiError ? err.message : "저장에 실패했습니다.");
    }
  }

  if (intent === "password") {
    const newPassword = get("new_password") ?? "";
    const confirm = get("confirm_password") ?? "";
    if (newPassword.length < 4) {
      return fail("비밀번호는 4자 이상이어야 합니다.");
    }
    if (newPassword !== confirm) {
      return fail("새 비밀번호가 서로 일치하지 않습니다.");
    }
    try {
      await api("/users/me/password", { method: "PUT", token, body: { new_password: newPassword } });
      return ok("비밀번호를 변경했습니다.");
    } catch (err) {
      return fail(err instanceof ApiError ? err.message : "비밀번호 변경에 실패했습니다.");
    }
  }

  return fail("알 수 없는 요청입니다.");
}

export default function MyPage() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("intent") ?? "")
      : "";

  const profileMsg = actionData?.intent === "profile" ? actionData : undefined;
  const passwordMsg = actionData?.intent === "password" ? actionData : undefined;

  const msg = (m: typeof profileMsg) =>
    m?.ok ? <p className="alert-success">{m.message}</p> : m?.error ? <p className="alert-error">{m.error}</p> : null;

  return (
    <>
      <PageHero>
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ball-400 text-xl font-bold text-slate-900">
            {user.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="hero-title truncate">{user.name}</h1>
              <span className="badge-hero">{user.is_admin ? "관리자" : "회원"}</span>
            </div>
            <p className="hero-sub !mt-0.5 truncate">
              @{user.username}
              {user.email ? ` · ${user.email}` : ""} · {user.created_at.slice(0, 10)} 가입
            </p>
          </div>
        </div>
      </PageHero>

      <PageBody narrow>
        {/* 내 정보 수정 */}
        <section className="card">
          <h2 className="section-title">프로필</h2>
          <p className="mt-1 text-[13px] text-slate-500">대진 편성에 쓰이는 정보예요 (성별 · NTRP).</p>
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="profile" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="name">이름</label>
                <input id="name" name="name" className="input" required defaultValue={user.name} />
              </div>
              <div>
                <label className="label" htmlFor="nickname">닉네임</label>
                <input id="nickname" name="nickname" className="input" defaultValue={user.nickname ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="gender">성별</label>
                <select id="gender" name="gender" className="input" defaultValue={user.gender ?? ""}>
                  <option value="">선택 안 함</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ntrp">NTRP</label>
                <input
                  id="ntrp"
                  name="ntrp"
                  type="number"
                  step="0.5"
                  min="1"
                  max="7"
                  className="input"
                  placeholder="1.0 ~ 7.0"
                  defaultValue={user.ntrp ?? ""}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="phone">연락처</label>
              <input id="phone" name="phone" className="input" defaultValue={user.phone ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="bio">소개</label>
              <textarea id="bio" name="bio" rows={2} className="input" defaultValue={user.bio ?? ""} />
            </div>

            {msg(profileMsg)}

            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={submittingIntent === "profile"}>
                {submittingIntent === "profile" ? "저장 중…" : "저장"}
              </button>
            </div>
          </Form>
        </section>

        {/* 비밀번호 변경 */}
        <section className="card">
          <h2 className="section-title">비밀번호</h2>
          <p className="mt-1 text-[13px] text-slate-500">4자 이상으로 바꿀 수 있어요.</p>
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="password" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="new_password">새 비밀번호</label>
                <input id="new_password" name="new_password" type="password" className="input" required minLength={4} />
              </div>
              <div>
                <label className="label" htmlFor="confirm_password">새 비밀번호 확인</label>
                <input id="confirm_password" name="confirm_password" type="password" className="input" required minLength={4} />
              </div>
            </div>

            {msg(passwordMsg)}

            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={submittingIntent === "password"}>
                {submittingIntent === "password" ? "변경 중…" : "비밀번호 변경"}
              </button>
            </div>
          </Form>
        </section>
      </PageBody>
    </>
  );
}
