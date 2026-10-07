import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { KeyRound, UserCheck } from "lucide-react";

import { PageBody, PageHeader } from "~/components/Page";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "관리자 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const [pending, members] = await Promise.all([
      api<User[]>("/admin/signups/pending", { token }),
      api<User[]>("/users", { token }),
    ]);
    return json({ pending, members });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw redirect("/app");
    throw err;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const userId = formData.get("user_id");

  try {
    if (intent === "reset_password") {
      const newPassword = String(formData.get("new_password") ?? "");
      if (newPassword.length < 4) {
        return json({ ok: false, error: "비밀번호는 4자 이상이어야 합니다.", reset: false }, { status: 400 });
      }
      await api(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        token,
        body: { new_password: newPassword },
      });
      return json({ ok: true, error: null as string | null, reset: true });
    }
    // approve / reject
    await api(`/admin/signups/${userId}/${intent}`, { method: "POST", token });
    return json({ ok: true, error: null as string | null, reset: false });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message, reset: false }, { status: 400 });
  }
}

export default function AdminPage() {
  const { pending, members } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <PageBody>
      <PageHeader
        title="관리자"
        sub={pending.length > 0 ? `가입 신청 ${pending.length}건이 승인을 기다려요` : "가입 승인과 회원 계정을 관리해요"}
      />

        {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

        {/* 가입 신청 */}
        <section className="tile-orange">
          <div className="flex items-center gap-2">
            <h2 className="tile-title">가입 신청</h2>
            {pending.length > 0 ? <span className="chip-ink">{pending.length}</span> : null}
          </div>

          {pending.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-bold">
              <UserCheck size={16} />
              대기 중인 가입 신청이 없어요.
            </p>
          ) : (
            <ul className="tile-rows mt-2">
              {pending.map((u) => (
                <li key={u.id}>
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">
                      {u.name}
                      <span className="ml-2 text-xs font-semibold opacity-70">@{u.username}</span>
                    </p>
                    <p className="truncate text-[13px] font-medium">
                      {u.gender === "male" ? "남" : u.gender === "female" ? "여" : "성별 미입력"}
                      {u.ntrp ? ` · NTRP ${u.ntrp}` : ""}
                      {u.email ? ` · ${u.email}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Form method="post">
                      <input type="hidden" name="user_id" value={u.id} />
                      <button name="intent" value="reject" className="btn-line btn-sm">
                        거절
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="user_id" value={u.id} />
                      <button name="intent" value="approve" className="btn-ink btn-sm">
                        승인
                      </button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 회원 비밀번호 초기화 */}
        <section className="card">
          <h2 className="section-title flex items-center gap-2">
            <KeyRound size={16} className="text-slate-400" />
            비밀번호 초기화
          </h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500">
            비밀번호를 잊은 회원에게 새 비밀번호를 정해 주세요. 로그인 후 마이페이지에서 직접 바꾸도록 안내하면 돼요.
          </p>

          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="reset_password" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="user_id">회원</label>
                <select id="user_id" name="user_id" className="input" required defaultValue="">
                  <option value="" disabled>회원 선택</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.nickname ? ` (${m.nickname})` : ""} · @{m.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="new_password">새 비밀번호</label>
                <input
                  id="new_password"
                  name="new_password"
                  type="text"
                  className="input"
                  required
                  minLength={4}
                  placeholder="4자 이상"
                />
              </div>
            </div>

            {actionData?.ok && actionData.reset ? <p className="alert-success">비밀번호를 초기화했어요.</p> : null}

            <div className="flex justify-end">
              <button type="submit" className="btn-primary">초기화</button>
            </div>
          </Form>
        </section>
    </PageBody>
  );
}
