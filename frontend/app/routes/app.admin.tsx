import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useOutletContext } from "@remix-run/react";
import { KeyRound, RotateCcw, Search, Trash2, UserCheck, UserMinus, UserX } from "lucide-react";
import { useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { PageBody, PageHeader } from "~/components/Page";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "관리자 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const [pending, members, inactive] = await Promise.all([
      api<User[]>("/admin/signups/pending", { token }),
      api<User[]>("/users", { token }),
      api<User[]>("/admin/users/inactive", { token }),
    ]);
    return json({ pending, members, inactive });
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
        return json(
          {
            ok: false,
            error: "비밀번호는 4자 이상이어야 합니다.",
            reset: false,
            notice: null as string | null,
          },
          { status: 400 }
        );
      }
      await api(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        token,
        body: { new_password: newPassword },
      });
      return json({ ok: true, error: null as string | null, reset: true, notice: null as string | null });
    }
    if (intent === "delete_member") {
      const res = await api<{ result: "deleted" | "deactivated"; name: string }>(`/admin/users/${userId}`, {
        method: "DELETE",
        token,
      });
      const notice =
        res.result === "deleted"
          ? `${res.name}님을 삭제했어요.`
          : `${res.name}님은 경기·입금 기록이 있어 기록을 남기고 탈퇴 처리했어요. 아래 '탈퇴한 회원'에서 복구할 수 있어요.`;
      return json({ ok: true, error: null as string | null, reset: false, notice });
    }
    if (intent === "restore_member") {
      const user = await api<User>(`/admin/users/${userId}/restore`, { method: "POST", token });
      return json({ ok: true, error: null as string | null, reset: false, notice: `${user.name}님을 복구했어요.` });
    }
    // approve / reject
    await api(`/admin/signups/${userId}/${intent}`, { method: "POST", token });
    return json({ ok: true, error: null as string | null, reset: false, notice: null as string | null });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message, reset: false, notice: null as string | null }, { status: 400 });
  }
}

