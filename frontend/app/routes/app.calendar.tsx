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
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  List,
  Plus,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

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
  isStaff,
} from "~/lib/club";
import { bookingsFromForm, feeFieldsFromForm } from "~/lib/gathering-form";
import type { NewSchedule } from "~/lib/schedule-notice";
import { requireToken } from "~/lib/session.server";
import { WEEKDAYS } from "~/lib/status";
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
  const [gatherings, members, savedClubAccount] = await Promise.all([
    api<Gathering[]>(`/gatherings?date_from=${from}&date_to=${to}`, { token }),
    // 오테식 모임 등록 시 코트 예약자 선택용 (게스트는 빈 목록)
    membersOrEmpty(token),
    // 오테식 모임 등록 때 미리 채울 모임 통장
    api<ClubAccount | null>("/club/account", { token }),
  ]);
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
  return json({ month, gatherings, view, members, savedClubAccount });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const get = (k: string) => {
    const v = formData.get(k);
    return v ? String(v) : undefined;
  };

  const courtNumbers = get("court_numbers");
  const maxParticipants = get("max_participants");
  const body = {
    title: get("title"),
    event_date: get("event_date"),
    start_time: get("start_time") || null,
    end_time: get("end_time") || null,
    location: get("location") || null,
    court_numbers: courtNumbers || null,
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

export default function CalendarPage() {
  const { month, gatherings, view, members, savedClubAccount } =
    useLoaderData<typeof loader>();
  const { user } = useOutletContext<{ user: Me }>();
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
    if (importing) setFileName("");
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
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(n.getDate()).padStart(2, "0")}`;
  })();

  // 날짜별 모임 그룹화
  const byDate = new Map<string, Gathering[]>();
  for (const g of gatherings) {
    const list = byDate.get(g.event_date) ?? [];
    list.push(g);
    byDate.set(g.event_date, list);
  }

  // month/view 둘 다 보존하며 URL 갱신
  const updateParams = (next: {
    month?: string;
    view?: "calendar" | "list";
  }) => {
    const p = new URLSearchParams(searchParams);
    if (next.month !== undefined) p.set("month", next.month);
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
  const [yy, mm] = month.split("-");

  // 리스트 뷰: 일정이 있는 날짜만 오름차순으로
  const listDates = [...byDate.keys()].sort();
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
          }
        />

        <div className="calendar-heading card !py-4">
          <div>
            <h2>
              {yy}
              <span className="text-house-orange">.</span>
              {mm}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              이 달 일정 {gatherings.length}개
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
        <CalendarLegend />
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
                          title={g.open_to_members ? g.title : `${g.title} (아직 정회원에게 공개 전)`}
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
                            {g.open_to_members ? g.location : "공개 전"}
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
              <button
                className="btn-accent btn-sm"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={16} />
                일정 등록
              </button>
            }
          >
            이 달에 등록된 일정이 없어요.
          </EmptyCard>
        ) : (
          /* 리스트 보기: 날짜별 소제목 + 일정 줄을 카드 한 장에 */
          <section className="card overflow-hidden !p-0">
            {listDates.map((dateStr, i) => {
              const [ly, lm, ld] = dateStr.split("-").map(Number);
              const wd = WEEKDAYS[new Date(ly, lm - 1, ld).getDay()];
              const list = [...(byDate.get(dateStr) ?? [])].sort((a, b) =>
                (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
              );
              return (
                <div
                  key={dateStr}
                  className={
                    i > 0
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
        {view === "calendar" && gatherings.length > 0 ? (
          <section className="card overflow-hidden !p-0 sm:hidden">
            <h2 className="section-title px-5 pt-5">이번 달 모임</h2>
            <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
              {listDates.map((dateStr) => (
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
                    최대 인원을 비우면 오테식 모임은 코트 수 × 6명이에요.
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

            <label className={`file-drop ${fileName ? "has-file" : ""}`}>
              <input
                name="file"
                type="file"
                accept=".xlsx"
                className="sr-only"
                required
                onChange={(e) =>
                  setFileName(e.currentTarget.files?.[0]?.name ?? "")
                }
              />
              <FileSpreadsheet size={22} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {fileName || "엑셀 파일 고르기 (.xlsx)"}
              </span>
              <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
                {fileName ? "바꾸기" : "선택"}
              </span>
            </label>

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
