import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useOutletContext,
  useSearchParams,
} from "@remix-run/react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  List,
  Lock,
  Plus,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CourtSurfaceField } from "~/components/CourtSurface";
import { GatheringFeeFields } from "~/components/GatheringFeeFields";
import { GatheringRow } from "~/components/GatheringRow";
import { CalendarLegend, KindVoteDot, MyVoteChip } from "~/components/MyVote";
import { FieldGroup, Modal } from "~/components/Modal";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ScheduleShare } from "~/components/ScheduleShare";
import { ApiError, api } from "~/lib/api.server";
import { membersOrEmpty } from "~/lib/guard.server";
import {
  KIND_CHIP,
  KIND_LABEL,
  KIND_SHORT,
  isClubKind,
  isGuest,
  isStaff,
} from "~/lib/club";
import { todayKST } from "~/lib/format";
import { bookingsFromForm, feeFieldsFromForm } from "~/lib/gathering-form";
import type { NewSchedule } from "~/lib/schedule-notice";
import { requireToken } from "~/lib/session.server";
import { useSwipeNav } from "~/lib/swipe";
import { WEEKDAYS, formatOpenAt } from "~/lib/status";
import type {
  ClubAccount,
  Gathering,
  GatheringKind,
  Me,
  UserBrief,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "캘린더 · 오테식 매니저" }];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 다음 주 월~일 (한국 날짜 기준) */