export default function AdminPage() {
  const { pending, members, inactive } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { user: me } = useOutletContext<{ user: User }>();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // 나 자신은 삭제할 수 없으므로 목록에서 뺀다
  const deletable = members
    .filter((m) => m.id !== me.id)
    .filter((m) => !q || [m.name, m.username, m.nickname ?? ""].some((v) => v.toLowerCase().includes(q)));

  return (
    <PageBody>
      <PageHeader
        eyebrow="TAKE CARE OF OUR CLUB."
        title="우리 클럽 관리"
        sub={
          pending.length > 0
            ? `가입 신청 ${pending.length}건이 승인을 기다려요`
            : "가입 승인, 회원 삭제와 계정을 관리해요"
        }
      />

      {actionData?.error ? (
        <p className="alert-error">{actionData.error}</p>
      ) : null}

      {/* 가입 신청 */}
      <section className="card">
        <div className="flex items-center gap-2">
          <h2 className="tile-title">가입 신청</h2>
          {pending.length > 0 ? (
            <span className="chip-ink">{pending.length}</span>
          ) : null}
        </div>

        {pending.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm font-bold">
            <UserCheck size={16} />
            대기 중인 가입 신청이 없어요.
          </p>
        ) : (
          <ul className="record-rows mt-4">
            {pending.map((u) => (
              <li key={u.id}>
                <div className="min-w-0">
                  <p className="truncate font-extrabold">
                    {u.name}
                    <span className="ml-2 text-xs font-semibold opacity-70">
                      @{u.username}
                    </span>
                  </p>
                  <p className="truncate text-[13px] font-medium">
                    {u.gender === "male"
                      ? "남"
                      : u.gender === "female"
                      ? "여"
                      : "성별 미입력"}
                    {u.ntrp ? ` · NTRP ${u.ntrp}` : ""}
                    {u.email ? ` · ${u.email}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Form method="post">
                    <input type="hidden" name="user_id" value={u.id} />
                    <button
                      name="intent"
                      value="reject"
                      className="btn-ghost btn-sm"
                    >
                      거절
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="user_id" value={u.id} />
                    <button
                      name="intent"
                      value="approve"
                      className="btn-primary btn-sm"
                    >
                      승인
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 회원 삭제 */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="section-title flex items-center gap-2">
              <UserMinus size={16} className="text-slate-400" />
              회원 삭제
            </h2>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              경기·입금 기록이 없는 회원은 완전히 삭제돼요. 기록이 있는 회원은 다른 회원의 전적과 정산이 깨지지
              않도록 기록을 남기고 탈퇴 처리돼요(로그인 불가, 회원 목록·랭킹에서 빠짐).
            </p>
          </div>
          <label className="relative w-full sm:w-56">
            <span className="sr-only">회원 검색</span>
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input !py-2 !pl-9"
              placeholder="이름·아이디 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {actionData?.notice ? <p className="alert-success mt-4">{actionData.notice}</p> : null}

        {deletable.length === 0 ? (
          <p className="mt-4 text-sm font-medium text-slate-500">
            {q ? "검색한 회원이 없어요." : "삭제할 수 있는 회원이 없어요."}
          </p>
        ) : (
          <ul className="record-rows mt-3">
            {deletable.map((m) => (
              <li key={m.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <MemberAvatar user={m} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-bold">
                      {m.name}
                      <span className="text-xs font-medium text-slate-400">@{m.username}</span>
                      {m.is_admin ? <span className="badge-gray">관리자</span> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {m.created_at.slice(0, 10)} 가입
                      {m.ntrp ? ` · NTRP ${m.ntrp}` : ""}
                    </p>
                  </div>
                </div>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `${m.name}님을 삭제할까요?\n\n경기·입금 기록이 있으면 기록은 남기고 탈퇴 처리돼요. 탈퇴 처리한 회원은 나중에 복구할 수 있어요.`
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="delete_member" />
                  <input type="hidden" name="user_id" value={m.id} />
                  <button className="btn-danger btn-sm">
                    <Trash2 size={14} />
                    삭제
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 탈퇴한 회원 */}
      {inactive.length > 0 ? (
        <section className="card">
          <h2 className="section-title flex items-center gap-2">
            <UserX size={16} className="text-slate-400" />
            탈퇴한 회원
            <span className="badge-gray">{inactive.length}</span>
          </h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500">
            로그인할 수 없고 회원 목록·랭킹에서 빠져 있어요. 지난 경기·정산 기록은 그대로 남아 있어요.
          </p>
          <ul className="record-rows mt-3">
            {inactive.map((m) => (
              <li key={m.id}>
                <div className="flex min-w-0 items-center gap-3 opacity-70">
                  <MemberAvatar user={m} className="grayscale" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-bold">
                      {m.name}
                      <span className="text-xs font-medium text-slate-400">@{m.username}</span>
                    </p>
                    <p className="text-xs text-slate-500">{m.created_at.slice(0, 10)} 가입</p>
                  </div>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="restore_member" />
                  <input type="hidden" name="user_id" value={m.id} />
                  <button className="btn-ghost btn-sm">
                    <RotateCcw size={14} />
                    복구
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 회원 비밀번호 초기화 */}
      <section className="card">
        <h2 className="section-title flex items-center gap-2">
          <KeyRound size={16} className="text-slate-400" />
          비밀번호 초기화
        </h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          비밀번호를 잊은 회원에게 새 비밀번호를 정해 주세요. 로그인 후
          마이페이지에서 직접 바꾸도록 안내하면 돼요.
        </p>

        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="reset_password" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="user_id">
                회원
              </label>
              <select
                id="user_id"
                name="user_id"
                className="input"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  회원 선택
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.nickname ? ` (${m.nickname})` : ""} · @{m.username}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="new_password">
                새 비밀번호
              </label>
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

          {actionData?.ok && actionData.reset ? (
            <p className="alert-success">비밀번호를 초기화했어요.</p>
          ) : null}

          <div className="flex justify-end">
            <button type="submit" className="btn-primary">
              초기화
            </button>
          </div>
        </Form>
      </section>
    </PageBody>
  );
}
