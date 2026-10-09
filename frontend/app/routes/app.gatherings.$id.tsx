import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  isRouteErrorResponse,
  useActionData,
  useLoaderData,
  useNavigation,
  useOutletContext,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import {
  Check,
  CircleAlert,
  Dices,
  Landmark,
  Lock,
  MapPin,
  Pencil,
  Scale,
  Send,
  Share2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BallBasket } from "~/components/BallBasket";
import { Eyebrow, MemberAvatar } from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { FieldGroup, Modal } from "~/components/Modal";
import { BackLink, EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { accountText, won } from "~/lib/format";
import { shareToKakao } from "~/lib/kakao";
import { requireToken } from "~/lib/session.server";
import { GATHERING_STATUS_LABEL, WEEKDAYS, formatOpenAt } from "~/lib/status";
import {
  MATCH_TYPE_LABEL,
  type AttendanceStatus,
  type Draw,
  type DrawMatch,
  type GatheringDetail,
  type User,
} from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "모임 상세 · 오테식 매니저" },
];

// 정시(00분) 단위 시간 옵션, 06시~22시
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++)
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  try {
    const [gathering, draws] = await Promise.all([
      api<GatheringDetail>(`/gatherings/${id}`, { token }),
      api<Draw[]>(`/gatherings/${id}/draws`, { token }),
    ]);
    return json({ gathering, draws });
  } catch (err) {
    // 아직 공개 전(403)이거나 지워진(404) 모임은 안내 화면으로
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      throw json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** 공개 전·없는 모임 안내 (예: 카톡으로 받은 다음 주 모임 링크를 월요일 전에 연 경우) */
export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    isRouteErrorResponse(error) && typeof error.data?.message === "string"
      ? error.data.message
      : "모임을 불러오지 못했어요.";
  const locked = isRouteErrorResponse(error) && error.status === 403;
  return (
    <PageBody>
      <div className="pt-5">
        <BackLink to="/app/calendar">캘린더</BackLink>
      </div>
      <EmptyCard
        icon={<Lock size={28} />}
        action={
          <Link to="/app/calendar" className="btn-primary btn-sm">
            캘린더로 가기
          </Link>
        }
      >
        {locked ? message : "모임을 찾을 수 없어요. 삭제됐거나 주소가 잘못됐을 수 있어요."}
      </EmptyCard>
    </PageBody>
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  try {
    if (intent === "vote") {
      await api(`/gatherings/${id}/attendance`, {
        method: "PUT",
        token,
        body: { status: formData.get("status") },
      });
    } else if (intent === "generate") {
      await api(`/gatherings/${id}/draws/generate`, {
        method: "POST",
        token,
        body: {
          match_type: formData.get("match_type"),
          method: formData.get("method"),
        },
      });
    } else if (intent === "toggle_payment") {
      await api(
        `/gatherings/${id}/participants/${formData.get("user_id")}/payment`,
        {
          method: "PUT",
          token,
          body: { paid: formData.get("paid") === "true" },
        }
      );
    } else if (intent === "delete_draw") {
      await api(`/draws/${formData.get("draw_id")}`, {
        method: "DELETE",
        token,
      });
    } else if (intent === "result") {
      await api(`/draw-matches/${formData.get("draw_match_id")}/result`, {
        method: "POST",
        token,
        body: {
          team1_score: Number(formData.get("team1_score") || 0),
          team2_score: Number(formData.get("team2_score") || 0),
        },
      });
    } else if (intent === "update_gathering") {
      const get = (k: string) => {
        const v = formData.get(k);
        return v ? String(v) : undefined;
      };
      const courtNumbers = get("court_numbers");
      const maxParticipants = get("max_participants");
      await api(`/gatherings/${id}`, {
        method: "PATCH",
        token,
        body: {
          title: get("title"),
          event_date: get("event_date"),
          start_time: get("start_time") || null,
          end_time: get("end_time") || null,
          location: get("location") || null,
          court_numbers: courtNumbers || null,
          court_count: courtNumbers
            ? courtNumbers.split(",").filter((s) => s.trim()).length || 1
            : Number(get("court_count") || 1),
          max_participants: maxParticipants ? Number(maxParticipants) : null,
          fee: get("fee") ? Number(get("fee")) : 0,
          bank: get("bank") || null,
          account_number: get("account_number") || null,
          account_holder: get("account_holder") || null,
          description: get("description") || null,
          status: get("status"),
        },
      });
    } else if (intent === "delete_gathering") {
      await api(`/gatherings/${id}`, { method: "DELETE", token });
      const from = String(formData.get("from") || "");
      if (from.startsWith("list:"))
        return redirect(`/app/calendar?view=list&month=${from.slice(5)}`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return redirect(`/app/day/${from}`);
      return redirect(from ? `/app/calendar?month=${from}` : "/app/calendar");
    }
    return json({ ok: true, error: null as string | null });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

const VOTE_LABEL: Record<AttendanceStatus, string> = {
  attending: "참석",
  absent: "불참",
  maybe: "미정",
};

export default function GatheringDetailPage() {
  const { gathering, draws } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { user } = useOutletContext<{ user: User }>();
  const isOrganizer = gathering.created_by === user.id || user.is_admin;
  const [editing, setEditing] = useState(false);
  // 등록된 실제 코트 번호 ("3, 5" → ["3","5"]). 대진의 코트 순번을 실제 번호로 변환하는 데 사용.
  const courtLabels = gathering.court_numbers
    ? gathering.court_numbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // 참석 변경 마감: 모임 3일 전부터는 일반 회원이 불참/미정으로 못 바꿈(관리자만 가능)
  const ATTENDANCE_LOCK_DAYS = 3;
  const daysUntilEvent = Math.round(
    (new Date(gathering.event_date + "T00:00:00").getTime() -
      new Date(new Date().toDateString()).getTime()) /
      86400000
  );
  const attendanceLocked = daysUntilEvent <= ATTENDANCE_LOCK_DAYS;
  const canSetAbsence = user.is_admin || !attendanceLocked;

  // 돌아갈 위치를 ?from 으로 판별:
  //  - "list:YYYY-MM" → 캘린더 리스트 모드(월 전체)
  //  - "YYYY-MM-DD"   → 그 날의 일정 목록 페이지
  //  - "YYYY-MM"      → 캘린더(달력 모드)
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") || "";
  let backHref: string;
  let backLabel: string;
  if (from.startsWith("list:")) {
    backHref = `/app/calendar?view=list&month=${from.slice(5)}`;
    backLabel = "목록";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    backHref = `/app/day/${from}`;
    backLabel = "목록";
  } else {
    backHref = `/app/calendar?month=${
      from || gathering.event_date.slice(0, 7)
    }`;
    backLabel = "캘린더";
  }

  // 수정 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setEditing(false);
  }, [actionData]);

  // 참가비 정산: 금액은 모두 서버 계산값(1인 금액 = 총액 ÷ 참석 인원, 100원 단위 올림)
  const perPerson = gathering.per_person;
  const payment = gathering.payment;
  const attendees = gathering.participants.filter(
    (p) => p.status === "attending"
  );
  const dueOf = new Map(payment?.dues.map((d) => [d.user.id, d.amount]) ?? []);
  const refundOf = new Map(
    payment?.refunds.map((r) => [r.user.id, r.amount]) ?? []
  );
  // 입금 후 불참으로 바뀐 사람 (돌려줄 돈)
  const refundAbsentees = gathering.participants.filter(
    (p) => p.status !== "attending" && refundOf.has(p.user.id)
  );
  const me = gathering.participants.find((p) => p.user.id === user.id);
  const myAttending = me?.status === "attending";
  const myDue = me ? dueOf.get(me.user.id) ?? 0 : 0;
  const myRefund = me ? refundOf.get(me.user.id) ?? 0 : 0;
  const account = accountText(gathering);
  const dateLine = `📅 ${gathering.event_date}${
    gathering.start_time ? ` ${gathering.start_time.slice(0, 5)}` : ""
  }${gathering.end_time ? `~${gathering.end_time.slice(0, 5)}` : ""}`;
  const path = `/app/gatherings/${gathering.id}`;

  // 카카오 공유 메시지 (오픈톡방에 보낼 모임 요약)
  const shareBase = [
    `🎾 ${gathering.title}`,
    dateLine,
    gathering.location ? `📍 ${gathering.location}` : "",
    `🟩 코트 ${
      gathering.court_numbers
        ? `${gathering.court_numbers} (${gathering.court_count}면)`
        : `${gathering.court_count}면`
    }`,
    gathering.fee > 0
      ? `💰 참가비 총 ${won(gathering.fee)} (1인 ${won(perPerson)})`
      : "",
    account ? `🏦 ${account}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 총무용 미입금 안내 메시지
  const remindBase = [
    `💰 ${gathering.title} 참가비 안내`,
    dateLine,
    `1인 ${won(perPerson)}`,
    account ? `🏦 ${account}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const [ey, em, ed] = gathering.event_date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(ey, em - 1, ed).getDay()];
  const timeText = gathering.start_time
    ? `${gathering.start_time.slice(0, 5)}${
        gathering.end_time ? ` – ${gathering.end_time.slice(0, 5)}` : ""
      }`
    : "시간 미정";
  const collectedPct =
    payment && payment.expected > 0
      ? Math.min(100, (payment.collected / payment.expected) * 100)
      : 0;

  const statusText = `${GATHERING_STATUS_LABEL[gathering.status]}${
    gathering.status === "planned" && daysUntilEvent >= 0
      ? ` · ${daysUntilEvent === 0 ? "오늘" : `D-${daysUntilEvent}`}`
      : ""
  }`;
  const showSegments = payment
    ? payment.attending > 0 && payment.attending <= 20
    : false;

  return (
    <PageBody>
      {/* 뒤로가기 + 액션 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <BackLink to={backHref}>{backLabel}</BackLink>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn-accent btn-sm"
            onClick={() =>
              shareToKakao({
                base: shareBase,
                names: attendees.map((p) => p.user.name),
                path,
              })
            }
          >
            <Share2 size={14} />
            카톡 공유
          </button>
          {isOrganizer ? (
            <>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setEditing(true)}
                aria-label="수정"
              >
                <Pencil size={14} />
                <span className="hidden sm:inline">수정</span>
              </button>
              <Form method="post">
                <input type="hidden" name="intent" value="delete_gathering" />
                <input type="hidden" name="from" value={from} />
                <button
                  className="btn-danger btn-sm"
                  aria-label="삭제"
                  onClick={(e) => {
                    if (
                      !confirm(
                        "이 모임을 삭제할까요? 관련 참석/대진 정보도 함께 삭제됩니다."
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">삭제</span>
                </button>
              </Form>
            </>
          ) : null}
        </div>
      </div>

      <PageHeader
        eyebrow="LET’S PLAY TOGETHER."
        title={gathering.title}
        sub={gathering.description || "좋아하는 사람들과, 좋아하는 운동."}
      />

      {/* 처리 실패 알림 (참석 투표 정원 초과·마감, 입금 처리 등). 수정 모달이 열려 있으면 모달 안에서 보여준다. */}
      {actionData?.error && !editing ? (
        <p className="alert-error flex items-center gap-2">
          <CircleAlert size={16} className="shrink-0" />
          {actionData.error}
        </p>
      ) : null}

      {/* 공개 시점 안내: 임원진에게는 공개 전 상태, 정회원에게는 게스트 투표 시작 시점 */}
      {gathering.member_open_at && gathering.guest_open_at && user.member_type !== "guest" &&
      (!gathering.open_to_members || !gathering.open_to_guests) ? (
        <p className="flex items-start gap-2 rounded-2xl bg-house-lav/30 px-4 py-3 text-sm font-semibold">
          <Lock size={16} className="mt-0.5 shrink-0" />
          {!gathering.open_to_members
            ? `아직 임원진만 보는 일정이에요. 정회원은 ${formatOpenAt(gathering.member_open_at)}부터, 게스트는 ${formatOpenAt(gathering.guest_open_at)}부터 보고 투표할 수 있어요.`
            : `게스트 투표는 ${formatOpenAt(gathering.guest_open_at)}부터 열려요. 그 전에는 정회원만 참석 투표를 할 수 있어요.`}
        </p>
      ) : null}

      <div className="detail-top-grid">
        <section className="tile-orange min-h-[285px] sm:p-7">
          <div className="relative z-10 flex items-center justify-between gap-3">
            <Eyebrow>OUR NEXT GATHERING</Eyebrow>
            <span className="chip-white !bg-white/25">{statusText}</span>
          </div>
          <p className="relative z-10 mt-5 font-display text-[64px] font-bold leading-none tracking-[-0.06em] sm:text-[76px]">
            {em}.{String(ed).padStart(2, "0")}
            <span className="ml-3 align-top font-sans text-base font-medium tracking-normal">
              {weekday}요일
            </span>
          </p>
          <p className="relative z-10 mt-4 text-base font-semibold">
            {timeText}
          </p>
          <div className="relative z-10 mt-6 max-w-[72%] space-y-2 text-[13px]">
            <p className="flex items-start gap-2">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              <strong>{gathering.location ?? "장소 미정"}</strong>
            </p>
            <p className="pl-6">
              {gathering.court_numbers
                ? `${gathering.court_numbers}번 코트`
                : `코트 ${gathering.court_count}면`}{" "}
              · 총 {gathering.court_count}면
            </p>
            {gathering.fee > 0 && (
              <p className="pl-6">코트비 총 {won(gathering.fee)}</p>
            )}
          </div>
          <BallBasket className="pointer-events-none absolute bottom-5 right-4 w-24 opacity-90 sm:right-7 sm:w-32" />
        </section>

        {/* 참석 (관리자는 투표 없이 현황만) */}
        <section className="card flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="tile-title">
                {user.is_admin ? "참석 현황" : "이번에도 함께할까요?"}
              </h2>
              <p className="tile-sub text-slate-500 dark:text-slate-400">
                불참 {gathering.attendance?.absent ?? 0} · 미정{" "}
                {gathering.attendance?.maybe ?? 0}
              </p>
            </div>
            <p className="shrink-0 whitespace-nowrap font-display text-[46px] font-semibold leading-none tracking-[-0.05em] sm:text-[60px]">
              {gathering.attendance?.attending ?? 0}
              {gathering.max_participants ? (
                <span className="text-[26px] opacity-60 sm:text-[32px]">
                  /{gathering.max_participants}
                </span>
              ) : null}
            </p>
          </div>

          {!user.is_admin ? (
            <div className="mt-auto pt-6">
              <Form method="post" className="flex gap-2">
                <input type="hidden" name="intent" value="vote" />
                {(["attending", "absent", "maybe"] as AttendanceStatus[]).map(
                  (s) => {
                    const blocked = s !== "attending" && !canSetAbsence;
                    const selected = me?.status === s;
                    return (
                      <button
                        key={s}
                        name="status"
                        value={s}
                        disabled={blocked || navigation.state !== "idle"}
                        title={
                          blocked
                            ? `모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 바꿀 수 없어요`
                            : undefined
                        }
                        aria-pressed={selected}
                        className={`${
                          selected ? "btn-primary" : "btn-ghost"
                        } h-11 flex-1 px-2 text-sm disabled:cursor-not-allowed`}
                      >
                        {selected ? <Check size={16} /> : null}
                        {VOTE_LABEL[s]}
                      </button>
                    );
                  }
                )}
              </Form>
              {attendanceLocked ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-bold">
                  <Lock size={12} className="shrink-0" />
                  모임 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참·미정으로 바꿀 수
                  없어요. 필요하면 관리자에게 문의하세요.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-auto pt-6 text-sm font-bold">
              관리자는 투표 없이 현황만 봐요.
            </p>
          )}
        </section>
      </div>

      <div className="detail-bottom-grid">
        <section
          className={`card detail-attendees ${payment ? "" : "lg:col-span-2"}`}
        >
          <h2 className="section-title">함께하는 식구들</h2>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {attendees.length
              ? `${attendees.length}명이 함께해요`
              : "아직 참석자가 없어요"}
          </p>
          {!gathering.participants.length ? (
            <p className="py-7 text-sm text-slate-500 dark:text-slate-400">
              아직 투표한 사람이 없어요.
            </p>
          ) : (
            (["attending", "maybe", "absent"] as AttendanceStatus[]).map(
              (status) => {
                const people = gathering.participants.filter(
                  (p) => p.status === status
                );
                if (!people.length) return null;
                return (
                  <div key={status}>
                    {status !== "attending" && (
                      <p className="mt-6 border-t border-slate-200 pt-4 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {VOTE_LABEL[status]} {people.length}명
                      </p>
                    )}
                    <div className="player-grid">
                      {people.map((p) => (
                        <Link key={p.user.id} to={`/app/members/${p.user.id}`}>
                          <MemberAvatar
                            user={p.user}
                            className={
                              status === "attending"
                                ? "!h-11 !w-11"
                                : "!h-9 !w-9 opacity-60"
                            }
                          />
                          <strong className="max-w-full truncate text-xs">
                            {p.user.name}
                            {p.user.id === user.id && (
                              <small className="ml-1 text-[10px] font-normal text-slate-500">
                                나
                              </small>
                            )}
                          </strong>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {p.user.member_type === "guest" ? "게스트 · " : ""}
                            {p.user.ntrp
                              ? `NTRP ${p.user.ntrp}`
                              : "NTRP 미입력"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }
            )
          )}
        </section>

        {/* 참가비 (금액은 모두 서버 계산값) */}
        {payment ? (
          <section className="tile-yellow detail-payments space-y-4">
            <Eyebrow>MATCH DUES</Eyebrow>
            <div className="detail-payment-heading">
              <div className="min-w-0">
                <h2 className="tile-title">참가비 정산</h2>
                <p className="tile-sub">
                  {gathering.status === "canceled"
                    ? "취소된 모임이라 받을 돈이 없어요"
                    : payment.attending > 0
                    ? `${won(gathering.fee)} ÷ ${payment.attending}명`
                    : "참석자가 정해지면 계산돼요"}
                </p>
              </div>
              <p className="shrink-0 font-display text-[30px] font-extrabold leading-none tracking-[-0.05em] sm:text-[34px]">
                {won(perPerson)}
              </p>
            </div>

            <div>
              {showSegments ? (
                <div className="seg">
                  {Array.from({ length: payment.attending }, (_, i) => (
                    <i key={i} className={i < payment.paid_count ? "on" : ""} />
                  ))}
                </div>
              ) : (
                <div className="h-2 overflow-hidden rounded-full bg-ink/15">
                  <div
                    className="h-full bg-ink"
                    style={{ width: `${collectedPct}%` }}
                  />
                </div>
              )}
              <p className="mt-2 flex justify-between gap-2 text-[13.5px] font-bold">
                <span>
                  입금 {payment.paid_count} / {payment.attending}명
                </span>
                <span>
                  {payment.collected.toLocaleString()} / {won(payment.expected)}
                </span>
              </p>
            </div>

            {/* 내 참가비 (참석한 회원 본인) */}
            {myAttending && perPerson > 0 ? (
              <div className="rounded-2xl bg-white/70 px-4 py-3.5">
                <p className="text-xs font-bold">내 참가비</p>
                {myDue > 0 ? (
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-[24px] font-extrabold tracking-[-0.04em]">
                      {won(myDue)}
                    </span>
                    <span className="text-sm font-bold">
                      {me?.paid ? "추가 입금이 필요해요" : "입금해 주세요"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1.5 text-base font-extrabold">
                    <Check size={18} />
                    입금 완료
                    <span className="text-sm font-semibold">
                      ({won(me?.paid_amount ?? perPerson)})
                    </span>
                  </p>
                )}
                {myRefund > 0 ? (
                  <p className="mt-1 text-xs font-semibold">
                    참석 인원이 늘어 {won(myRefund)}을 더 냈어요. 총무가 돌려줄
                    예정이에요.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* 입금 계좌 */}
            {gathering.account_number ? (
              <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3">
                <Landmark size={18} className="shrink-0" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-xs font-bold">
                    {[gathering.bank, gathering.account_holder]
                      .filter(Boolean)
                      .join(" · ") || "입금 계좌"}
                  </p>
                  <p className="break-all font-extrabold tabular-nums">
                    {gathering.account_number}
                  </p>
                </div>
                <CopyButton
                  text={gathering.account_number}
                  label="계좌 복사"
                  tone="ink"
                />
              </div>
            ) : null}

            {/* 참석자별 입금 현황 */}
            {attendees.length === 0 ? (
              <p className="text-sm font-semibold">참석자가 없어요.</p>
            ) : (
              <ul className="tile-rows">
                {attendees.map((p) => {
                  const due = dueOf.get(p.user.id) ?? 0;
                  const refund = refundOf.get(p.user.id) ?? 0;
                  // 입금 뒤 참석 인원이 바뀌어 1인 금액과 입금 금액이 달라진 경우
                  const note =
                    p.paid && due > 0
                      ? `${won(p.paid_amount ?? 0)} 입금 · ${won(
                          due
                        )} 더 받아야 해요`
                      : p.paid && refund > 0
                      ? `${won(p.paid_amount ?? 0)} 입금 · ${won(
                          refund
                        )} 돌려줘야 해요`
                      : null;
                  const badge = p.paid ? "chip-ink" : "chip-line";
                  return (
                    <li key={p.user.id}>
                      <div className="min-w-0">
                        <span className="font-bold">{p.user.name}</span>
                        {p.user.id === user.id ? (
                          <span className="ml-1 text-xs font-semibold">
                            (나)
                          </span>
                        ) : null}
                        {note ? (
                          <p className="text-xs font-semibold">{note}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isOrganizer && note ? (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="toggle_payment"
                            />
                            <input
                              type="hidden"
                              name="user_id"
                              value={p.user.id}
                            />
                            <input type="hidden" name="paid" value="true" />
                            <button
                              className="chip-white cursor-pointer transition-opacity hover:opacity-80"
                              title="차액을 주고받았으면 누르세요. 현재 1인 금액으로 기록됩니다."
                            >
                              차액 정산
                            </button>
                          </Form>
                        ) : null}
                        {isOrganizer ? (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="toggle_payment"
                            />
                            <input
                              type="hidden"
                              name="user_id"
                              value={p.user.id}
                            />
                            <input
                              type="hidden"
                              name="paid"
                              value={p.paid ? "false" : "true"}
                            />
                            <button
                              className={`${badge} cursor-pointer transition-opacity hover:opacity-80`}
                            >
                              {p.paid ? "입금" : "미입금"}
                            </button>
                          </Form>
                        ) : (
                          <span className={badge}>
                            {p.paid ? "입금" : "미입금"}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 돌려줄 참가비: 입금 후 불참/취소 */}
            {refundAbsentees.length > 0 ? (
              <div className="rounded-2xl bg-white/70 px-4 py-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold">
                  <Undo2 size={13} />
                  돌려줄 참가비 (입금 후 불참)
                </p>
                <ul className="space-y-1.5 text-sm">
                  {refundAbsentees.map((p) => (
                    <li
                      key={p.user.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="font-semibold">
                        {p.user.name} · {won(refundOf.get(p.user.id) ?? 0)}
                      </span>
                      {isOrganizer ? (
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="toggle_payment"
                          />
                          <input
                            type="hidden"
                            name="user_id"
                            value={p.user.id}
                          />
                          <input type="hidden" name="paid" value="false" />
                          <button className="chip-ink cursor-pointer transition-opacity hover:opacity-80">
                            환불 완료
                          </button>
                        </Form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 총무 도구 */}
            {isOrganizer ? (
              <div className="space-y-2">
                {payment.dues.length > 0 ? (
                  <button
                    type="button"
                    className="btn-ink h-11 w-full"
                    onClick={() =>
                      shareToKakao({
                        base: remindBase,
                        names: payment.dues.map((d) => d.user.name),
                        namesLabel: "🙏 미입금",
                        path,
                      })
                    }
                  >
                    <Send size={15} />
                    미입금 안내 보내기 ({payment.dues.length}명)
                  </button>
                ) : null}
                <p className="text-xs font-semibold">
                  상태를 누르면 입금/미입금이 바뀌어요. 입금 처리하면 그때의 1인
                  금액이 기록돼요. 1인 금액은 100원 단위로 올림해요.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 대진 */}
        <section className="card detail-draws space-y-5">
          <div>
            <h2 className="section-title">오늘의 매치업</h2>
            <p className="tile-sub">
              {draws.length > 0
                ? `대진표 ${draws.length}개`
                : isOrganizer
                ? "종목과 방식을 고르면 참석자로 대진을 짜요"
                : "아직 대진표가 없어요"}
            </p>
          </div>

          {/* 대진 만들기 (주최자/관리자) */}
          {isOrganizer ? (
            <Form method="post" className="grid grid-cols-2 gap-2 sm:max-w-md">
              <input type="hidden" name="intent" value="generate" />
              <select
                name="match_type"
                aria-label="종목"
                className="input col-span-2"
                defaultValue="mens_doubles"
              >
                {Object.entries(MATCH_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <button name="method" value="random" className="btn-ghost">
                <Dices size={16} />
                랜덤
              </button>
              <button name="method" value="skill" className="btn-primary">
                <Scale size={16} />
                실력 균형
              </button>
            </Form>
          ) : null}

          {/* 대진표 */}
          {draws.map((draw) => (
            <div key={draw.id}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
                <p className="text-[15px] font-extrabold">
                  대진표 ·{" "}
                  {draw.generation_method === "skill"
                    ? "실력 균형"
                    : draw.generation_method === "random"
                    ? "랜덤"
                    : "수동"}
                </p>
                {isOrganizer ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_draw" />
                    <input type="hidden" name="draw_id" value={draw.id} />
                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/10"
                      title="대진표 삭제"
                      aria-label="대진표 삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </Form>
                ) : null}
              </div>
              <div className="draw-grid">
                {draw.matches.map((m) => (
                  <DrawMatchRow
                    key={m.id}
                    match={m}
                    canRecord={isOrganizer}
                    courtLabels={courtLabels}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* 수정 모달 */}
      {editing ? (
        <Modal title="모임 수정" onClose={() => setEditing(false)}>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="update_gathering" />
            <FieldGroup title="기본 정보">
              <div>
                <label className="label" htmlFor="e_title">
                  제목
                </label>
                <input
                  id="e_title"
                  name="title"
                  className="input"
                  required
                  defaultValue={gathering.title}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="e_date">
                    날짜
                  </label>
                  <input
                    id="e_date"
                    name="event_date"
                    type="date"
                    className="input"
                    required
                    defaultValue={gathering.event_date}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="e_status">
                    상태
                  </label>
                  <select
                    id="e_status"
                    name="status"
                    className="input"
                    defaultValue={gathering.status}
                  >
                    {Object.entries(GATHERING_STATUS_LABEL).map(
                      ([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="e_start">
                    시작
                  </label>
                  <select
                    id="e_start"
                    name="start_time"
                    className="input"
                    defaultValue={gathering.start_time?.slice(0, 5) ?? ""}
                  >
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="e_end">
                    종료
                  </label>
                  <select
                    id="e_end"
                    name="end_time"
                    className="input"
                    defaultValue={gathering.end_time?.slice(0, 5) ?? ""}
                  >
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="e_location">
                  장소
                </label>
                <input
                  id="e_location"
                  name="location"
                  className="input"
                  defaultValue={gathering.location ?? ""}
                />
              </div>
            </FieldGroup>

            <FieldGroup title="코트 · 인원">
              <div>
                <label className="label" htmlFor="e_courts">
                  코트 번호
                </label>
                <input
                  id="e_courts"
                  name="court_numbers"
                  className="input"
                  placeholder="예: 3, 5 (쉼표로 구분)"
                  defaultValue={gathering.court_numbers ?? ""}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="e_count">
                    코트 면수
                  </label>
                  <input
                    id="e_count"
                    name="court_count"
                    type="number"
                    min="1"
                    className="input"
                    defaultValue={gathering.court_count}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="e_max">
                    정원
                  </label>
                  <input
                    id="e_max"
                    name="max_participants"
                    type="number"
                    min="1"
                    className="input"
                    placeholder="제한 없음"
                    defaultValue={gathering.max_participants ?? ""}
                  />
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title="참가비">
              <div>
                <label className="label" htmlFor="e_fee">
                  총 참가비 (원)
                </label>
                <input
                  id="e_fee"
                  name="fee"
                  type="number"
                  min="0"
                  step="1000"
                  className="input"
                  placeholder="0 = 무료"
                  defaultValue={gathering.fee ?? 0}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label" htmlFor="e_bank">
                    은행
                  </label>
                  <input
                    id="e_bank"
                    name="bank"
                    className="input"
                    placeholder="국민"
                    defaultValue={gathering.bank ?? ""}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label" htmlFor="e_account">
                    계좌번호
                  </label>
                  <input
                    id="e_account"
                    name="account_number"
                    className="input"
                    placeholder="123-456-7890"
                    defaultValue={gathering.account_number ?? ""}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="e_holder">
                  예금주
                </label>
                <input
                  id="e_holder"
                  name="account_holder"
                  className="input"
                  placeholder="홍길동"
                  defaultValue={gathering.account_holder ?? ""}
                />
              </div>
            </FieldGroup>

            <div>
              <label className="label" htmlFor="e_desc">
                메모
              </label>
              <textarea
                id="e_desc"
                name="description"
                rows={2}
                className="input"
                defaultValue={gathering.description ?? ""}
              />
            </div>

            {actionData?.error ? (
              <p className="alert-error">{actionData.error}</p>
            ) : null}

            <button
              type="submit"
              className="btn-primary h-11 w-full"
              disabled={navigation.state === "submitting"}
            >
              {navigation.state === "submitting" ? "저장 중…" : "저장"}
            </button>
          </Form>
        </Modal>
      ) : null}
    </PageBody>
  );
}

function DrawMatchRow({
  match,
  canRecord,
  courtLabels,
}: {
  match: DrawMatch;
  canRecord: boolean;
  courtLabels: string[];
}) {
  const navigation = useNavigation();
  const recorded = match.result_match_id !== null;
  const busy =
    navigation.state !== "idle" &&
    navigation.formData?.get("draw_match_id") === String(match.id);
  const courtLabel =
    match.court_number != null && courtLabels[match.court_number - 1]
      ? courtLabels[match.court_number - 1]
      : match.court_number ?? "—";
  return (
    <div className="draw-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="badge-gray">
          COURT {courtLabel} · {match.round_number ?? 1}R
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {MATCH_TYPE_LABEL[match.match_type]}
        </span>
      </div>
      <div className="draw-teams">
        {[match.team1, match.team2].map((team, i) => (
          <div key={i} className={i ? "contents" : "space-y-3"}>
            {i === 1 && (
              <span className="text-center font-display text-xs text-slate-400">
                VS
              </span>
            )}
            {i === 1 ? (
              <div className="space-y-3">
                {team.map((p) => (
                  <Link
                    key={p.id}
                    to={`/app/members/${p.id}`}
                    className="draw-player"
                  >
                    <MemberAvatar user={p} className="!h-8 !w-8 !text-xs" />
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              team.map((p) => (
                <Link
                  key={p.id}
                  to={`/app/members/${p.id}`}
                  className="draw-player"
                >
                  <MemberAvatar user={p} className="!h-8 !w-8 !text-xs" />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {recorded ? (
          <span className="badge-gray">
            <Check size={13} />
            결과 기록 완료
          </span>
        ) : canRecord ? (
          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="result" />
            <input type="hidden" name="draw_match_id" value={match.id} />
            <input
              name="team1_score"
              type="number"
              min="0"
              className="input !w-16 !px-2 !py-2 text-center"
              placeholder="0"
              aria-label="팀1 점수"
            />
            <span className="text-slate-400">:</span>
            <input
              name="team2_score"
              type="number"
              min="0"
              className="input !w-16 !px-2 !py-2 text-center"
              placeholder="0"
              aria-label="팀2 점수"
            />
            <button className="btn-primary btn-sm ml-auto" disabled={busy}>
              {busy ? "저장 중…" : "결과 기록"}
            </button>
          </Form>
        ) : (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            경기 예정
          </p>
        )}
      </div>
    </div>
  );
}