function nextWeekRange() {
  const today = new Date(
    `${new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
      new Date()
    )}T00:00:00Z`
  );
  const mondayOffset = 7 - ((today.getUTCDay() + 6) % 7);
  const iso = (days: number) =>
    new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
  return { from: iso(mondayOffset), to: iso(mondayOffset + 6) };
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 달력 그리드용 셀 배열 (앞뒤 빈칸 포함, 7의 배수). */
function buildCells(month: string): (number | null)[] {
  const [y, m] = month.split("-").map(Number);
  const startWeekday = new Date(y, m - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  const { from, to } = monthRange(month);
  const week = nextWeekRange();
  const [gatherings, members, savedClubAccount, nextWeek] = await Promise.all([
    api<Gathering[]>(`/gatherings?date_from=${from}&date_to=${to}`, { token }),
    // 오테식 모임 등록 시 코트 예약자 선택용 (게스트는 빈 목록)
    membersOrEmpty(token),
    // 오테식 모임 등록 때 미리 채울 모임 통장
    api<ClubAccount | null>("/club/account", { token }),
    // 다음 주 일정 (운영진에게만 공개 전 일정이 보인다 → 미리 공개 안내)
    api<Gathering[]>(
      `/gatherings?date_from=${week.from}&date_to=${week.to}`,
      { token }
    ),
  ]);
  const unopened = nextWeek.filter(
    (g) => !g.open_to_members && g.status !== "canceled"
  );
  const nextWeekOpen = unopened.length
    ? { ...week, count: unopened.length, opensAt: unopened[0].member_open_at }
    : null;
  // 보기 방식: URL(?view) 우선, 없으면 쿠키(cal_view)로 마지막 선택 기억, 기본 달력
  const urlView = url.searchParams.get("view");
  const savedList = /(?:^|;\s*)cal_view=list/.test(
    request.headers.get("Cookie") ?? ""
  );
  const view: "calendar" | "list" =
    urlView === "list"
      ? "list"
      : urlView === "calendar"
      ? "calendar"
      : savedList
      ? "list"
      : "calendar";
  // 내 참석만 보기: URL(?mine=1) 우선, 없으면 쿠키(cal_mine)로 마지막 선택 기억
  const urlMine = url.searchParams.get("mine");
  const mine =
    urlMine !== null
      ? urlMine === "1"
      : /(?:^|;\s*)cal_mine=1/.test(request.headers.get("Cookie") ?? "");
  return json({
    month,
    // 오늘 (서버 시간대와 상관없이 한국 기준): 오늘 표시·지난 일정 접기
    today: todayKST(),
    gatherings,
    view,
    mine,
    members,
    savedClubAccount,
    nextWeekOpen,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const get = (k: string) => {
    const v = formData.get(k);
    return v ? String(v) : undefined;
  };

  // 운영진: 다음 주 일정을 금요일 오전 10시 전에 한 번에 공개
  if (formData.get("intent") === "open_week") {
    try {
      const r = await api<{ opened: number }>("/gatherings/open", {
        method: "POST",
        token,
        body: { date_from: get("date_from"), date_to: get("date_to") },
      });
      return json({
        ok: true,
        error: null as string | null,
        created: null as NewSchedule | null,
        notice: `다음 주 일정 ${r.opened}개를 공개했어요.`,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "공개하지 못했어요.";
      return json(
        { ok: false, error: message, created: null as NewSchedule | null },
        { status: 400 }
      );
    }
  }

  const courtNumbers = get("court_numbers");
  const maxParticipants = get("max_participants");
  const body = {
    title: get("title"),
    event_date: get("event_date"),
    start_time: get("start_time") || null,
    end_time: get("end_time") || null,
    location: get("location") || null,
    address: get("address") || null,
    court_numbers: courtNumbers || null,
    // 모름이면 같은 장소에서 고른 바닥이 들어간다 (서버)
    court_surface: get("court_surface") || null,
    court_fairy: get("court_fairy") || null,
    court_reservers: get("court_reservers") || null,
    // 코트 번호를 적었으면 면수는 자동(백엔드 계산), 아니면 직접 입력값 사용
    court_count: courtNumbers
      ? courtNumbers.split(",").filter((s) => s.trim()).length || 1
      : Number(get("court_count") || 1),
    max_participants: maxParticipants ? Number(maxParticipants) : null,
    ...feeFieldsFromForm(formData),
    court_bookings: bookingsFromForm(formData),
    description: get("description") || null,
    // 운영진: 정해진 공개 시각을 기다리지 않고 바로 공개
    open_now: formData.get("open_now") === "on",
  };
  if (body.kind === "flash") body.court_bookings = [];

  try {
    const g = await api<Gathering>("/gatherings", {
      method: "POST",
      token,
      body,
    });
    // 등록 뒤 단톡방 알림 창에 쓸 내용 (공개·투표 시각 포함)
    const created: NewSchedule = {
      id: g.id,
      title: g.title,
      kind: g.kind,
      event_date: g.event_date,
      start_time: g.start_time,
      end_time: g.end_time,
      location: g.location,
      court_numbers: g.court_numbers,
      member_open_at: g.member_open_at,
      guest_vote_open_at: g.guest_vote_open_at,
      open_to_members: g.open_to_members,
      guest_vote_open: g.guest_vote_open,
    };
    return json({ ok: true, error: null as string | null, created });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "모임 생성에 실패했습니다.";
    return json(
      { ok: false, error: message, created: null as NewSchedule | null },
      { status: 400 }
    );
  }
}

// 정시(00분) 단위 시간 옵션, 06시~22시 ("06:00", "07:00", ... "22:00")
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);
}

/** 시작 시간 + n시간 후를 옵션 범위 내로 계산 (범위를 넘으면 마지막 옵션으로 클램프). */
function addHours(time: string, hours: number): string {
  if (!time) return "";
  const [h] = time.split(":").map(Number);
  const target = `${String(h + hours).padStart(2, "0")}:00`;
  return TIME_OPTIONS.includes(target)
    ? target
    : TIME_OPTIONS[TIME_OPTIONS.length - 1];
}

/** 이번 달 지난 일정 접기·펼치기 줄 */
function PastToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-2 px-5 py-3.5 text-[13px] font-bold text-slate-500 transition-colors hover:bg-white hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white sm:px-6"
    >
      <span className="flex items-center gap-2">
        <History size={15} />
        지난 일정 {count}개 {open ? "접기" : "보기"}
      </span>
      <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** 내 참석 일정: 참석, 그리고 아직 끝나지 않은 모임의 대기 (대기로 끝난 모임은 가지 않은 것) */
function isMine(g: Gathering): boolean {
  if (g.my_status === "attending") return true;
  return g.my_status === "waiting" && (g.status === "planned" || g.status === "ongoing");
}

export default function CalendarPage() {
  const { month, today, gatherings, view, mine, members, savedClubAccount, nextWeekOpen } =
    useLoaderData<typeof loader>();
  const { user } = useOutletContext<{ user: Me }>();
  // 내 참석만 보기 (관리자는 투표하지 않아 거를 게 없다)
  const canFilterMine = !user.is_admin;
  const onlyMine = canFilterMine && mine;
  const shown = onlyMine ? gatherings.filter(isMine) : gatherings;
  // 게스트는 일정 보기와 참석 투표만: 일정 등록·엑셀 버튼이 없다
  const canCreate = !isGuest(user);
  // 오테식 모임 기본 계좌: 모임 통장, 없으면 이 달의 마지막 오테식 모임 계좌
  const clubAccount =
    savedClubAccount ??
    [...gatherings]
      .reverse()
      .find((g) => isClubKind(g.kind) && g.account_number);
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  // 방금 올린 일정: 단톡방 알림 창
  const [created, setCreated] = useState<NewSchedule | null>(null);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  // 엑셀 파일 끌어다 놓기
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFetcher = useFetcher<{
    ok: boolean;
    created?: number;
    failed?: number;
    errors?: { row: number; error: string }[];
    skipped?: number;
    skips?: { row: number; message: string }[];
    items?: NewSchedule[];
    notices?: string[];
    error?: string;
  }>();
  // 시간 제어 상태: 시작 선택 시 종료를 +2h 자동 설정하되, 사용자가 종료를 직접 바꾸면 자동 변경 중단
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endEdited, setEndEdited] = useState(false);

  // 모임 생성 성공 시 등록 창을 닫고 단톡방 알림 창을 띄운다
  useEffect(() => {
    if (actionData?.ok) {
      setShowCreate(false);
      setCreated(actionData.created);
    }
  }, [actionData]);

  // 엑셀 창을 열 때마다 고른 파일 초기화
  useEffect(() => {
    if (importing) {
      setFileName("");
      setDropError("");
      setDragging(false);
    }
  }, [importing]);

  // 엑셀 창이 열려 있을 때 칸 밖에 파일을 놓아도 브라우저가 그 파일을 열지 않게
  useEffect(() => {
    if (!importing) return;
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, [importing]);

  // 모달이 열릴 때마다 시간 입력 초기화
  useEffect(() => {
    if (showCreate) {
      setStartTime("");
      setEndTime("");
      setEndEdited(false);
    }
  }, [showCreate]);

  const cells = buildCells(month);
  const todayStr = today;

  // 날짜별 모임 그룹화
  const byDate = new Map<string, Gathering[]>();
  for (const g of shown) {
    const list = byDate.get(g.event_date) ?? [];
    list.push(g);
    byDate.set(g.event_date, list);
  }

  // month/view 둘 다 보존하며 URL 갱신
  const updateParams = (next: {
    month?: string;
    view?: "calendar" | "list";
    mine?: boolean;
  }) => {
    const p = new URLSearchParams(searchParams);
    if (next.month !== undefined) p.set("month", next.month);
    if (next.mine !== undefined) {
      if (next.mine) p.set("mine", "1");
      else p.delete("mine");
      // 마지막 선택을 쿠키에 기억 (1년): 모임을 보고 '목록'으로 돌아와도 그대로
      document.cookie = `cal_mine=${next.mine ? 1 : 0}; path=/; max-age=${
        60 * 60 * 24 * 365
      }`;
    }
    if (next.view !== undefined) {
      if (next.view === "calendar") p.delete("view");
      else p.set("view", next.view);
      // 마지막 보기 방식을 쿠키에 기억 (1년)
      document.cookie = `cal_view=${next.view}; path=/; max-age=${
        60 * 60 * 24 * 365
      }`;
    }
    setSearchParams(p);
  };
  const goMonth = (m: string) => updateParams({ month: m });
  // 휴대폰: 달력·리스트를 좌우로 밀어 이전·다음 달로 (보기 방식·거르기는 그대로)
  const monthHref = (m: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("month", m);
    return `?${p}`;
  };
  const swipeRef = useSwipeNav(monthHref(shiftMonth(month, -1)), monthHref(shiftMonth(month, 1)), {
    preventScrollReset: true,
  });
  const [yy, mm] = month.split("-");

  // 리스트 뷰: 일정이 있는 날짜만 오름차순으로
  const listDates = [...byDate.keys()].sort();
  // 이번 달은 오늘 이전 일정을 접어 둔다 ("지난 일정 N개 보기"). 지난 달·다음 달은 전부 보인다.
  const [showPast, setShowPast] = useState(false);
  useEffect(() => setShowPast(false), [month]); // 달을 넘기면 다시 접는다
  const pastDates =
    month === todayStr.slice(0, 7) ? listDates.filter((d) => d < todayStr) : [];
  const pastCount = pastDates.reduce((n, d) => n + (byDate.get(d)?.length ?? 0), 0);
  const visibleDates = showPast ? listDates : listDates.slice(pastDates.length);
  const cellBase =
    "min-h-[5rem] border-b border-r border-slate-200/70 p-1.5 text-center dark:border-slate-700 [&:nth-child(7n)]:border-r-0 sm:min-h-[8rem] sm:p-2 sm:text-left";

  return (
    <>
      <PageBody>
        <PageHeader
          eyebrow="MAKE TIME FOR TENNIS."
          title="코트에서 만나요"
          sub="함께할 날을 골라, 일상에 테니스를 더해요."
          actions={
            <>
              <div className="segmented">
                <button
                  className={`segmented-item ${
                    view === "calendar" ? "segmented-item-active" : ""
                  }`}
                  aria-pressed={view === "calendar"}
                  onClick={() => updateParams({ view: "calendar" })}
                >
                  <CalendarDays size={14} />
                  달력
                </button>
                <button
                  className={`segmented-item ${
                    view === "list" ? "segmented-item-active" : ""
                  }`}
                  aria-pressed={view === "list"}
                  onClick={() => updateParams({ view: "list" })}
                >
                  <List size={14} />
                  리스트
                </button>
              </div>
              {canCreate ? (
                <>
                  <button
                    className="btn-ghost btn-sm !h-10"
                    onClick={() => setImporting(true)}
                    title="엑셀로 여러 일정 등록"
                    aria-label="엑셀로 일정 등록"
                  >
                    <Upload size={15} />
                    <span className="hidden sm:inline">엑셀</span>
                  </button>
                  <button
                    className="btn-primary btn-sm !h-10"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus size={16} />
                    일정 등록
                  </button>
                </>
              ) : null}
            </>
          }
        />

        {/* 운영진: 다음 주 일정이 아직 공개 전이면 미리 공개 */}
        {nextWeekOpen && isStaff(user) ? (
          <Form
            method="post"
            className="open-week-bar"
            onSubmit={(e) => {
              if (
                !confirm(
                  `다음 주 일정 ${nextWeekOpen.count}개를 지금 정회원·게스트에게 공개할까요? 정회원은 바로 참석 투표를 할 수 있어요.`
                )
              )
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="open_week" />
            <input type="hidden" name="date_from" value={nextWeekOpen.from} />
            <input type="hidden" name="date_to" value={nextWeekOpen.to} />
            <p className="flex min-w-0 flex-1 basis-56 items-start gap-2">
              <Lock size={16} className="mt-0.5 shrink-0" />
              <span>
                다음 주({shortRange(nextWeekOpen.from, nextWeekOpen.to)}) 일정{" "}
                {nextWeekOpen.count}개는{" "}
                {nextWeekOpen.opensAt
                  ? `${formatOpenAt(nextWeekOpen.opensAt)}에`
                  : "금요일 오전 10시에"}{" "}
                공개돼요.
              </span>
            </p>
            <button type="submit" className="btn-ink btn-sm shrink-0">
              지금 공개하기
            </button>
          </Form>
        ) : null}
        {actionData && "notice" in actionData && actionData.notice ? (
          <p className="alert-success">{actionData.notice}</p>
        ) : null}

        <div ref={swipeRef} className="space-y-5">
          <div className="calendar-heading card !py-4">
            <div>
              <h2>
                {yy}
                <span className="text-house-orange">.</span>
                {mm}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {onlyMine
                  ? `내 참석 ${shown.length}개 · 전체 ${gatherings.length}개`
                  : `이 달 일정 ${gatherings.length}개`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="icon-btn"
                aria-label="이전 달"
                onClick={() => goMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => goMonth(currentMonth())}
              >
                오늘
              </button>
              <button
                className="icon-btn"
                aria-label="다음 달"
                onClick={() => goMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          {canFilterMine ? (
            <div>
              <div className="segmented" role="group" aria-label="일정 거르기">
                <button
                  className={`segmented-item ${onlyMine ? "" : "segmented-item-active"}`}
                  aria-pressed={!onlyMine}
                  onClick={() => updateParams({ mine: false })}
                >
                  전체 일정
                </button>
                <button
                  className={`segmented-item ${onlyMine ? "segmented-item-active" : ""}`}
                  aria-pressed={onlyMine}
                  onClick={() => updateParams({ mine: true })}
                >
                  <Check size={14} strokeWidth={3} />
                  내 참석만
                </button>
              </div>
            </div>
          ) : null}
          <CalendarLegend />
          {onlyMine && view === "calendar" && shown.length === 0 && gatherings.length > 0 ? (
            <p className="px-1 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
              이 달에 참석하는 일정이 없어요.{" "}
              <button
                type="button"
                className="font-bold text-ink underline underline-offset-4 dark:text-white"
                onClick={() => updateParams({ mine: false })}
              >
                전체 일정 보기
              </button>
            </p>
          ) : null}
          {view === "calendar" ? (
            /* 달력 그리드 */
            <div className="card overflow-hidden !p-0">
              <div className="grid grid-cols-7 bg-house-yellow">
                {WEEKDAYS.map((w, i) => (
                  <div
                    key={w}
                    className={`py-2.5 text-center text-xs font-extrabold text-ink ${
                      i === 0 || i === 6 ? "" : "opacity-70"
                    }`}
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* -mb-px: 마지막 줄의 아래 테두리를 카드 테두리 뒤로 숨김 */}
              <div className="-mb-px grid grid-cols-7">
                {cells.map((day, idx) => {
                  if (day === null) {
                    return (
                      <div
                        key={idx}
                        className={`${cellBase} bg-slate-100/60 dark:bg-slate-950/40`}
                      />
                    );
                  }
                  const dateStr = `${month}-${String(day).padStart(2, "0")}`;
                  const isToday = dateStr === todayStr;
                  const isPast = dateStr < todayStr;
                  const dayGatherings = byDate.get(dateStr) ?? [];
                  const weekday = idx % 7;

                  return (
                    <Link
                      key={idx}
                      to={`/app/day/${dateStr}`}
                      className={`${cellBase} block transition-colors hover:bg-white dark:hover:bg-slate-800/50`}
                    >
                      <span
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 font-display text-[14px] font-extrabold ${
                          isToday
                            ? "bg-ink text-house-yellow dark:bg-house-yellow dark:text-ink"
                            : isPast
                            ? "text-slate-400 dark:text-slate-600"
                            : weekday === 0
                            ? "text-[#D2381F] dark:text-red-400"
                            : weekday === 6
                            ? "text-[#2F5BD3] dark:text-blue-400"
                            : "text-ink dark:text-slate-100"
                        }`}
                      >
                        {day}
                      </span>

                      {/* 모바일: 종류 색 동그라미 + 내 투표 아이콘 (최대 3개) */}
                      <div className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                        {dayGatherings.slice(0, 3).map((g) => (
                          <KindVoteDot key={g.id} g={g} />
                        ))}
                      </div>

                      {/* 데스크톱: 일정 칩 */}
                      <div className="mt-1 hidden space-y-1 sm:block">
                        {dayGatherings.slice(0, 3).map((g) => (
                          <div
                            key={g.id}
                            className={`rounded-lg px-2 py-2 text-[11px] font-semibold leading-relaxed ${
                              KIND_CHIP[g.kind]
                            } ${
                              g.status === "canceled"
                                ? "line-through opacity-50"
                                : g.status === "completed"
                                ? "opacity-50"
                                : ""
                            } ${g.open_to_members ? "" : "opacity-60 outline-dashed outline-1 outline-offset-[-3px]"}`}
                            title={
                              g.status === "canceled" && g.cancel_reason
                                ? `${g.title} (취소: ${g.cancel_reason})`
                                : g.open_to_members
                                ? g.title
                                : `${g.title} (아직 정회원에게 공개 전)`
                            }
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="truncate opacity-70">
                                {g.start_time
                                  ? `${g.start_time.slice(0, 5)} · `
                                  : ""}
                                {KIND_SHORT[g.kind]}
                              </span>
                              <MyVoteChip g={g} />
                            </span>
                            <span className="block truncate">{g.title}</span>
                            <span className="mt-1 block truncate text-[10px] opacity-70">
                              {g.status === "canceled" && g.cancel_reason
                                ? `취소 · ${g.cancel_reason}`
                                : g.open_to_members
                                ? g.location
                                : "공개 전"}
                            </span>
                          </div>
                        ))}
                        {dayGatherings.length > 3 ? (
                          <div className="px-1 text-[11px] font-bold text-slate-500">
                            +{dayGatherings.length - 3}개
                          </div>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : listDates.length === 0 ? (
            <EmptyCard
              icon={<CalendarDays size={28} />}
              action={
                onlyMine && gatherings.length > 0 ? (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => updateParams({ mine: false })}
                  >
                    전체 일정 보기
                  </button>
                ) : canCreate ? (
                  <button
                    className="btn-accent btn-sm"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus size={16} />
                    일정 등록
                  </button>
                ) : undefined
              }
            >
              {onlyMine && gatherings.length > 0
                ? "이 달에 참석하는 일정이 없어요."
                : "이 달에 등록된 일정이 없어요."}
            </EmptyCard>
          ) : (
            /* 리스트 보기: 날짜별 소제목 + 일정 줄을 카드 한 장에 (이번 달 지난 일정은 접어 둔다) */
            <section className="card overflow-hidden !p-0">
              {pastCount ? (
                <PastToggle count={pastCount} open={showPast} onToggle={() => setShowPast((v) => !v)} />
              ) : null}
              {visibleDates.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm font-semibold text-slate-500 dark:text-slate-400 sm:px-6">
                  {onlyMine ? "이번 달에 남은 내 일정이 없어요." : "이번 달 남은 일정이 없어요."}
                </p>
              ) : null}
              {visibleDates.map((dateStr, i) => {
                const [ly, lm, ld] = dateStr.split("-").map(Number);
                const wd = WEEKDAYS[new Date(ly, lm - 1, ld).getDay()];
                const list = [...(byDate.get(dateStr) ?? [])].sort((a, b) =>
                  (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
                );
                return (
                  <div
                    key={dateStr}
                    className={
                      i > 0 || pastCount
                        ? "border-t-[1.5px] border-slate-200 dark:border-slate-700"
                        : ""
                    }
                  >
                    <h2 className="flex items-center gap-2 px-5 pb-1 pt-4 font-display text-[17px] font-extrabold tracking-[-0.03em] sm:px-6">
                      {lm}.{ld}{" "}
                      <span className="font-sans text-[13px] font-bold text-slate-500">
                        {wd}요일
                      </span>
                      {dateStr === todayStr ? (
                        <span className="badge-yellow">오늘</span>
                      ) : null}
                    </h2>
                    <ul className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {list.map((g) => (
                        <li key={g.id}>
                          <GatheringRow
                            g={g}
                            to={`/app/gatherings/${g.id}?from=list:${month}`}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}
          {view === "calendar" && shown.length > 0 ? (
            <section className="card overflow-hidden !p-0 sm:hidden">
              <h2 className="section-title px-5 pt-5">이번 달 모임</h2>
              {pastCount ? (
                <div className="mt-2 border-t border-slate-200 dark:border-slate-700">
                  <PastToggle count={pastCount} open={showPast} onToggle={() => setShowPast((v) => !v)} />
                </div>
              ) : null}
              {visibleDates.length === 0 ? (
                <p className="border-t border-slate-200 px-5 py-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {onlyMine ? "이번 달에 남은 내 일정이 없어요." : "이번 달 남은 일정이 없어요."}
                </p>
              ) : null}
              <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
                {visibleDates.map((dateStr) => (
                  <li key={dateStr}>
                    <p className="px-5 pt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {dateStr.slice(5).replace("-", ".")}
                    </p>
                    {(byDate.get(dateStr) ?? []).map((g) => (
                      <GatheringRow
                        key={g.id}
                        g={g}
                        to={`/app/gatherings/${g.id}?from=${month}`}
                      />
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </PageBody>

      {/* 일정 등록 */}
      {showCreate ? (
        <Modal title="새 일정" onClose={() => setShowCreate(false)}>
          <Form method="post" className="space-y-7">
            <GatheringFeeFields
              idPrefix="c_"
              canCreateClub={isStaff(user)}
              members={members}
              defaults={{
                kind: "flash",
                court_fee: 0,
                ball_fee: 0,
                guest_fee: 5000,
                accounts: {
                  // 일반 벙개는 보통 만든 사람이 받으므로 내 환급 계좌
                  flash: {
                    bank: user.bank,
                    account_number: user.account_number,
                    account_holder: user.account_holder,
                  },
                  // 오테식 모임은 최근 오테식 모임의 회비 통장
                  club: clubAccount ?? {
                    bank: null,
                    account_number: null,
                    account_holder: null,
                  },
                },
              }}
            >
              {(kind) => (
                <>
                  <FieldGroup title="언제 · 어디서">
                    <KindTitleField kind={kind} />
                    <div>
                      <label className="label" htmlFor="event_date">
                        날짜
                      </label>
                      <input
                        id="event_date"
                        name="event_date"
                        type="date"
                        className="input"
                        required
                        defaultValue={todayStr}
                      />
                    </div>
                    {isStaff(user) ? (
                      <label className="flex items-start gap-2 text-[13px] font-medium">
                        <input
                          type="checkbox"
                          name="open_now"
                          className="mt-0.5 h-4 w-4 accent-ink"
                        />
                        <span>
                          정회원·게스트에게 바로 공개
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            안 고르면 전주 금요일 오전 10시에 공개돼요.
                          </span>
                        </span>
                      </label>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor="start_time">
                          시작
                        </label>
                        <select
                          id="start_time"
                          name="start_time"
                          className="input"
                          value={startTime}
                          onChange={(e) => {
                            const v = e.target.value;
                            setStartTime(v);
                            // 종료를 아직 직접 수정하지 않았으면 +2시간으로 자동 설정
                            if (!endEdited) setEndTime(addHours(v, 2));
                          }}
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
                        <label className="label" htmlFor="end_time">
                          종료
                        </label>
                        <select
                          id="end_time"
                          name="end_time"
                          className="input"
                          value={endTime}
                          onChange={(e) => {
                            setEndTime(e.target.value);
                            setEndEdited(true);
                          }}
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
                      <label className="label" htmlFor="location">
                        장소
                      </label>
                      <input
                        id="location"
                        name="location"
                        className="input"
                        placeholder="시민 테니스장"
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="address">
                        주소{" "}
                        <span className="font-medium text-slate-400">(선택)</span>
                      </label>
                      <input
                        id="address"
                        name="address"
                        className="input"
                        maxLength={200}
                        placeholder="예: 경기 안산시 상록구 ○○로 123"
                      />
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        지도 버튼이 장소 이름 대신 이 주소로 찾아요. 한 번 적으면 같은
                        장소의 다른 일정에도 들어가요.
                      </p>
                    </div>
                  </FieldGroup>

                  <FieldGroup title="코트 · 인원">
                    <div>
                      <label className="label" htmlFor="court_numbers">
                        코트 번호
                      </label>
                      <input
                        id="court_numbers"
                        name="court_numbers"
                        className="input"
                        placeholder="예: 3, 5"
                      />
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        쉼표로 나눠 적으면 그 수만큼 동시에 경기를 진행해요.
                      </p>
                    </div>
                    <CourtSurfaceField hint="모름으로 두면 같은 장소에서 골랐던 바닥이 들어가요." />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor="court_count">
                          코트 면수
                        </label>
                        <input
                          id="court_count"
                          name="court_count"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          defaultValue={1}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="max_participants">
                          정원
                        </label>
                        <input
                          id="max_participants"
                          name="max_participants"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          className="input"
                          placeholder="제한 없음"
                        />
                      </div>
                    </div>
                    <p className="-mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {isClubKind(kind)
                        ? "회칙상 코트 1면에 6명이에요. "
                        : ""}
                      정원이 차면 다음 신청은 대기로 받아요.
                    </p>
                    {isClubKind(kind) ? (
                      <p className="rounded-2xl bg-house-green/20 px-4 py-3 text-[13px] font-medium leading-relaxed">
                        <strong>코트요정</strong>은 아래{" "}
                        <strong>‘코트요정 · 코트비’</strong>에서 회원으로
                        추가해요. 추가하면 정산 탭에 올라가 총무가 코트비를
                        보내요.
                      </p>
                    ) : (
                      <div>
                        <label className="label" htmlFor="court_fairy">
                          코트요정{" "}
                          <span className="font-medium text-slate-400">
                            (선택)
                          </span>
                        </label>
                        <input
                          id="court_fairy"
                          name="court_fairy"
                          className="input"
                          placeholder="코트를 잡아 준 사람"
                          maxLength={200}
                        />
                      </div>
                    )}
                    <div>
                      <label className="label" htmlFor="court_reservers">
                        예약자명{" "}
                        <span className="font-medium text-slate-400">
                          (선택)
                        </span>
                      </label>
                      <input
                        id="court_reservers"
                        name="court_reservers"
                        className="input"
                        placeholder="예: 3·5번 장미주, 2번 김다빈"
                        maxLength={300}
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
              <label className="label" htmlFor="description">
                메모
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="input"
                placeholder="주차, 준비물 등"
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
                {navigation.state === "submitting" ? "등록 중…" : "등록하기"}
              </button>
            </div>
          </Form>
        </Modal>
      ) : null}

      {/* 일정을 올린 뒤: 단톡방에 알리기 */}
      {created ? (
        <Modal title="일정을 올렸어요" onClose={() => setCreated(null)}>
          <div className="space-y-5">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              단톡방에 새 일정을 알려 주세요. 카톡방을 고르면 아래 문구가
              보내져요.
            </p>
            <ScheduleShare items={[created]} preview />
            <div className="flex gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <Link
                to={`/app/gatherings/${created.id}`}
                className="btn-ghost flex-1"
              >
                모임 보기
              </Link>
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => setCreated(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 엑셀 일괄 등록 */}
      {importing ? (
        <Modal title="엑셀로 일정 등록" onClose={() => setImporting(false)}>
          <importFetcher.Form
            method="post"
            action="/resources/gatherings-import"
            encType="multipart/form-data"
            className="space-y-5"
          >
            <ol className="import-steps">
              <li>
                <span>1</span>
                <div className="min-w-0 flex-1">
                  <strong>양식 내려받기</strong>
                  <p>코트 예약 시트 양식에 한 행에 코트 한 면씩 적어요.</p>
                  <a
                    href="/resources/gatherings-template"
                    className="btn-secondary btn-sm mt-2.5"
                    download
                  >
                    <Download size={14} />
                    양식 내려받기
                  </a>
                </div>
              </li>
              <li>
                <span>2</span>
                <div className="min-w-0 flex-1">
                  <strong>필수 칸 채우기</strong>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {IMPORT_REQUIRED.map((c) => (
                      <li key={c} className="badge-line">
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p>
                    날짜·시간·장소·사용 여부가 같은 행은 한 모임으로 묶여요.
                    무료 코트는 코트비에 0을 적어요. 최대 인원을 비우면 오테식
                    모임은 코트 수 × 6명이에요.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div className="min-w-0 flex-1">
                  <strong>파일 올리기</strong>
                  <p>
                    예약대기·우천 취소 같은 행과 이미 등록된 일정은
                    건너뛰어요.
                  </p>
                </div>
              </li>
            </ol>

            {/* 눌러서 고르거나, 엑셀 파일을 끌어다 놓는다 */}
            <label
              className={`file-drop ${fileName ? "has-file" : ""} ${
                dragging ? "is-dragging" : ""
              }`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                // 칸 안의 아이콘·글자로 옮겨 갈 때는 그대로 둔다
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (!file) return;
                if (!/\.xlsx$/i.test(file.name)) {
                  setDropError("엑셀 파일(.xlsx)만 올릴 수 있어요.");
                  return;
                }
                setDropError("");
                // 끌어다 놓은 파일을 폼의 파일 칸에 넣어 '올리기'로 그대로 보낸다
                const files = new DataTransfer();
                files.items.add(file);
                if (fileInputRef.current) fileInputRef.current.files = files.files;
                setFileName(file.name);
              }}
            >
              <input
                ref={fileInputRef}
                name="file"
                type="file"
                accept=".xlsx"
                className="sr-only"
                required
                onChange={(e) => {
                  setDropError("");
                  setFileName(e.currentTarget.files?.[0]?.name ?? "");
                }}
              />
              <FileSpreadsheet size={22} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {dragging
                  ? "여기에 놓으세요"
                  : fileName || "엑셀 파일을 끌어다 놓거나 눌러서 고르기 (.xlsx)"}
              </span>
              <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
                {fileName ? "바꾸기" : "선택"}
              </span>
            </label>
            {dropError ? (
              <p role="alert" className="alert-error -mt-2">
                {dropError}
              </p>
            ) : null}
            {isStaff(user) ? (
              <label className="flex items-start gap-2 text-[13px] font-medium">
                <input
                  type="checkbox"
                  name="open_now"
                  className="mt-0.5 h-4 w-4 accent-ink"
                />
                <span>
                  올린 일정을 바로 공개
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    안 고르면 각 일정의 전주 금요일 오전 10시에 공개돼요.
                  </span>
                </span>
              </label>
            ) : null}

            <button
              type="submit"
              className="btn-primary h-12 w-full"
              disabled={!fileName || importFetcher.state !== "idle"}
            >
              {importFetcher.state !== "idle" ? "올리는 중…" : "올리기"}
            </button>

            {importFetcher.data ? (
              importFetcher.data.ok ? (
                <div className="alert-success space-y-2">
                  <p className="font-semibold">
                    일정 {importFetcher.data.created}건 등록
                    {importFetcher.data.skipped
                      ? ` · ${importFetcher.data.skipped}건 건너뜀`
                      : ""}
                    {importFetcher.data.failed
                      ? ` · ${importFetcher.data.failed}건 실패`
                      : ""}
                  </p>
                  {importFetcher.data.notices?.length ? (
                    <ul className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {importFetcher.data.notices.map((n) => (
                        <li key={n}>· {n}</li>
                      ))}
                    </ul>
                  ) : null}
                  {importFetcher.data.items?.length ? (
                    <div className="space-y-2 border-t border-ink/10 pt-2.5 dark:border-white/10">
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        단톡방에 새 일정을 알려 주세요.
                      </p>
                      <ScheduleShare items={importFetcher.data.items} />
                    </div>
                  ) : null}
                  {importFetcher.data.skips &&
                  importFetcher.data.skips.length > 0 ? (
                    <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                      {importFetcher.data.skips.map((s) => (
                        <li key={`s${s.row}`}>
                          {s.message.match(/^\d/) ? s.message : `${s.row}행: ${s.message}`}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {importFetcher.data.errors &&
                  importFetcher.data.errors.length > 0 ? (
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600 dark:text-red-400">
                      {importFetcher.data.errors.map((e) => (
                        <li key={`e${e.row}`}>
                          {e.error.match(/^\d/) ? e.error : `${e.row}행: ${e.error}`}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="alert-error">{importFetcher.data.error}</p>
              )
            ) : null}
          </importFetcher.Form>
        </Modal>
      ) : null}
    </>
  );
}

/** 엑셀 코트 예약 시트에서 꼭 채워야 하는 칸 */
const IMPORT_REQUIRED = [
  "날짜",
  "시간",
  "코트 번호",
  "예약자명",
  "코트요정",
  "코트비",
  "사용 여부",
  "장소",
];

/** 제목: 직접 고치기 전까지는 고른 종류 이름(오테식 정모 등)으로 채운다 */
function KindTitleField({ kind }: { kind: GatheringKind }) {
  const [title, setTitle] = useState(KIND_LABEL[kind]);
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setTitle(KIND_LABEL[kind]);
  }, [kind, edited]);
  return (
    <div>
      <label className="label" htmlFor="title">
        제목
      </label>
      <input
        id="title"
        name="title"
        className="input"
        required
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setEdited(true);
        }}
      />
    </div>
  );
}

/** "2026-10-19", "2026-10-25" → "10/19~10/25" */
function shortRange(from: string, to: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(from)}~${md(to)}`;
}
