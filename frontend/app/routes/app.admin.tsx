import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useOutletContext } from "@remix-run/react";
import {
  ArrowUpRight,
  BarChart3,
  KeyRound,
  Landmark,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
  UserMinus,
  UserX,
} from "lucide-react";
import { useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { PageBody, PageHeader } from "~/components/Page";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import { MEMBER_TYPE_LABEL, withRo } from "~/lib/status";
import type { ClubAccount, MemberType, User } from "~/lib/types";

const MEMBER_TYPES: MemberType[] = ["treasurer", "officer", "member", "guest"];

/** 탈퇴 회원을 완전히 지울 때 함께 지워지는 것 (서버 PurgePreview) */
type PurgePreview = {
  user_id: number;
  name: string;
  matches: number;
  participations: number;
  paid: number;
  court_bookings: number;
  gatherings_created: number;
  draw_seats: number;
};

function purgeSummary(p: PurgePreview) {
  const parts = [
    p.matches ? `경기 기록 ${p.matches}건` : "",
    p.participations ? `참석 기록 ${p.participations}건${p.paid ? `(입금 ${p.paid})` : ""}` : "",
    p.court_bookings ? `코트비 지급 내역 ${p.court_bookings}건` : "",
    p.draw_seats ? `대진표 자리 ${p.draw_seats}곳(빈자리로)` : "",
    p.gatherings_created ? `만든 모임 ${p.gatherings_created}개(관리자에게 넘어감)` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "남은 기록 없음";
}

export const meta: MetaFunction = () => [{ title: "관리자 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const [pending, members, inactive, purgePreview, clubAccount] = await Promise.all([
      api<User[]>("/admin/signups/pending", { token }),
      api<User[]>("/users", { token }),
      api<User[]>("/admin/users/inactive", { token }),
      api<PurgePreview[]>("/admin/users/inactive/purge-preview", { token }),
      api<ClubAccount | null>("/club/account", { token }),
    ]);
    return json({ pending, members, inactive, purgePreview, clubAccount });
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
    if (intent === "club_account") {
      const res = await api<{ account: ClubAccount | null; updated: number }>("/club/account", {
        method: "PUT",
        token,
        body: {
          bank: String(formData.get("bank") ?? ""),
          account_number: String(formData.get("account_number") ?? ""),
          account_holder: String(formData.get("account_holder") ?? ""),
          apply_upcoming: formData.get("apply_upcoming") === "on",
        },
      });
      return json({
        ok: true,
        error: null as string | null,
        reset: false,
        notice: null as string | null,
        accountNotice: `모임 통장을 저장했어요.${
          res.updated ? ` 다가오는 오테식 모임 ${res.updated}개에도 넣었어요.` : ""
        }`,
      });
    }
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
          : `${res.name}님은 경기·입금 기록이 있어 기록을 남기고 탈퇴 처리했어요. ${res.name}님이 뛴 경기는 전적·랭킹·티어 계산에서 빠져요. 아래 '탈퇴한 회원'에서 복구할 수 있어요.`;
      return json({ ok: true, error: null as string | null, reset: false, notice });
    }
    if (intent === "set_type") {
      const type = String(formData.get("member_type")) as MemberType;
      const user = await api<User>(`/admin/users/${userId}/member-type`, {
        method: "PUT",
        token,
        body: { member_type: type },
      });
      return json({
        ok: true,
        error: null as string | null,
        reset: false,
        notice: `${user.name}님을 ${withRo(MEMBER_TYPE_LABEL[user.member_type])} 바꿨어요.`,
      });
    }
    if (intent === "approve") {
      const type = String(formData.get("member_type") || "member") as MemberType;
      const user = await api<User>(`/admin/signups/${userId}/approve?member_type=${type}`, { method: "POST", token });
      return json({
        ok: true,
        error: null as string | null,
        reset: false,
        notice: `${user.name}님을 ${withRo(MEMBER_TYPE_LABEL[user.member_type])} 승인했어요.`,
      });
    }
    if (intent === "purge_member" || intent === "purge_all") {
      const res = await api<{ purged: { name: string }[] }>(
        intent === "purge_all" ? "/admin/users/inactive/purge" : `/admin/users/${userId}/purge`,
        { method: "DELETE", token }
      );
      const names = res.purged.map((p) => p.name).join(", ");
      return json({
        ok: true,
        error: null as string | null,
        reset: false,
        notice: res.purged.length ? `${names}님의 정보와 기록을 완전히 지웠어요.` : "지울 탈퇴 회원이 없어요.",
      });
    }
    if (intent === "restore_member") {
      const user = await api<User>(`/admin/users/${userId}/restore`, { method: "POST", token });
      return json({ ok: true, error: null as string | null, reset: false, notice: `${user.name}님을 복구했어요.` });
    }
    // reject
    await api(`/admin/signups/${userId}/${intent}`, { method: "POST", token });
    return json({ ok: true, error: null as string | null, reset: false, notice: null as string | null });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message, reset: false, notice: null as string | null }, { status: 400 });
  }
}

