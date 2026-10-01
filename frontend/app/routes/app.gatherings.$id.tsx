import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useOutletContext, useSearchParams } from "@remix-run/react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  Dices,
  Landmark,
  LayoutGrid,
  Lock,
  MapPin,
  Pencil,
  Scale,
  Send,
  Share2,
  Trash2,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CopyButton } from "~/components/CopyButton";
import { FieldGroup, Modal } from "~/components/Modal";
import { PageBody, PageHero } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { accountText, won } from "~/lib/format";
import { shareToKakao } from "~/lib/kakao";
import { requireToken } from "~/lib/session.server";
import { GATHERING_STATUS_LABEL, WEEKDAYS } from "~/lib/status";
import {
  MATCH_TYPE_LABEL,
  type AttendanceStatus,
  type Draw,
  type DrawMatch,
  type GatheringDetail,
  type User,
  type UserBrief,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "모임 상세 · 테니스 매니저" }];

// 정시(00분) 단위 시간 옵션, 06시~22시
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const [gathering, draws] = await Promise.all([
    api<GatheringDetail>(`/gatherings/${id}`, { token }),
    api<Draw[]>(`/gatherings/${id}/draws`, { token }),
  ]);
  return json({ gathering, draws });
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
      await api(`/gatherings/${id}/participants/${formData.get("user_id")}/payment`, {
        method: "PUT",
        token,
        body: { paid: formData.get("paid") === "true" },
      });
    } else if (intent === "delete_draw") {
      await api(`/draws/${formData.get("draw_id")}`, { method: "DELETE", token });
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
      if (from.startsWith("list:")) return redirect(`/app/calendar?view=list&month=${from.slice(5)}`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return redirect(`/app/day/${from}`);
      return redirect(from ? `/app/calendar?month=${from}` : "/app/calendar");
    }
    return json({ ok: true, error: null as string | null });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

const VOTE_LABEL: Record<AttendanceStatus, string> = {
  attending: "참석",
  absent: "불참",
  maybe: "미정",
};

function names(players: UserBrief[]): string {
  return players.map((p) => p.name).join(", ") || "—";
}

export default function GatheringDetailPage() {
  const { gathering, draws } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { user } = useOutletContext<{ user: User }>();
  const isOrganizer = gathering.created_by === user.id || user.is_admin;
  const [editing, setEditing] = useState(false);
  // 등록된 실제 코트 번호 ("3, 5" → ["3","5"]). 대진의 코트 순번을 실제 번호로 변환하는 데 사용.
  const courtLabels = gathering.court_numbers
    ? gathering.court_numbers.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // 참석 변경 마감: 모임 3일 전부터는 일반 회원이 불참/미정으로 못 바꿈(관리자만 가능)
  const ATTENDANCE_LOCK_DAYS = 3;
  const daysUntilEvent = Math.round(
    (new Date(gathering.event_date + "T00:00:00").getTime() -
      new Date(new Date().toDateString()).getTime()) /
      86400000,
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
    backHref = `/app/calendar?month=${from || gathering.event_date.slice(0, 7)}`;
    backLabel = "캘린더";
  }

  // 수정 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setEditing(false);
  }, [actionData]);

  // 참가비 정산: 금액은 모두 서버 계산값(1인 금액 = 총액 ÷ 참석 인원, 100원 단위 올림)
  const perPerson = gathering.per_person;
  const payment = gathering.payment;
  const attendees = gathering.participants.filter((p) => p.status === "attending");
  const dueOf = new Map(payment?.dues.map((d) => [d.user.id, d.amount]) ?? []);
  const refundOf = new Map(payment?.refunds.map((r) => [r.user.id, r.amount]) ?? []);
  // 입금 후 불참으로 바뀐 사람 (돌려줄 돈)
  const refundAbsentees = gathering.participants.filter((p) => p.status !== "attending" && refundOf.has(p.user.id));
  const me = gathering.participants.find((p) => p.user.id === user.id);
  const myAttending = me?.status === "attending";
  const myDue = me ? (dueOf.get(me.user.id) ?? 0) : 0;
  const myRefund = me ? (refundOf.get(me.user.id) ?? 0) : 0;
  const account = accountText(gathering);
  const dateLine = `📅 ${gathering.event_date}${gathering.start_time ? ` ${gathering.start_time.slice(0, 5)}` : ""}${gathering.end_time ? `~${gathering.end_time.slice(0, 5)}` : ""}`;
  const path = `/app/gatherings/${gathering.id}`;

  // 카카오 공유 메시지 (오픈톡방에 보낼 모임 요약)
  const shareBase = [
    `🎾 ${gathering.title}`,
    dateLine,
    gathering.location ? `📍 ${gathering.location}` : "",
    `🟩 코트 ${gathering.court_numbers ? `${gathering.court_numbers} (${gathering.court_count}면)` : `${gathering.court_count}면`}`,
    gathering.fee > 0 ? `💰 참가비 총 ${won(gathering.fee)} (1인 ${won(perPerson)})` : "",
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
    ? `${gathering.start_time.slice(0, 5)}${gathering.end_time ? ` – ${gathering.end_time.slice(0, 5)}` : ""}`
    : "시간 미정";
  const collectedPct = payment && payment.expected > 0 ? Math.min(100, (payment.collected / payment.expected) * 100) : 0;

  return (
    <>
      <PageHero>
        {/* 뒤로가기 + 액션 */}
        <div className="flex items-center justify-between gap-2">
          <Link to={backHref} className="back-link-hero !mb-0">
            <ArrowLeft size={16} />
            {backLabel}
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-hero btn-sm"
              onClick={() => shareToKakao({ base: shareBase, names: attendees.map((p) => p.user.name), path })}
            >
              <Share2 size={15} />
              공유
            </button>
            {isOrganizer ? (
              <>
                <button className="btn-hero btn-sm" onClick={() => setEditing(true)} aria-label="수정">
                  <Pencil size={15} />
                  <span className="hidden sm:inline">수정</span>
                </button>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete_gathering" />
                  <input type="hidden" name="from" value={from} />
                  <button
                    className="btn-hero btn-sm hover:!bg-red-500/80"
                    aria-label="삭제"
                    onClick={(e) => {
                      if (!confirm("이 모임을 삭제할까요? 관련 참석/대진 정보도 함께 삭제됩니다.")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    <span className="hidden sm:inline">삭제</span>
                  </button>
                </Form>
              </>
            ) : null}
          </div>
        </div>

        {/* 제목 + 모임 정보 */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <h1 className="hero-title">{gathering.title}</h1>
          <span className="badge-hero">{GATHERING_STATUS_LABEL[gathering.status]}</span>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <InfoRow icon={CalendarDays}>
            {em}월 {ed}일 ({weekday}) · {timeText}
          </InfoRow>
          <InfoRow icon={MapPin}>{gathering.location ?? "장소 미정"}</InfoRow>
          <InfoRow icon={LayoutGrid}>
            {gathering.court_numbers
              ? `코트 ${gathering.court_numbers} (${gathering.court_count}면)`
              : `코트 ${gathering.court_count}면`}
          </InfoRow>
          <InfoRow icon={Users}>
            참석 {gathering.attendance?.attending ?? 0}명
            {gathering.max_participants ? ` / 정원 ${gathering.max_participants}명` : ""}
          </InfoRow>
          {gathering.fee > 0 ? (
            <InfoRow icon={Wallet}>
              총 {won(gathering.fee)} · 1인 {won(perPerson)}
            </InfoRow>
          ) : null}
        </div>
        {gathering.description ? (
          <p className="mt-4 whitespace-pre-line rounded-xl bg-white/10 px-4 py-3 text-sm text-white/85">
            {gathering.description}
          </p>
        ) : null}
      </PageHero>

      <PageBody>
        {/* 처리 실패 알림 (참석 투표 정원 초과·마감, 입금 처리 등). 수정 모달이 열려 있으면 모달 안에서 보여준다. */}
        {actionData?.error && !editing ? (
          <p className="alert-error flex items-center gap-2">
            <CircleAlert size={16} className="shrink-0" />
            {actionData.error}
          </p>
        ) : null}

        {/* 참석 (관리자는 투표 없이 현황만) */}
        <section className="card">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title">{user.is_admin ? "참석 현황" : "참석 여부"}</h2>
            {gathering.attendance ? (
              <span className="text-[13px] text-slate-500">
                참석 <b className="font-semibold text-slate-900 dark:text-white">{gathering.attendance.attending}</b> · 불참{" "}
                {gathering.attendance.absent} · 미정 {gathering.attendance.maybe}
              </span>
            ) : null}
          </div>

          {!user.is_admin ? (
            <>
              <Form method="post" className="mt-4 grid grid-cols-3 gap-2">
                <input type="hidden" name="intent" value="vote" />
                {(["attending", "absent", "maybe"] as AttendanceStatus[]).map((s) => {
                  const blocked = s !== "attending" && !canSetAbsence;
                  const selected = me?.status === s;
                  return (
                    <button
                      key={s}
                      name="status"
                      value={s}
                      disabled={blocked}
                      title={blocked ? `모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 바꿀 수 없어요` : undefined}
                      aria-pressed={selected}
                      className={`btn h-11 disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? s === "attending"
                            ? "bg-ball-400 text-slate-900 hover:bg-ball-300"
                            : "bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-200 dark:text-slate-900"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      {selected ? <Check size={16} /> : null}
                      {VOTE_LABEL[s]}
                    </button>
                  );
                })}
              </Form>
              {attendanceLocked ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <Lock size={12} />
                  모임 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참·미정으로 바꿀 수 없어요. 필요하면 관리자에게 문의하세요.
                </p>
              ) : null}
            </>
          ) : null}

          {/* 명단 */}
          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            {gathering.participants.length === 0 ? (
              <p className="text-sm text-slate-400">아직 투표한 사람이 없어요.</p>
            ) : (
              (["attending", "maybe", "absent"] as AttendanceStatus[]).map((s) => {
                const list = gathering.participants.filter((p) => p.status === s);
                if (list.length === 0) return null;
                return (
                  <div key={s}>
                    <p className="mb-1.5 text-xs font-semibold text-slate-400">
                      {VOTE_LABEL[s]} {list.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((p) => (
                        <span
                          key={p.user.id}
                          className={`rounded-lg px-2.5 py-1 text-[13px] ${
                            s === "attending"
                              ? "bg-slate-100 font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                              : "text-slate-400 ring-1 ring-inset ring-slate-200 dark:ring-slate-700"
                          }`}
                        >
                          {p.user.name}
                          {p.user.id === user.id ? <span className="ml-1 text-slate-400">(나)</span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 참가비 (금액은 모두 서버 계산값) */}
        {payment ? (
          <section className="card space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="section-title">참가비</h2>
                <span className="text-[13px] text-slate-500">
                  <b className="font-semibold text-slate-900 dark:text-white">{payment.collected.toLocaleString()}</b>
                  {" / "}
                  {won(payment.expected)}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-ball-500 dark:bg-ball-400" style={{ width: `${collectedPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {gathering.status === "canceled"
                  ? "취소된 모임이라 받을 참가비가 없어요."
                  : payment.attending > 0
                    ? `총 ${won(gathering.fee)} ÷ ${payment.attending}명 = 1인 ${won(perPerson)} (100원 단위 올림) · 입금 ${payment.paid_count}/${payment.attending}명`
                    : "참석자가 정해지면 1인 금액이 계산돼요."}
              </p>
            </div>

            {/* 내 참가비 (참석한 회원 본인) */}
            {myAttending && perPerson > 0 ? (
              <div
                className={`rounded-xl px-4 py-3.5 ${
                  myDue > 0
                    ? "bg-amber-50 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-500/10 dark:ring-amber-500/20"
                    : "bg-ball-50 ring-1 ring-inset ring-ball-300/70 dark:bg-ball-400/10 dark:ring-ball-400/20"
                }`}
              >
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">내 참가비</p>
                {myDue > 0 ? (
                  <p className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-slate-900 dark:text-white">{won(myDue)}</span>
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {me?.paid ? "추가 입금이 필요해요" : "입금해 주세요"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold text-ball-800 dark:text-ball-300">
                    <Check size={18} />
                    입금 완료
                    <span className="text-sm font-normal text-slate-500">({won(me?.paid_amount ?? perPerson)})</span>
                  </p>
                )}
                {myRefund > 0 ? (
                  <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">
                    참석 인원이 늘어 {won(myRefund)}을 더 냈어요. 총무가 돌려줄 예정이에요.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* 입금 계좌 */}
            {gathering.account_number ? (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <Landmark size={18} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-xs text-slate-400">
                    {[gathering.bank, gathering.account_holder].filter(Boolean).join(" · ") || "입금 계좌"}
                  </p>
                  <p className="break-all font-semibold tabular-nums text-slate-900 dark:text-white">
                    {gathering.account_number}
                  </p>
                </div>
                <CopyButton text={gathering.account_number} label="계좌 복사" />
              </div>
            ) : null}

            {/* 참석자별 입금 현황 */}
            {attendees.length === 0 ? (
              <p className="text-sm text-slate-400">참석자가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {attendees.map((p) => {
                  const due = dueOf.get(p.user.id) ?? 0;
                  const refund = refundOf.get(p.user.id) ?? 0;
                  // 입금 뒤 참석 인원이 바뀌어 1인 금액과 입금 금액이 달라진 경우
                  const note =
                    p.paid && due > 0
                      ? `${won(p.paid_amount ?? 0)} 입금 · ${won(due)} 추가로 받아야 해요`
                      : p.paid && refund > 0
                        ? `${won(p.paid_amount ?? 0)} 입금 · ${won(refund)} 돌려줘야 해요`
                        : null;
                  const badge = p.paid ? "badge-lime" : "badge-amber";
                  return (
                    <li key={p.user.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{p.user.name}</span>
                        {p.user.id === user.id ? <span className="ml-1 text-xs text-slate-400">(나)</span> : null}
                        {note ? <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isOrganizer && note ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="toggle_payment" />
                            <input type="hidden" name="user_id" value={p.user.id} />
                            <input type="hidden" name="paid" value="true" />
                            <button
                              className="btn-ghost btn-sm !h-7 !px-2.5 !text-xs"
                              title="차액을 주고받았으면 누르세요. 현재 1인 금액으로 기록됩니다."
                            >
                              차액 정산
                            </button>
                          </Form>
                        ) : null}
                        {isOrganizer ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="toggle_payment" />
                            <input type="hidden" name="user_id" value={p.user.id} />
                            <input type="hidden" name="paid" value={p.paid ? "false" : "true"} />
                            <button className={`${badge} cursor-pointer py-1 transition-opacity hover:opacity-80`}>
                              {p.paid ? "입금" : "미입금"}
                            </button>
                          </Form>
                        ) : (
                          <span className={badge}>{p.paid ? "입금" : "미입금"}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 돌려줄 참가비: 입금 후 불참/취소 */}
            {refundAbsentees.length > 0 ? (
              <div className="rounded-xl bg-sky-50 px-4 py-3 dark:bg-sky-500/10">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                  <Undo2 size={13} />
                  돌려줄 참가비 (입금 후 불참)
                </p>
                <ul className="space-y-1.5 text-sm">
                  {refundAbsentees.map((p) => (
                    <li key={p.user.id} className="flex items-center justify-between gap-2">
                      <span className="text-slate-700 dark:text-slate-200">
                        {p.user.name} · {won(refundOf.get(p.user.id) ?? 0)}
                      </span>
                      {isOrganizer ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle_payment" />
                          <input type="hidden" name="user_id" value={p.user.id} />
                          <input type="hidden" name="paid" value="false" />
                          <button className="btn-ghost btn-sm !h-7 !px-2.5 !text-xs">환불 완료</button>
                        </Form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 총무 도구 */}
            {isOrganizer ? (
              <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                {payment.dues.length > 0 ? (
                  <button
                    type="button"
                    className="btn-secondary w-full"
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
                <p className="text-xs text-slate-400">
                  상태를 누르면 입금/미입금이 바뀌어요. 입금 처리하면 그때의 1인 금액이 기록돼요.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 대진 만들기 (주최자/관리자) */}
        {isOrganizer ? (
          <section className="card">
            <h2 className="section-title">대진 만들기</h2>
            <p className="mt-1 text-[13px] text-slate-500">종목과 방식을 고르면 참석자로 대진을 짜요.</p>
            <Form method="post" className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <input type="hidden" name="intent" value="generate" />
              <select name="match_type" aria-label="종목" className="input col-span-2 sm:w-36" defaultValue="mens_doubles">
                {Object.entries(MATCH_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              <button name="method" value="random" className="btn-ghost h-[42px]">
                <Dices size={16} />
                랜덤
              </button>
              <button name="method" value="skill" className="btn-primary h-[42px]">
                <Scale size={16} />
                실력 균형
              </button>
            </Form>
          </section>
        ) : null}

        {/* 대진표 */}
        {draws.map((draw) => (
          <section key={draw.id} className="card">
            <div className="flex items-center justify-between">
              <h2 className="section-title">
                대진표
                <span className="ml-2 text-[13px] font-normal text-slate-400">
                  {draw.generation_method === "skill" ? "실력 균형" : draw.generation_method === "random" ? "랜덤" : "수동"}
                </span>
              </h2>
              {isOrganizer ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="delete_draw" />
                  <input type="hidden" name="draw_id" value={draw.id} />
                  <button className="icon-btn !h-8 !w-8 hover:!text-red-600" title="대진표 삭제" aria-label="대진표 삭제">
                    <Trash2 size={16} />
                  </button>
                </Form>
              ) : null}
            </div>

            <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {draw.matches.map((m) => (
                <DrawMatchRow key={m.id} match={m} canRecord={isOrganizer} courtLabels={courtLabels} />
              ))}
            </div>
          </section>
        ))}

        {/* 수정 모달 */}
        {editing ? (
          <Modal title="모임 수정" onClose={() => setEditing(false)}>
            <Form method="post" className="space-y-6">
              <input type="hidden" name="intent" value="update_gathering" />
              <FieldGroup title="기본 정보">
                <div>
                  <label className="label" htmlFor="e_title">제목</label>
                  <input id="e_title" name="title" className="input" required defaultValue={gathering.title} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="e_date">날짜</label>
                    <input id="e_date" name="event_date" type="date" className="input" required defaultValue={gathering.event_date} />
                  </div>
                  <div>
                    <label className="label" htmlFor="e_status">상태</label>
                    <select id="e_status" name="status" className="input" defaultValue={gathering.status}>
                      {Object.entries(GATHERING_STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="e_start">시작</label>
                    <select id="e_start" name="start_time" className="input" defaultValue={gathering.start_time?.slice(0, 5) ?? ""}>
                      <option value="">선택 안 함</option>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="e_end">종료</label>
                    <select id="e_end" name="end_time" className="input" defaultValue={gathering.end_time?.slice(0, 5) ?? ""}>
                      <option value="">선택 안 함</option>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="e_location">장소</label>
                  <input id="e_location" name="location" className="input" defaultValue={gathering.location ?? ""} />
                </div>
              </FieldGroup>

              <FieldGroup title="코트 · 인원">
                <div>
                  <label className="label" htmlFor="e_courts">코트 번호</label>
                  <input id="e_courts" name="court_numbers" className="input" placeholder="예: 3, 5 (쉼표로 구분)" defaultValue={gathering.court_numbers ?? ""} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="e_count">코트 면수</label>
                    <input id="e_count" name="court_count" type="number" min="1" className="input" defaultValue={gathering.court_count} />
                  </div>
                  <div>
                    <label className="label" htmlFor="e_max">정원</label>
                    <input id="e_max" name="max_participants" type="number" min="1" className="input" placeholder="제한 없음" defaultValue={gathering.max_participants ?? ""} />
                  </div>
                </div>
              </FieldGroup>

              <FieldGroup title="참가비">
                <div>
                  <label className="label" htmlFor="e_fee">총 참가비 (원)</label>
                  <input id="e_fee" name="fee" type="number" min="0" step="1000" className="input" placeholder="0 = 무료" defaultValue={gathering.fee ?? 0} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label" htmlFor="e_bank">은행</label>
                    <input id="e_bank" name="bank" className="input" placeholder="국민" defaultValue={gathering.bank ?? ""} />
                  </div>
                  <div className="col-span-2">
                    <label className="label" htmlFor="e_account">계좌번호</label>
                    <input id="e_account" name="account_number" className="input" placeholder="123-456-7890" defaultValue={gathering.account_number ?? ""} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="e_holder">예금주</label>
                  <input id="e_holder" name="account_holder" className="input" placeholder="홍길동" defaultValue={gathering.account_holder ?? ""} />
                </div>
              </FieldGroup>

              <div>
                <label className="label" htmlFor="e_desc">메모</label>
                <textarea id="e_desc" name="description" rows={2} className="input" defaultValue={gathering.description ?? ""} />
              </div>

              {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

              <button type="submit" className="btn-primary h-11 w-full" disabled={navigation.state === "submitting"}>
                {navigation.state === "submitting" ? "저장 중…" : "저장"}
              </button>
            </Form>
          </Modal>
        ) : null}
      </PageBody>
    </>
  );
}

/** 모임 정보 한 줄 (아이콘 + 내용, 차콜 띠 위) */
function InfoRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 text-white/90">
      <Icon size={16} className="shrink-0 text-white/50" />
      <span>{children}</span>
    </div>
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
  const recorded = match.result_match_id !== null;
  // 대진의 코트 순번(1-based)을 등록된 실제 코트 번호로 변환
  const courtLabel =
    match.court_number != null && courtLabels[match.court_number - 1]
      ? courtLabels[match.court_number - 1]
      : (match.court_number ?? "-");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="badge-gray">
        코트 {courtLabel} · {match.round_number ?? 1}R
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="font-medium text-slate-800 dark:text-slate-100">{names(match.team1)}</span>
        <span className="text-xs text-slate-400">vs</span>
        <span className="font-medium text-slate-800 dark:text-slate-100">{names(match.team2)}</span>
      </div>

      {recorded ? (
        <span className="badge-lime">
          <Check size={12} />
          기록됨
        </span>
      ) : canRecord ? (
        <Form method="post" className="flex items-center gap-1.5">
          <input type="hidden" name="intent" value="result" />
          <input type="hidden" name="draw_match_id" value={match.id} />
          <input name="team1_score" type="number" min="0" className="input !w-14 !px-2 !py-1.5 text-center" placeholder="0" aria-label="팀1 점수" />
          <span className="text-slate-400">:</span>
          <input name="team2_score" type="number" min="0" className="input !w-14 !px-2 !py-1.5 text-center" placeholder="0" aria-label="팀2 점수" />
          <button className="btn-primary btn-sm">기록</button>
        </Form>
      ) : null}
    </div>
  );
}
