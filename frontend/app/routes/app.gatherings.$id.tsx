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
  useFetcher,
  useLoaderData,
  useNavigation,
  useOutletContext,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import {
  Check,
  CircleAlert,
  Landmark,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Scale,
  Send,
  Share2,
  Shuffle,
  Trash2,
  Undo2,
  UserPlus,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BallBasket } from "~/components/BallBasket";
import { Eyebrow, MemberAvatar } from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { GatheringFeeFields } from "~/components/GatheringFeeFields";
import { FieldGroup, Modal } from "~/components/Modal";
import { BackLink, EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { KIND_LABEL, canSettle, isClubKind, isGuest, isStaff } from "~/lib/club";
import { accountText, won } from "~/lib/format";
import { feeFieldsFromForm } from "~/lib/gathering-form";
import { shareToKakao } from "~/lib/kakao";
import { membersOrEmpty } from "~/lib/guard.server";
import { requireToken } from "~/lib/session.server";
import { GATHERING_STATUS_LABEL, WEEKDAYS, formatOpenAt } from "~/lib/status";
import { ATTENDANCE_LABEL, ATTENDANCE_LOCK_DAYS, isFull, waitingList } from "~/lib/attendance";
import { DRAW_METHOD_LABEL, TIER_CLASS, expectedSplit } from "~/lib/tier";
import {
  MATCH_TYPE_LABEL,
  type AttendanceStatus,
  type CourtBooking,
  type Draw,
  type DrawMatch,
  type GatheringDetail,
  type Me,
  type UserBrief,
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
    const [gathering, draws, members] = await Promise.all([
      api<GatheringDetail>(`/gatherings/${id}`, { token }),
      api<Draw[]>(`/gatherings/${id}/draws`, { token }),
      // 코트 예약자 선택용 (게스트는 빈 목록)
      membersOrEmpty(token),
    ]);
    return json({ gathering, draws, members });
  } catch (err) {
    // 아직 공개 전(403)이거나 지워진(404) 모임은 안내 화면으로
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      throw json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** 공개 전·없는 모임 안내 (예: 카톡으로 받은 다음 주 모임 링크를 금요일 오전 10시 전에 연 경우) */
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
          rounds: Number(formData.get("rounds")) || null,
        },
      });
    } else if (intent === "invite_guest") {
      await api(`/gatherings/${id}/guests`, {
        method: "POST",
        token,
        body: {
          name: String(formData.get("name") ?? ""),
          gender: formData.get("gender") || null,
        },
      });
    } else if (intent === "remove_guest") {
      await api(`/gatherings/${id}/guests/${formData.get("user_id")}`, {
        method: "DELETE",
        token,
      });
    } else if (intent === "set_attendance") {
      await api(
        `/gatherings/${id}/participants/${formData.get("user_id")}/attendance`,
        { method: "PUT", token, body: { status: formData.get("status") } }
      );
    } else if (intent === "toggle_payment") {
      await api(
        `/gatherings/${id}/participants/${formData.get("user_id")}/payment`,
        {
          method: "PUT",
          token,
          body: { paid: formData.get("paid") === "true" },
        }
      );
    } else if (intent === "add_booking") {
      await api(`/gatherings/${id}/court-bookings`, {
        method: "POST",
        token,
        body: {
          booker_id: Number(formData.get("booker_id")),
          amount: Number(formData.get("amount") || 0),
          court_label: String(formData.get("court_label") || "").trim() || null,
        },
      });
    } else if (intent === "reimburse") {
      await api(`/court-bookings/${formData.get("booking_id")}/reimbursement`, {
        method: "PUT",
        token,
        body: { reimbursed: formData.get("reimbursed") === "true" },
      });
    } else if (intent === "delete_booking") {
      await api(`/court-bookings/${formData.get("booking_id")}`, {
        method: "DELETE",
        token,
      });
    } else if (intent === "swap_slot") {
      await api(`/draw-matches/${formData.get("draw_match_id")}/slot`, {
        method: "POST",
        token,
        body: {
          slot: formData.get("slot"),
          user_id: Number(formData.get("user_id")),
        },
      });
    } else if (intent === "delete_draw_match") {
      await api(`/draw-matches/${formData.get("draw_match_id")}`, {
        method: "DELETE",
        token,
      });
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
          // 오테식 모임은 코트요정 칸이 없다(지급 내역에서 맞춘다) → 보내지 않아 그대로 둔다
          ...(formData.has("court_fairy")
            ? { court_fairy: get("court_fairy") || null }
            : {}),
          court_reservers: get("court_reservers") || null,
          court_count: courtNumbers
            ? courtNumbers.split(",").filter((s) => s.trim()).length || 1
            : Number(get("court_count") || 1),
          max_participants: maxParticipants ? Number(maxParticipants) : null,
          ...feeFieldsFromForm(formData),
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


export default function GatheringDetailPage() {
  const { gathering, draws, members } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { user } = useOutletContext<{ user: Me }>();
  const club = isClubKind(gathering.kind);
  const staff = isStaff(user);
  // 게스트는 일정 보기와 참석 투표만 한다 (직접 만든 일정이라도 관리하지 않음, 서버와 같음)
  const guest = isGuest(user);
  // 주최자·관리자. 오테식 모임은 클럽 일정이라 임원진도 관리한다 (서버 권한과 같음).
  const isOrganizer =
    !guest &&
    (gathering.created_by === user.id || user.is_admin || (club && staff));
  // 참석 취소 대신 해 주기(3일 전 마감 뒤 요청 처리): 주최자, 그리고 관리자·임원진·총무는 모든 모임에서
  const canManageAttendance = isOrganizer || staff;
  // 정산(입금 확인·코트비 지급)은 관리자·총무만. 일반 벙개는 만든 벙주도 자기 모임 입금 처리 가능
  const settle = canSettle(user);
  const canPay = settle || (!club && !guest && gathering.created_by === user.id);
  const [editing, setEditing] = useState(false);
  // 직접 바꾸기 중인 대진표 id
  const [editingDraw, setEditingDraw] = useState<number | null>(null);
  // 등록된 실제 코트 번호 ("3, 5" → ["3","5"]). 대진의 코트 순번을 실제 번호로 변환하는 데 사용.
  const courtLabels = gathering.court_numbers
    ? gathering.court_numbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // 참석 변경 마감: 모임 3일 전부터는 참석자가 불참으로 못 바꿈(운영진에게 요청)
  const daysUntilEvent = Math.round(
    (new Date(gathering.event_date + "T00:00:00").getTime() -
      new Date(new Date().toDateString()).getTime()) /
      86400000
  );
  const attendanceLocked = daysUntilEvent <= ATTENDANCE_LOCK_DAYS;

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
  // 게스트 초대(이름만): 참석·대기 중인 회원, 벙주, 운영진. 회칙대로 게스트 투표 시각부터(운영진은 언제든)
  const canInvite =
    !guest &&
    (gathering.status === "planned" || gathering.status === "ongoing") &&
    (staff ||
      gathering.created_by === user.id ||
      myAttending ||
      me?.status === "waiting");
  const inviteOpensAt =
    !staff && !gathering.guest_vote_open ? gathering.guest_vote_open_at : null;
  // 대기열: 정원이 차면 참석 신청은 대기, 자리가 나면 순서대로 참석
  const waiting = waitingList(gathering.participants);
  const full = isFull(gathering, attendees.length);
  const myRank = waiting.findIndex((p) => p.user.id === user.id) + 1;
  // 관리자·임원진·총무는 마감 뒤에도 본인 참석을 직접 취소할 수 있다 (서버와 같음)
  const absentLocked = attendanceLocked && myAttending && !staff;
  // 게스트는 일정은 정회원과 함께 보지만, 참석 투표는 모임 3일 전 0시부터 (직접 만든 일정은 바로)
  const guestVoteLocked =
    !user.is_admin &&
    user.member_type === "guest" &&
    !gathering.guest_vote_open &&
    gathering.created_by !== user.id;
  const myDue = me ? dueOf.get(me.user.id) ?? 0 : 0;
  const myRefund = me ? refundOf.get(me.user.id) ?? 0 : 0;
  // 낼 돈이 있는 참석자: 일반 벙개는 전원, 오테식 모임은 게스트(이미 입금 기록이 있는 사람 포함)
  const payers = club
    ? attendees.filter((p) => p.user.member_type === "guest" || p.paid)
    : attendees;
  const myNominal = !me
    ? 0
    : club
    ? me.user.member_type === "guest"
      ? gathering.guest_fee
      : 0
    : perPerson;
  const feeBreakdown =
    gathering.court_fee || gathering.ball_fee
      ? `코트 ${won(gathering.court_fee)} + 볼 ${won(gathering.ball_fee)}`
      : won(gathering.fee);
  // 일반 벙개 ↔ 오테식 모임 전환은 정리할 기록이 없을 때만 (서버 규칙과 같음)
  const switchBlock = gathering.participants.some((p) => p.paid)
    ? "입금 기록이 있어요"
    : gathering.court_bookings.length
    ? "코트 예약이 있어요"
    : undefined;
  const kindLocks = switchBlock
    ? club
      ? { flash: switchBlock }
      : { club_regular: switchBlock, club_flash: switchBlock }
    : {};
  const account = accountText(gathering);
  const dateLine = `📅 ${gathering.event_date}${
    gathering.start_time ? ` ${gathering.start_time.slice(0, 5)}` : ""
  }${gathering.end_time ? `~${gathering.end_time.slice(0, 5)}` : ""}`;
  const path = `/app/gatherings/${gathering.id}`;

  // 카카오 공유 메시지 (오픈톡방에 보낼 모임 요약)
  const shareBase = [
    `🎾 [${KIND_LABEL[gathering.kind]}] ${gathering.title}`,
    dateLine,
    gathering.location ? `📍 ${gathering.location}` : "",
    `🟩 코트 ${
      gathering.court_numbers
        ? `${gathering.court_numbers} (${gathering.court_count}면)`
        : `${gathering.court_count}면`
    }`,
    club
      ? `💸 회비 지출${
          gathering.guest_fee > 0
            ? ` (게스트 참가비 ${won(gathering.guest_fee)})`
            : ""
        }`
      : gathering.fee > 0
      ? `💰 참가비 총 ${won(gathering.fee)} (1인 ${won(perPerson)})`
      : "",
    account ? `🏦 ${account}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 총무용 미입금 안내 메시지
  const remindBase = [
    `💰 ${gathering.title} ${club ? "게스트비" : "참가비"} 안내`,
    dateLine,
    club ? `게스트 1인 ${won(gathering.guest_fee)}` : `1인 ${won(perPerson)}`,
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
    ? payment.payer_count > 0 && payment.payer_count <= 20
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

      {/* 공개 시점 안내: 임원진에게는 공개 전 상태, 정회원에게는 게스트 투표 시작 시점
          (게스트 본인에게는 아래 참석 카드에서 투표 시작 시점을 알려 준다) */}
      {gathering.member_open_at && gathering.guest_vote_open_at && user.member_type !== "guest" &&
      (!gathering.open_to_members || !gathering.guest_vote_open) ? (
        <p className="flex items-start gap-2 rounded-2xl bg-house-lav/30 px-4 py-3 text-sm font-semibold">
          <Lock size={16} className="mt-0.5 shrink-0" />
          {!gathering.open_to_members
            ? `${staff ? "아직 임원진만 보는 일정이에요." : "직접 만든 일정이라 먼저 보여요."} 정회원·게스트에게는 ${formatOpenAt(gathering.member_open_at)}에 공개되고, 게스트 투표는 ${formatOpenAt(gathering.guest_vote_open_at)}부터 열려요.`
            : `게스트 투표는 ${formatOpenAt(gathering.guest_vote_open_at)}부터 열려요. 그 전에는 정회원만 참석 투표를 할 수 있어요.`}
        </p>
      ) : null}

      <div className="detail-top-grid">
        <section className="tile-orange min-h-[285px] sm:p-7">
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>OUR NEXT GATHERING</Eyebrow>
            <span className="flex flex-wrap gap-1.5">
              <span className="chip-ink">{KIND_LABEL[gathering.kind]}</span>
              <span className="chip-white !bg-white/25">{statusText}</span>
            </span>
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
            {gathering.court_reservers ? (
              <p className="pl-6">예약자명 {gathering.court_reservers}</p>
            ) : null}
            {gathering.court_fairy ? (
              <p className="pl-6">코트요정 {gathering.court_fairy}</p>
            ) : null}
            {club ? (
              <p className="pl-6">
                회비 지출
                {gathering.court_total > 0
                  ? ` · 코트비 ${won(gathering.court_total)}`
                  : ""}
              </p>
            ) : gathering.fee > 0 ? (
              <p className="pl-6">참가비 총 {feeBreakdown}</p>
            ) : null}
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
                불참 {gathering.attendance?.absent ?? 0} · 대기{" "}
                {gathering.attendance?.waiting ?? 0}
                {gathering.attendance?.maybe
                  ? ` · 미정 ${gathering.attendance.maybe}`
                  : ""}
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
                {me?.status === "waiting" ? (
                  <>
                    <span
                      role="status"
                      className="btn-primary pointer-events-none h-11 flex-1 px-2 text-sm"
                    >
                      <Check size={16} />
                      대기 {myRank}번째
                    </span>
                    <button
                      name="status"
                      value="absent"
                      disabled={navigation.state !== "idle"}
                      className="btn-ghost h-11 flex-1 px-2 text-sm"
                    >
                      대기 취소
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      name="status"
                      value="attending"
                      disabled={guestVoteLocked || navigation.state !== "idle"}
                      aria-pressed={myAttending}
                      className={`${
                        myAttending ? "btn-primary" : "btn-ghost"
                      } h-11 flex-1 px-2 text-sm`}
                    >
                      {myAttending ? <Check size={16} /> : null}
                      {full && !myAttending ? "대기 신청" : "참석"}
                    </button>
                    <button
                      name="status"
                      value="absent"
                      disabled={guestVoteLocked || absentLocked || navigation.state !== "idle"}
                      title={
                        absentLocked
                          ? `모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참으로 바꿀 수 없어요`
                          : undefined
                      }
                      aria-pressed={me?.status === "absent"}
                      className={`${
                        me?.status === "absent" ? "btn-primary" : "btn-ghost"
                      } h-11 flex-1 px-2 text-sm disabled:cursor-not-allowed`}
                    >
                      {me?.status === "absent" ? <Check size={16} /> : null}
                      불참
                    </button>
                  </>
                )}
              </Form>
              {guestVoteLocked && gathering.guest_vote_open_at ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-bold">
                  <Lock size={12} className="shrink-0" />
                  게스트 투표는 {formatOpenAt(gathering.guest_vote_open_at)}부터 열려요. 지금은
                  일정만 볼 수 있어요.
                </p>
              ) : me?.status === "waiting" ? (
                <p className="mt-3 text-xs font-bold">
                  자리가 나면 대기 순서대로 자동으로 참석이 돼요.
                </p>
              ) : full && !myAttending ? (
                <p className="mt-3 text-xs font-bold">
                  정원이 다 찼어요. 대기 신청하면 자리가 날 때 순서대로 참석이 돼요
                  {waiting.length ? ` (지금 대기 ${waiting.length}명)` : ""}.
                </p>
              ) : absentLocked ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-bold">
                  <Lock size={12} className="shrink-0" />
                  모임 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참으로 바꿀 수 없어요.
                  필요하면 운영진에게 문의하세요.
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
          className={`card detail-attendees ${
            club || payment ? "" : "lg:col-span-2"
          }`}
        >
          <h2 className="section-title">함께하는 식구들</h2>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {attendees.length
              ? `${attendees.length}명이 함께해요`
              : "아직 참석자가 없어요"}
          </p>
          {canManageAttendance && attendanceLocked && attendees.length ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-2xl bg-house-yellow/25 px-3.5 py-2.5 text-xs font-semibold leading-relaxed">
              <Lock size={12} className="mt-0.5 shrink-0" />
              모임 {ATTENDANCE_LOCK_DAYS}일 전부터는 회원이 직접 취소할 수 없어요.
              취소 요청을 받으면 이름 아래 ‘참석 취소’를 눌러 주세요.
            </p>
          ) : null}
          {canInvite ? <GuestInviteBox opensAt={inviteOpensAt} /> : null}
          {!gathering.participants.length ? (
            <p className="py-7 text-sm text-slate-500 dark:text-slate-400">
              아직 투표한 사람이 없어요.
            </p>
          ) : (
            (["attending", "waiting", "absent", "maybe"] as AttendanceStatus[]).map(
              (status) => {
                const people =
                  status === "waiting"
                    ? waiting
                    : gathering.participants.filter((p) => p.status === status);
                if (!people.length) return null;
                return (
                  <div key={status}>
                    {status !== "attending" && (
                      <p className="mt-6 border-t border-slate-200 pt-4 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {ATTENDANCE_LABEL[status]} {people.length}명
                        {status === "waiting" ? " · 자리가 나면 순서대로 참석" : ""}
                      </p>
                    )}
                    <div className="player-grid">
                      {people.map((p, i) => (
                        <div
                          key={p.user.id}
                          className="flex min-w-0 flex-col items-center gap-1.5"
                        >
                          <ProfileLink id={p.user.id} invited={!!p.user.invited_by_id}>
                            <MemberAvatar
                              user={p.user}
                              className={
                                status === "attending"
                                  ? "!h-11 !w-11"
                                  : status === "waiting"
                                  ? "!h-10 !w-10"
                                  : "!h-9 !w-9 opacity-60"
                              }
                            />
                            <strong className="max-w-full truncate text-xs">
                              {status === "waiting" ? `${i + 1}. ` : ""}
                              {p.user.name}
                              {p.user.id === user.id && (
                                <small className="ml-1 text-[10px] font-normal text-slate-500">
                                  나
                                </small>
                              )}
                            </strong>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              {p.user.invited_by_id
                                ? `게스트 · ${p.user.invited_by_name ?? ""} 초대`
                                : `${p.user.member_type === "guest" ? "게스트 · " : ""}${
                                    p.user.ntrp ? `NTRP ${p.user.ntrp}` : "NTRP 미입력"
                                  }`}
                            </span>
                          </ProfileLink>
                          {p.user.invited_by_id &&
                          (canManageAttendance || p.user.invited_by_id === user.id) &&
                          (status === "attending" || status === "waiting") &&
                          !(status === "attending" && attendanceLocked && !canManageAttendance) ? (
                            <Form
                              method="post"
                              onSubmit={(e) => {
                                if (
                                  !confirm(
                                    `${p.user.name}님 초대를 취소할까요?${
                                      status === "attending" && waiting.length
                                        ? `\n대기 1번 ${waiting[0].user.name}님이 참석으로 올라가요.`
                                        : ""
                                    }`
                                  )
                                )
                                  e.preventDefault();
                              }}
                            >
                              <input type="hidden" name="intent" value="remove_guest" />
                              <input type="hidden" name="user_id" value={p.user.id} />
                              <button
                                className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-[#C2361F] hover:text-[#C2361F] dark:border-slate-600 dark:text-slate-300"
                                aria-label={`${p.user.name} 초대 취소`}
                              >
                                초대 취소
                              </button>
                            </Form>
                          ) : !p.user.invited_by_id &&
                          canManageAttendance &&
                          (status === "attending" || status === "waiting") ? (
                            <Form
                              method="post"
                              onSubmit={(e) => {
                                if (
                                  !confirm(
                                    status === "attending"
                                      ? `${p.user.name}님의 참석을 취소할까요? 불참으로 바뀌어요.${
                                          waiting.length
                                            ? `\n대기 1번 ${waiting[0].user.name}님이 참석으로 올라가요.`
                                            : ""
                                        }`
                                      : `${p.user.name}님의 대기를 취소할까요?`
                                  )
                                )
                                  e.preventDefault();
                              }}
                            >
                              <input type="hidden" name="intent" value="set_attendance" />
                              <input type="hidden" name="user_id" value={p.user.id} />
                              <input type="hidden" name="status" value="absent" />
                              <button
                                className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-[#C2361F] hover:text-[#C2361F] dark:border-slate-600 dark:text-slate-300"
                                aria-label={`${p.user.name} ${status === "attending" ? "참석" : "대기"} 취소`}
                              >
                                {status === "attending" ? "참석 취소" : "대기 취소"}
                              </button>
                            </Form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
            )
          )}
        </section>

        {club || payment ? (
          <div className="detail-payments space-y-4">
            {/* 오테식 모임: 회비 지출(코트비 지급) */}
            {club ? (
              <CourtExpenseTile
                total={gathering.court_total}
                bookings={gathering.court_bookings}
                members={members}
                staff={settle}
                userId={user.id}
              />
            ) : null}
            {/* 참가비 (금액은 모두 서버 계산값). 오테식 모임은 게스트비 */}
            {payment ? (
              <section className="tile-yellow space-y-4">
                <Eyebrow>{club ? "GUEST FEE" : "MATCH DUES"}</Eyebrow>
                <div className="detail-payment-heading">
                  <div className="min-w-0">
                    <h2 className="tile-title">
                      {club ? "게스트비 정산" : "참가비 정산"}
                    </h2>
                    <p className="tile-sub">
                      {gathering.status === "canceled"
                        ? "취소된 모임이라 받을 돈이 없어요"
                        : club
                        ? payment.payer_count > 0
                          ? `게스트 ${payment.payer_count}명 · 회원은 회비로 내요`
                          : "참석한 게스트가 없어요"
                        : payment.attending > 0
                        ? `${feeBreakdown} ÷ ${payment.attending}명`
                        : "참석자가 정해지면 계산돼요"}
                    </p>
                  </div>
                  <p className="shrink-0 font-display text-[30px] font-extrabold leading-none tracking-[-0.05em] sm:text-[34px]">
                    {won(club ? gathering.guest_fee : perPerson)}
                  </p>
                </div>

                <div>
                  {showSegments ? (
                    <div className="seg">
                      {Array.from({ length: payment.payer_count }, (_, i) => (
                        <i
                          key={i}
                          className={i < payment.paid_count ? "on" : ""}
                        />
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
                      입금 {payment.paid_count} / {payment.payer_count}명
                    </span>
                    <span>
                      {payment.collected.toLocaleString()} /{" "}
                      {won(payment.expected)}
                    </span>
                  </p>
                </div>

                {/* 내 참가비 (참석한 회원 본인) */}
                {myAttending && myNominal > 0 ? (
                  <div className="rounded-2xl bg-white/70 px-4 py-3.5">
                    <p className="text-xs font-bold">
                      {club ? "내 게스트비" : "내 참가비"}
                    </p>
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
                          ({won(me?.paid_amount ?? myNominal)})
                        </span>
                      </p>
                    )}
                    {myRefund > 0 ? (
                      <p className="mt-1 text-xs font-semibold">
                        참석 인원이 늘어 {won(myRefund)}을 더 냈어요. 총무가
                        돌려줄 예정이에요.
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

                {/* 참석자별 입금 현황 (오테식 모임은 게스트만) */}
                {payers.length === 0 ? (
                  <p className="text-sm font-semibold">
                    {club ? "참석한 게스트가 없어요." : "참석자가 없어요."}
                  </p>
                ) : (
                  <ul className="tile-rows">
                    {payers.map((p) => {
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
                            {p.user.invited_by_name ? (
                              <span className="ml-1 text-xs font-semibold">
                                ({p.user.invited_by_name} 초대)
                              </span>
                            ) : null}
                            {note ? (
                              <p className="text-xs font-semibold">{note}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {canPay && note ? (
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
                            {canPay ? (
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
                          {canPay ? (
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
                {canPay ? (
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
                      {club
                        ? "상태를 누르면 입금/미입금이 바뀌어요. 게스트비는 회비 통장으로 받아요."
                        : "상태를 누르면 입금/미입금이 바뀌어요. 입금 처리하면 그때의 1인 금액이 기록돼요. 1인 금액은 100원 단위로 올림해요."}
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
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
            <DrawGenerator gathering={gathering} attendees={attendees} />
          ) : null}

          {/* 대진표 */}
          {draws.map((draw) => (
            <div key={draw.id}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
                <p className="text-[15px] font-extrabold">
                  대진표 ·{" "}
                  {DRAW_METHOD_LABEL[draw.generation_method] ?? "수동"}
                  {user.is_admin && !club ? (
                    <span className="ml-2 align-middle text-xs font-semibold text-slate-500">
                      일반 벙개라 티어에 반영되지 않아요
                    </span>
                  ) : null}
                </p>
                <div className="flex items-center gap-1">
                  {(isOrganizer || (myAttending && !guest)) &&
                  draw.matches.some((m) => m.result_match_id === null) ? (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingDraw(editingDraw === draw.id ? null : draw.id)
                      }
                      aria-pressed={editingDraw === draw.id}
                      className={`${
                        editingDraw === draw.id ? "btn-primary" : "btn-ghost"
                      } btn-sm`}
                    >
                      {editingDraw === draw.id ? (
                        <>
                          <Check size={14} />
                          다 바꿨어요
                        </>
                      ) : (
                        <>
                          <Shuffle size={14} />
                          직접 바꾸기
                        </>
                      )}
                    </button>
                  ) : null}
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
              </div>
              {editingDraw === draw.id ? (
                <p className="mt-3 rounded-2xl bg-house-yellow/25 px-4 py-3 text-xs font-semibold">
                  선수 이름을 눌러 바꿀 사람을 고르세요. 같은 라운드에 뛰는 사람을 고르면 두
                  사람 자리가 서로 바뀌고, 쉬던 사람을 고르면 원래 선수가 쉬어요. 결과가 입력된
                  경기는 바꿀 수 없어요.
                </p>
              ) : null}
              <div className="draw-grid">
                {draw.matches.map((m) => (
                  <DrawMatchRow
                    key={m.id}
                    match={m}
                    canRecord={isOrganizer}
                    courtLabels={courtLabels}
                    club={club}
                    edit={
                      editingDraw === draw.id
                        ? {
                            attendees: attendees.map((p) => p.user),
                            seats: roundSeats(draw.matches, m.round_number, courtLabels),
                            canDelete: isOrganizer,
                          }
                        : null
                    }
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
          <Form method="post" className="space-y-7">
            <GatheringFeeFields
              idPrefix="e_"
              canCreateClub={staff}
              lockedKinds={kindLocks}
              defaults={{
                kind: gathering.kind,
                // 예전 모임(총액만 있음)은 총액을 코트비 칸에 보여 줘서 금액이 그대로 유지되게 한다
                court_fee:
                  gathering.court_fee ||
                  (gathering.ball_fee ? 0 : gathering.fee),
                ball_fee: gathering.ball_fee,
                guest_fee: club ? gathering.guest_fee : 5000,
                // 지금 종류의 계좌만 채우고, 다른 종류로 바꾸면 비운다
                accounts: {
                  flash: club ? NO_ACCOUNT : gathering,
                  club: club ? gathering : NO_ACCOUNT,
                },
              }}
            >
              {(kind) => (
                <>
                  <FieldGroup title="언제 · 어디서">
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
                    <div className="grid gap-3 sm:grid-cols-2">
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
                        placeholder="예: 3, 5"
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
                          inputMode="numeric"
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
                          inputMode="numeric"
                          min="1"
                          className="input"
                          placeholder="제한 없음"
                          defaultValue={gathering.max_participants ?? ""}
                        />
                      </div>
                    </div>
                    <p className="-mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {isClubKind(kind) ? "회칙상 코트 1면에 6명이에요. " : ""}
                      정원이 차면 다음 신청은 대기로 받아요.
                    </p>
                    {isClubKind(kind) ? (
                      <p className="rounded-2xl bg-house-green/20 px-4 py-3 text-[13px] font-medium leading-relaxed">
                        <strong>코트요정</strong>은 모임 화면의{" "}
                        <strong>‘회비 지출’</strong> 카드에서 회원으로 추가해요.
                        추가하면 정산 탭에 올라가 총무가 코트비를 보내요.
                      </p>
                    ) : (
                      <div>
                        <label className="label" htmlFor="e_fairy">
                          코트요정 <span className="font-medium text-slate-400">(선택)</span>
                        </label>
                        <input
                          id="e_fairy"
                          name="court_fairy"
                          className="input"
                          placeholder="코트를 잡아 준 사람"
                          maxLength={200}
                          defaultValue={gathering.court_fairy ?? ""}
                        />
                      </div>
                    )}
                    <div>
                      <label className="label" htmlFor="e_reservers">
                        예약자명{" "}
                        <span className="font-medium text-slate-400">
                          (선택)
                        </span>
                      </label>
                      <input
                        id="e_reservers"
                        name="court_reservers"
                        className="input"
                        placeholder="예: 3·5번 장미주, 2번 김다빈"
                        maxLength={300}
                        defaultValue={gathering.court_reservers ?? ""}
                      />
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        코트에서 말할 예약 이름이에요. 모임 화면에 함께 보여요.
                      </p>
                    </div>
                  </FieldGroup>
                </>
              )}
            </GatheringFeeFields>

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

            <div className="modal-actions space-y-3">
              {actionData?.error ? (
                <p className="alert-error">{actionData.error}</p>
              ) : null}
              <button
                type="submit"
                className="btn-primary h-12 w-full"
                disabled={navigation.state === "submitting"}
              >
                {navigation.state === "submitting" ? "저장 중…" : "저장"}
              </button>
            </div>
            {/* 맨 앞에 두면 space-y 간격이 첫 칸 위에 생긴다 */}
            <input type="hidden" name="intent" value="update_gathering" />
          </Form>
        </Modal>
      ) : null}
    </PageBody>
  );
}

const NO_ACCOUNT = { bank: null, account_number: null, account_holder: null };

/** "2026-10-12T10:00:00" → "10/12" */
const shortDate = (iso: string) =>
  `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/**
 * 이름만 적어 게스트 초대 (가입하지 않은 분). 게스트와 똑같이 자리를 쓰고(꽉 차면 대기)
 * 오테식 모임은 게스트비를 낸다. 게스트 투표 시각 전이면 언제부터인지 안내만 한다.
 */
function GuestInviteBox({ opensAt }: { opensAt: string | null }) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  // 초대가 끝나면 이름 칸을 비워 다음 사람을 바로 적게
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.state, fetcher.data]);

  if (opensAt) {
    return (
      <p className="mt-4 flex items-start gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <UserPlus size={13} className="mt-px shrink-0" />
        게스트 초대는 {formatOpenAt(opensAt)}부터 할 수 있어요.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm mt-4"
        onClick={() => setOpen(true)}
      >
        <UserPlus size={14} />
        게스트 초대
      </button>
    );
  }
  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      className="mt-4 space-y-2.5 rounded-2xl bg-slate-100 p-3.5 dark:bg-slate-800/60"
    >
      <input type="hidden" name="intent" value="invite_guest" />
      <p className="text-xs font-semibold leading-relaxed text-slate-600 dark:text-slate-300">
        가입하지 않은 분을 이름으로 초대해요. 게스트와 똑같이 자리를 쓰고(꽉 차면
        대기), 오테식 모임은 게스트비를 내요.
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          name="name"
          required
          maxLength={30}
          placeholder="게스트 이름"
          aria-label="게스트 이름"
          className="input"
        />
        <select name="gender" aria-label="게스트 성별" className="input w-24" defaultValue="">
          <option value="">성별</option>
          <option value="male">남성</option>
          <option value="female">여성</option>
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          닫기
        </button>
        <button className="btn-primary btn-sm" disabled={busy}>
          <UserPlus size={14} />
          {busy ? "초대하는 중…" : "초대하기"}
        </button>
      </div>
      {fetcher.state === "idle" && fetcher.data?.error ? (
        <p role="alert" className="alert-error">
          {fetcher.data.error}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

/** 회원 프로필로 가는 링크. 게스트는 회원 프로필을 볼 수 없어 링크 없이 보여 준다. */
function ProfileLink({
  id,
  invited = false,
  className = "",
  children,
}: {
  id: number;
  /** 이름만 적어 초대한 게스트: 프로필이 없어 링크 없이 */
  invited?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { user } = useOutletContext<{ user: Me }>();
  return isGuest(user) || invited ? (
    <div className={`profile-static ${className}`}>{children}</div>
  ) : (
    <Link to={`/app/members/${id}`} className={className}>
      {children}
    </Link>
  );
}

/**
 * 오테식 모임의 회비 지출: 코트 예약자별 코트비와 지급 여부.
 * 정산 담당(관리자·총무)은 예약자를 추가하고, 계좌를 복사해 송금한 뒤 지급 완료를 누른다.
 */
function CourtExpenseTile({
  total,
  bookings,
  members,
  staff,
  userId,
}: {
  total: number;
  bookings: CourtBooking[];
  members: UserBrief[];
  staff: boolean;
  userId: number;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "add_booking";
  const pending = bookings.filter((b) => !b.reimbursed);
  return (
    <section className="tile-green space-y-4">
      <Eyebrow>CLUB EXPENSE</Eyebrow>
      <div className="detail-payment-heading">
        <div className="min-w-0">
          <h2 className="tile-title">회비 지출</h2>
          <p className="tile-sub">
            코트비는 회비에서 나가요. 회원은 따로 낼 돈이 없어요.
          </p>
        </div>
        <p className="shrink-0 font-display text-[30px] font-extrabold leading-none tracking-[-0.05em] sm:text-[34px]">
          {won(total)}
        </p>
      </div>

      {bookings.length === 0 ? (
        <p className="text-sm font-semibold">
          {staff
            ? "코트요정(코트를 잡고 코트비를 낸 회원)을 추가하면 정산 탭에 올라가요."
            : "아직 등록된 코트 예약이 없어요."}
        </p>
      ) : (
        <ul className="tile-rows">
          {bookings.map((b) => (
            <li key={b.id} className="!block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-bold">{b.booker_name}</span>
                  {b.booker?.id === userId ? (
                    <span className="ml-1 text-xs font-semibold">(나)</span>
                  ) : null}
                  {b.court_label ? (
                    <span className="ml-1.5 text-xs font-semibold">
                      · {b.court_label}
                    </span>
                  ) : null}
                  <p className="mt-0.5 text-xs font-semibold">
                    {b.reimbursed
                      ? `지급 완료${
                          b.reimbursed_by ? ` · ${b.reimbursed_by.name}` : ""
                        }${
                          b.reimbursed_at
                            ? ` · ${shortDate(b.reimbursed_at)}`
                            : ""
                        }`
                      : "지급 대기"}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <strong className="font-display text-lg font-extrabold tracking-[-0.03em]">
                    {won(b.amount)}
                  </strong>
                  <span className={b.reimbursed ? "chip-ink" : "chip-line"}>
                    {b.reimbursed ? "지급" : "대기"}
                  </span>
                </span>
              </div>
              {staff && !b.reimbursed ? (
                <div className="mt-2.5 space-y-2">
                  {b.account?.account_number ? (
                    <p className="flex items-start gap-1.5 text-xs font-semibold">
                      <Landmark size={14} className="mt-px shrink-0" />
                      <span className="break-all">
                        {accountText(b.account)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs font-semibold">
                      환급 계좌 미등록 · 카톡으로 정산해 주세요
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {b.account?.account_number ? (
                      <CopyButton
                        text={b.account.account_number}
                        label="계좌 복사"
                        tone="ink"
                      />
                    ) : null}
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (
                          !confirm(
                            `${b.booker_name}님에게 코트비 ${won(b.amount)}을 보냈나요?\n확인을 누르면 지급 완료로 기록돼요.`
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="reimburse" />
                      <input type="hidden" name="booking_id" value={b.id} />
                      <input type="hidden" name="reimbursed" value="true" />
                      <button className="btn-ink btn-sm">
                        <Check size={14} />
                        지급 완료
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (
                          !confirm(`${b.booker_name}님의 코트 예약을 지울까요?`)
                        )
                          e.preventDefault();
                      }}
                    >
                      <input
                        type="hidden"
                        name="intent"
                        value="delete_booking"
                      />
                      <input type="hidden" name="booking_id" value={b.id} />
                      <button
                        className="icon-btn !h-8 !w-8 !text-ink hover:!bg-ink/10"
                        aria-label={`${b.booker_name} 코트 예약 삭제`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </Form>
                  </div>
                </div>
              ) : staff && b.reimbursed ? (
                <Form
                  method="post"
                  className="mt-2"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `${b.booker_name}님 코트비 ${won(b.amount)}의 지급 기록을 취소할까요?\n정산 탭 '지급할 코트비'에 다시 올라가요.`
                      )
                    )
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="reimburse" />
                  <input type="hidden" name="booking_id" value={b.id} />
                  <input type="hidden" name="reimbursed" value="false" />
                  <button className="chip-white cursor-pointer transition-opacity hover:opacity-80">
                    <Undo2 size={12} />
                    지급 취소
                  </button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {staff ? (
        <Form method="post" className="court-booking-form">
          <input type="hidden" name="intent" value="add_booking" />
          <p className="col-span-full text-xs font-extrabold">
            코트요정 추가
          </p>
          <select
            name="booker_id"
            className="tile-input col-span-full sm:col-span-1"
            aria-label="코트요정"
            required
            defaultValue=""
          >
            <option value="" disabled>
              코트요정
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            name="court_label"
            className="tile-input"
            placeholder="코트 (예: 3번)"
            aria-label="코트"
          />
          <input
            name="amount"
            type="number"
            min="100"
            step="100"
            className="tile-input"
            placeholder="코트비"
            aria-label="코트비"
            required
          />
          <button className="btn-ink btn-sm col-span-full" disabled={busy}>
            <Plus size={14} />
            {busy ? "추가 중…" : "추가"}
          </button>
        </Form>
      ) : null}

      {pending.length > 0 ? (
        <p className="text-xs font-semibold">
          지급 대기 {pending.length}건 ·{" "}
          {won(pending.reduce((s, b) => s + b.amount, 0))}
          {staff ? " · 계좌로 보낸 뒤 지급 완료를 눌러 주세요." : ""}
        </p>
      ) : null}
    </section>
  );
}

// 6게임 한 판을 30분으로 본다 (서버 matchmaking.MINUTES_PER_GAME 과 같게). 2시간이면 4라운드.
const MINUTES_PER_GAME = 30;
const DEFAULT_ROUNDS = 4;

function suggestedRounds(start: string | null, end: string | null) {
  if (!start || !end) return DEFAULT_ROUNDS;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let minutes = toMin(end) - toMin(start);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.max(1, Math.min(12, Math.floor(minutes / MINUTES_PER_GAME)));
}

function durationText(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}시간` : "", m ? `${m}분` : ""].filter(Boolean).join(" ");
}

const GENERATE_TYPES: { value: string; label: string }[] = [
  { value: "auto", label: "자동 구성" },
  { value: "mens_doubles", label: "남복만" },
  { value: "womens_doubles", label: "여복만" },
  { value: "mixed_doubles", label: "혼복만" },
  { value: "singles", label: "단식" },
];

function DrawGenerator({
  gathering,
  attendees,
}: {
  gathering: GatheringDetail;
  attendees: GatheringDetail["participants"];
}) {
  const suggested = suggestedRounds(gathering.start_time, gathering.end_time);
  const [matchType, setMatchType] = useState("auto");
  const [rounds, setRounds] = useState(suggested);
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "generate";

  // 라운드마다 코트에 들어가는 인원과 1인 게임 수 (서버와 같은 규칙으로 미리 보여 준다)
  const men = attendees.filter((p) => p.user.gender === "male").length;
  const women = attendees.filter((p) => p.user.gender === "female").length;
  const courts = Math.max(gathering.court_count, 1);
  const range = (seats: number, people: number) => {
    const low = people ? Math.floor(seats / people) : 0;
    const high = people ? Math.ceil(seats / people) : 0;
    return low === high ? `${low}` : `${low}~${high}`;
  };
  let matchesPerRound: number;
  let estimate: string;
  if (matchType === "mixed_doubles") {
    matchesPerRound = Math.min(courts, Math.floor(men / 2), Math.floor(women / 2));
    const seats = matchesPerRound * 2 * rounds;
    estimate = `남 ${men}명 ${range(seats, men)}게임 · 여 ${women}명 ${range(seats, women)}게임`;
  } else {
    const unit = matchType === "singles" ? 2 : 4;
    let pool = attendees.length;
    let who = "참석";
    if (matchType === "mens_doubles" && men >= 4) [pool, who] = [men, "남자"];
    if (matchType === "womens_doubles" && women >= 4) [pool, who] = [women, "여자"];
    matchesPerRound = Math.min(courts, Math.floor(pool / unit));
    estimate = `${who} ${pool}명 · 1인 ${range(matchesPerRound * unit * rounds, pool)}게임`;
  }
  const noGender = attendees.filter((p) => !p.user.gender);

  return (
    <Form method="post" className="space-y-2.5 sm:max-w-lg">
      <input type="hidden" name="intent" value="generate" />
      <div className="grid grid-cols-2 gap-2">
        <select
          name="match_type"
          aria-label="종목"
          className="input"
          value={matchType}
          onChange={(e) => setMatchType(e.target.value)}
        >
          {GENERATE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          name="rounds"
          aria-label="라운드 수"
          className="input"
          value={rounds}
          onChange={(e) => setRounds(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}라운드
            </option>
          ))}
        </select>
        <button
          name="method"
          value="random"
          className="btn-primary"
          disabled={busy || matchesPerRound === 0}
        >
          <Shuffle size={16} />
          다양하게
        </button>
        <button
          name="method"
          value="balanced"
          className="btn-ghost"
          disabled={busy || matchesPerRound === 0}
        >
          <Scale size={16} />
          실력 밸런스
        </button>
      </div>
      <p className="text-[13px] font-bold">
        {matchesPerRound === 0
          ? "참석 인원이 부족해 이 종목으로는 대진을 짤 수 없어요."
          : `코트 ${matchesPerRound}면 × ${rounds}라운드(${durationText(
              rounds * MINUTES_PER_GAME
            )}) → ${estimate}`}
      </p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        6게임 한 판 30분 기준으로{" "}
        {gathering.start_time && gathering.end_time
          ? `모임 시간(${gathering.start_time.slice(0, 5)}~${gathering.end_time.slice(0, 5)})에 맞췄어요.`
          : "2시간(4라운드)으로 잡았어요."}{" "}
        게임 수는 최대한 같게, 연달아 쉬는 사람 없이 돌아가요. 자동은 남복·여복·혼복을 먼저 꾸리고 어쩔 수 없을 때만 잡복을
        넣어요. 다양하게는 덜 만난 사람끼리, 실력 밸런스는 접전이 되게 짜요.
      </p>
      {matchType === "auto" && noGender.length > 0 ? (
        <p className="text-xs font-semibold text-[#B42318] dark:text-red-300">
          성별 미입력 {noGender.length}명({noGender.map((p) => p.user.name).join(", ")})은 잡복으로만 들어가요. 마이페이지에서 성별을
          입력해 달라고 알려 주세요.
        </p>
      ) : null}
    </Form>
  );
}

// 같은 라운드에서 누가 어느 코트에 있는지 (직접 바꾸기에서 "3코트"·"쉬는 중" 표시)
function roundSeats(
  matches: DrawMatch[],
  round: number | null,
  courtLabels: string[]
): Map<number, string> {
  const seats = new Map<number, string>();
  for (const m of matches) {
    if (m.round_number !== round) continue;
    const label =
      m.court_number != null && courtLabels[m.court_number - 1]
        ? courtLabels[m.court_number - 1]
        : String(m.court_number ?? "");
    for (const id of m.slot_ids) if (id != null) seats.set(id, `${label}코트`);
  }
  return seats;
}

const SLOT_NAMES = ["team1_player1", "team1_player2", "team2_player1", "team2_player2"];

function DrawMatchRow({
  match,
  canRecord,
  courtLabels,
  club,
  edit,
}: {
  match: DrawMatch;
  canRecord: boolean;
  courtLabels: string[];
  club: boolean;
  /** 직접 바꾸기 중이면 고를 수 있는 참석자와 같은 라운드 자리 */
  edit: { attendees: UserBrief[]; seats: Map<number, string>; canDelete: boolean } | null;
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
  // 관리자에게만 온다
  const balance = match.balance;
  const editable = edit !== null && !recorded;
  const swapping =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "swap_slot" &&
    navigation.formData?.get("draw_match_id") === String(match.id);
  const known = new Map<number, UserBrief>(
    [...match.team1, ...match.team2, ...(edit?.attendees ?? [])].map((u) => [u.id, u])
  );
  const singles = match.match_type === "singles";
  // 한 자리 선택 칸: 고르면 바로 저장(같은 라운드면 맞바꾸기, 쉬던 사람이면 교체)
  const slotPicker = (index: number) => {
    const current = match.slot_ids[index] ?? null;
    const options = [...(edit?.attendees ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, "ko")
    );
    const currentUser = current != null ? known.get(current) : undefined;
    return (
      <Form key={index} method="post" className="min-w-0">
        <input type="hidden" name="intent" value="swap_slot" />
        <input type="hidden" name="draw_match_id" value={match.id} />
        <input type="hidden" name="slot" value={SLOT_NAMES[index]} />
        <select
          name="user_id"
          aria-label={`${index < 2 ? "팀1" : "팀2"} ${index % 2 + 1}번 선수`}
          className="input !h-10 !py-0 !pl-3 !pr-8 text-[13px] font-semibold"
          value={current ?? ""}
          disabled={swapping}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {current == null ? <option value="">비어 있음</option> : null}
          {currentUser && current != null && !options.some((o) => o.id === current) ? (
            <option value={current}>{currentUser.name} (불참)</option>
          ) : null}
          {options.map((u) => {
            const seat = edit?.seats.get(u.id);
            const note =
              u.id === current ? "" : seat ? ` · ${seat}` : " · 쉬는 중";
            return (
              <option key={u.id} value={u.id}>
                {u.name}
                {note}
              </option>
            );
          })}
        </select>
      </Form>
    );
  };
  const editTeam = (indexes: number[]) => (
    <div className="space-y-2">{indexes.map((i) => slotPicker(i))}</div>
  );
  const team = (players: UserBrief[]) => (
    <div className="space-y-3">
      {players.map((p) => (
        <ProfileLink key={p.id} id={p.id} invited={!!p.invited_by_id} className="draw-player">
          <MemberAvatar user={p} className="!h-8 !w-8 shrink-0 !text-xs" />
          <span className="truncate">{p.name}</span>
          {balance?.tiers[p.id] ? (
            <span
              className={`${TIER_CLASS[balance.tiers[p.id]]} !h-5 !w-5 !rounded-md !text-[11px]`}
              title="내부 티어 (관리자만 보여요)"
            >
              {balance.tiers[p.id]}
            </span>
          ) : null}
        </ProfileLink>
      ))}
    </div>
  );
  return (
    <div className="draw-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="badge-gray">
          COURT {courtLabel} · {match.round_number ?? 1}R
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {balance ? (
            <span
              className="balance-chip"
              title={`팀 레이팅 ${balance.team1_rating} : ${balance.team2_rating} · ${
                recorded ? "경기 직전 예상 득점률" : "예상 득점률"
              } (관리자만 보여요)`}
            >
              예상 {expectedSplit(balance.expected_team1)}
            </span>
          ) : null}
          {MATCH_TYPE_LABEL[match.match_type]}
        </span>
      </div>
      <div className="draw-teams">
        {editable ? editTeam(singles ? [0] : [0, 1]) : team(match.team1)}
        <span className="text-center font-display text-xs text-slate-400">
          VS
        </span>
        {editable ? editTeam(singles ? [2] : [2, 3]) : team(match.team2)}
      </div>
      {editable && edit?.canDelete ? (
        <Form
          method="post"
          className="-mt-2 mb-3 flex justify-end"
          onSubmit={(e) => {
            if (!confirm("이 경기를 대진표에서 뺄까요?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete_draw_match" />
          <input type="hidden" name="draw_match_id" value={match.id} />
          <button className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">
            이 경기 빼기
          </button>
        </Form>
      ) : null}
      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {recorded ? (
          <span className="badge-gray">
            <Check size={13} />
            {match.team1_score !== null && match.team2_score !== null
              ? `결과 ${match.team1_score}:${match.team2_score}`
              : "결과 기록 완료"}
          </span>
        ) : canRecord ? (
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="result" />
            <input type="hidden" name="draw_match_id" value={match.id} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                name="team1_score"
                type="number"
                min="0"
                max="99"
                className="input !w-16 !px-2 !py-2 text-center"
                placeholder="0"
                aria-label="팀1 게임 수"
                required={club}
              />
              <span className="text-slate-400">:</span>
              <input
                name="team2_score"
                type="number"
                min="0"
                max="99"
                className="input !w-16 !px-2 !py-2 text-center"
                placeholder="0"
                aria-label="팀2 게임 수"
                required={club}
              />
              <button className="btn-primary btn-sm ml-auto" disabled={busy}>
                {busy ? "저장 중…" : "결과 기록"}
              </button>
            </div>
            {club ? (
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                게임 수로 적어 주세요. 5:5 해피게임은 5:5, 타이브레이크는 6:5.
              </p>
            ) : null}
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