export default function AdminPage() {
  const { pending, members, inactive, purgePreview, clubAccount } = useLoaderData<typeof loader>();
  const previewOf = new Map(purgePreview.map((p) => [p.user_id, p]));
  const actionData = useActionData<typeof action>();
  const accountNotice =
    actionData && "accountNotice" in actionData ? String(actionData.accountNotice ?? "") : "";
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
            : "가입 승인, 회원 구분·삭제와 계정을 관리해요"
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

        <p className="mt-1 text-[13px] font-medium text-slate-500">
          체험으로 오는 분은 게스트로 승인하고, 임원진 투표 후 아래 회원 관리에서 정회원으로 바꿔 주세요.
        </p>
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
                    <input type="hidden" name="member_type" value="guest" />
                    <button name="intent" value="approve" className="btn-ghost btn-sm">
                      게스트로 승인
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="user_id" value={u.id} />
                    <input type="hidden" name="member_type" value="member" />
                    <button name="intent" value="approve" className="btn-primary btn-sm">
                      정회원 승인
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 모임 통장 */}
      <section className="card">
        <div className="flex items-center gap-2">
          <Landmark size={18} />
          <h2 className="tile-title">모임 통장</h2>
        </div>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          오테식 정모·벙개의 게스트비를 받는 계좌예요. 오테식 모임을 등록할 때 계좌를 비워 두면 자동으로 들어가고, 회원들은 모임 화면과
          회비 정산에서 계좌를 복사해 쓸 수 있어요.
        </p>
        {clubAccount ? (
          <div className="club-account mt-4">
            <span className="min-w-0 text-[13px]">
              <span className="block text-xs font-bold">
                {[clubAccount.bank, clubAccount.account_holder].filter(Boolean).join(" · ") || "모임 통장"}
              </span>
              <span className="break-all font-extrabold tabular-nums">{clubAccount.account_number}</span>
            </span>
            <CopyButton text={clubAccount.account_number} label="계좌 복사" tone="ink" className="!h-7" />
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-house-yellow/30 px-4 py-3 text-[13px] font-semibold">
            아직 모임 통장을 정하지 않았어요. 지금은 가장 최근 오테식 모임의 계좌를 써요.
          </p>
        )}
        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="club_account" />
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="ca_bank">
                은행
              </label>
              <input
                id="ca_bank"
                name="bank"
                className="input"
                placeholder="카카오뱅크"
                defaultValue={clubAccount?.bank ?? ""}
              />
            </div>
            <div className="col-span-3">
              <label className="label" htmlFor="ca_number">
                계좌번호
              </label>
              <input
                id="ca_number"
                name="account_number"
                className="input"
                required
                placeholder="숫자만 또는 - 포함"
                defaultValue={clubAccount?.account_number ?? ""}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ca_holder">
              예금주
            </label>
            <input
              id="ca_holder"
              name="account_holder"
              className="input"
              defaultValue={clubAccount?.account_holder ?? ""}
            />
          </div>
          <label className="flex items-start gap-2 text-[13px] font-medium">
            <input type="checkbox" name="apply_upcoming" defaultChecked className="mt-0.5 h-4 w-4 accent-ink" />
            다가오는 오테식 모임(오늘 이후, 취소 제외)의 계좌도 이 계좌로 바꾸기
          </label>
          <button type="submit" className="btn-primary h-11 w-full sm:w-auto sm:px-6">
            모임 통장 저장
          </button>
          {accountNotice ? <p className="alert-success">{accountNotice}</p> : null}
        </Form>
      </section>

      {/* 내부 티어 */}
      <Link to="/app/admin/tiers" className="card-link flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <BarChart3 size={16} className="text-slate-400" />
            내부 티어
          </h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500">
            오테식 모임 대진 결과로 매긴 A~E 티어와 경기별 레이팅 변화를 봐요. 관리자만 볼 수 있어요.
          </p>
        </div>
        <ArrowUpRight size={18} className="shrink-0" />
      </Link>

      {/* 회원 삭제 */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="section-title flex items-center gap-2">
              <UserMinus size={16} className="text-slate-400" />
              회원 관리
            </h2>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              <b className="font-bold text-ink dark:text-white">구분</b>에 따라 일정이 보이는 때가 달라요: 총무·임원진은 등록
              즉시, 정회원·게스트는 금요일 오전 10시에 다음 주(월~일) 일정을 봐요(운영진이 캘린더·모임 화면에서 미리 공개할 수 있어요). 정회원은 바로, 게스트는 모임 3일 전 0시부터 투표할 수 있어요.
            </p>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              <b className="font-bold text-ink dark:text-white">권한</b>: 임원진은 오테식 정모·벙개를 만들고 운영해요(대진·결과 입력).
              <b className="font-bold text-ink dark:text-white"> 총무</b>는 임원진 권한에 더해 <b className="font-bold text-ink dark:text-white">정산</b>(입금 확인, 코트비
              지급·지급 내역, 예약자 계좌 보기)을 해요. 정산은 관리자와 총무만 할 수 있어요(일반 벙개 입금 확인은 만든 사람도 가능).
              게스트는 오테식 모임에 참석하면 게스트비를 내요.
            </p>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              <b className="font-bold text-ink dark:text-white">삭제</b>: 경기·입금 기록이 없는 회원은 완전히 삭제돼요. 기록이 있는 회원은 정산이 깨지지 않고 나중에 복구할
              수 있도록 기록을 남기고 탈퇴 처리돼요(로그인 불가, 회원 목록·랭킹에서 빠짐). 탈퇴한 회원이 뛴 경기는 다른 회원의 전적·랭킹·티어에서도
              빠지고, 복구하면 다시 반영돼요.
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
            {q ? "검색한 회원이 없어요." : "관리할 회원이 없어요."}
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
                      {m.ntrp ? ` · NTRP ${m.ntrp}` : ""} ·{" "}
                      {/* 전화번호는 프로필에서 등록한다 (회원 목록에서 눌러 바로 전화) */}
                      <Link
                        to={`/app/members/${m.id}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {m.phone ?? "전화번호 등록"}
                      </Link>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                <Form method="post">
                  <input type="hidden" name="intent" value="set_type" />
                  <input type="hidden" name="user_id" value={m.id} />
                  <label className="sr-only" htmlFor={`type-${m.id}`}>
                    {m.name} 회원 구분
                  </label>
                  <select
                    id={`type-${m.id}`}
                    name="member_type"
                    defaultValue={m.member_type}
                    className="input !h-8 !w-auto !rounded-full !py-0 !pl-3 !pr-8 text-[13px] font-bold"
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  >
                    {MEMBER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {MEMBER_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Form>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `${m.name}님을 삭제할까요?\n\n경기·입금 기록이 있으면 기록은 남기고 탈퇴 처리돼요. 이 회원과 함께했거나 맞선 경기는 모두의 전적·랭킹·티어에서 빠져요.\n탈퇴 처리한 회원은 나중에 복구할 수 있어요.`
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 탈퇴한 회원 */}
      {inactive.length > 0 ? (
        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="section-title flex items-center gap-2">
              <UserX size={16} className="text-slate-400" />
              탈퇴한 회원
              <span className="badge-gray">{inactive.length}</span>
            </h2>
            <Form
              method="post"
              onSubmit={(e) => {
                if (
                  !confirm(
                    `탈퇴한 회원 ${inactive.length}명을 모두 완전히 지울까요?\n\n되돌릴 수 없어요. 회원 정보와 함께 그 회원이 뛴 경기 기록, 참석·입금 기록, 코트비 지급 내역이 지워지고, 그 회원이 만든 모임은 관리자에게 넘어가요.`
                  )
                )
                  e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="purge_all" />
              <button className="btn-danger btn-sm">
                <Trash2 size={14} />
                모두 완전 삭제
              </button>
            </Form>
          </div>
          <p className="mt-1 text-[13px] font-medium text-slate-500">
            로그인할 수 없고 회원 목록·랭킹에서 빠져 있어요. 이 회원이 뛴 경기는 전적·랭킹·티어 계산에서 빠져 있고, 복구하면 다시 반영돼요.
            <b className="font-bold text-ink dark:text-white"> 완전 삭제</b>하면 회원 정보와 기록이 DB에서 지워져 되돌릴 수 없어요.
          </p>
          <ul className="record-rows mt-3">
            {inactive.map((m) => {
              const preview = previewOf.get(m.id);
              return (
                <li key={m.id}>
                  <div className="flex min-w-0 items-center gap-3 opacity-70">
                    <MemberAvatar user={m} className="grayscale" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-bold">
                        {m.name}
                        <span className="text-xs font-medium text-slate-400">@{m.username}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {m.created_at.slice(0, 10)} 가입
                        {preview ? ` · ${purgeSummary(preview)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore_member" />
                      <input type="hidden" name="user_id" value={m.id} />
                      <button className="btn-ghost btn-sm">
                        <RotateCcw size={14} />
                        복구
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (
                          !confirm(
                            `${m.name}님을 완전히 지울까요?\n\n되돌릴 수 없어요. 함께 지워지는 것: ${
                              preview ? purgeSummary(preview) : "기록"
                            }`
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="purge_member" />
                      <input type="hidden" name="user_id" value={m.id} />
                      <button className="btn-danger btn-sm">
                        <Trash2 size={14} />
                        완전 삭제
                      </button>
                    </Form>
                  </div>
                </li>
              );
            })}
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
