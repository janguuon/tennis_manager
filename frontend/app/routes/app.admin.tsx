import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "관리자 · 테니스 매니저" }];

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
    <div className="space-y-6">
      {/* 가입 신청 관리 */}
      <section className="space-y-3">
        <h1 className="text-lg font-bold sm:text-xl">🛠️ 가입 신청 관리</h1>

        {actionData?.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
        ) : null}

        {pending.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            대기 중인 가입 신청이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((u) => (
              <div key={u.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {u.name}
                    <span className="ml-2 text-xs text-slate-400">@{u.username}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {u.gender === "male" ? "남" : u.gender === "female" ? "여" : "-"}
                    {u.ntrp ? ` · NTRP ${u.ntrp}` : ""}
                    {u.email ? ` · ${u.email}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Form method="post">
                    <input type="hidden" name="user_id" value={u.id} />
                    <button name="intent" value="approve" className="btn-primary px-3 py-1.5 text-sm">
                      승인
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="user_id" value={u.id} />
                    <button name="intent" value="reject" className="btn-ghost px-3 py-1.5 text-sm text-red-500">
                      거절
                    </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 회원 비밀번호 초기화 */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold sm:text-xl">🔑 회원 비밀번호 초기화</h2>
        <p className="text-sm text-slate-500">
          비밀번호를 잊은 회원의 비밀번호를 새로 지정해 줍니다. 회원에게 새 비밀번호를 알려주고,
          로그인 후 마이페이지에서 직접 변경하도록 안내하세요.
        </p>

        {actionData?.ok && actionData.reset ? (
          <p className="rounded-md bg-court-50 px-3 py-2 text-sm text-court-700 dark:bg-court-900/30 dark:text-court-300">
            비밀번호를 초기화했습니다.
          </p>
        ) : null}

        <Form method="post" className="card space-y-3">
          <input type="hidden" name="intent" value="reset_password" />
          <div>
            <label className="label" htmlFor="user_id">회원</label>
            <select id="user_id" name="user_id" className="input" required defaultValue="">
              <option value="" disabled>회원 선택</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.nickname ? ` (@${m.nickname})` : ""} · @{m.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new_password">새 비밀번호 (4자 이상)</label>
            <input
              id="new_password"
              name="new_password"
              type="text"
              className="input"
              required
              minLength={4}
              placeholder="예: tennis123"
            />
          </div>
          <button type="submit" className="btn-primary">비밀번호 초기화</button>
        </Form>
      </section>
    </div>
  );
}
