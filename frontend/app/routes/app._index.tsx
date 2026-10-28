import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteLoaderData } from "@remix-run/react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Users,
  MapPin,
  Wallet,
  CalendarDays,
  BookOpen,
  CalendarX,
  Megaphone,
} from "lucide-react";

import {
  ClubIllustration,
  Eyebrow,
  MemberAvatar,
  SectionHeading,
  TennisCourt,
} from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { MyVotePill } from "~/components/MyVote";
import { NOTICE_ICON } from "~/components/NoticePopup";
import { PageBody, PageHeader } from "~/components/Page";
import { api } from "~/lib/api.server";
import { ATTENDANCE_LOCK_DAYS, isFull, waitingList } from "~/lib/attendance";
import { COURT_SURFACE_LABEL, KIND_DOT, isGuest, isStaff, naverMapUrl } from "~/lib/club";
import { FEATURES, canSeeRecords } from "~/lib/features";
import { todayKST, won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import { WEEKDAYS, formatOpenAt } from "~/lib/status";
import type {
  AttendanceStatus,
  Gathering,
  GatheringDetail,
  MyPaymentDue,
  Notice,
  PlayerStats,
  RankingEntry,
  User,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "홈 · 오테식 매니저" }];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** a → b 날짜 차이(일) */
function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

function dateParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { m, d, wd: WEEKDAYS[new Date(y, m - 1, d).getDay()] };
}

/** "10.11 일" */
const shortDay = (date: string) => {
  const { m, d, wd } = dateParts(date);
  return `${m}.${d} ${wd}`;
};



export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const today = todayKST();
  const [me, gatherings, myDues] = await Promise.all([
    api<User>("/users/me", { token }),
    api<Gathering[]>(
      `/gatherings?date_from=${today}&date_to=${addDays(today, 60)}`,
      { token }
    ),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
  ]);
  const upcoming = gatherings.filter(
    (g) => g.status === "planned" || g.status === "ongoing"
  );
  // 일주일 안에 취소된 모임 (우천·코트 취소 등): 홈 위쪽에 알린다
  const canceledSoon = gatherings
    .filter((g) => g.status === "canceled" && g.event_date <= addDays(today, 7))
    .slice(0, 3);
  // 다음 모임 카드에서 ‹ › 로 넘겨 보는 몇 번째 모임 (?n=1 이면 두 번째)
  const want = Math.trunc(Number(new URL(request.url).searchParams.get("n")) || 0);
  const nextIndex = Math.min(Math.max(want, 0), Math.max(upcoming.length - 1, 0));
  const records = canSeeRecords(me);
  const [next, stats, ranking, pending] = await Promise.all([
    upcoming[nextIndex]
      ? api<GatheringDetail>(`/gatherings/${upcoming[nextIndex].id}`, { token })
      : Promise.resolve(null),
    records
      ? api<PlayerStats>(`/stats/users/${me.id}`, { token })
      : Promise.resolve(null),
    FEATURES.ranking && records
      ? api<RankingEntry[]>("/stats/ranking", { token })
      : Promise.resolve([] as RankingEntry[]),
    me.is_admin
      ? api<User[]>("/admin/signups/pending", { token })
      : Promise.resolve([] as User[]),
  ]);
  return json({
    today,
    me,
    next,
    nextIndex,
    upcoming,
    canceledSoon,
    myDues,
    stats,
    ranking: ranking.slice(0, 5),
    pendingCount: pending.length,
  });
}

export default function HomePage() {
  const { today, me, next, nextIndex, upcoming, canceledSoon, myDues, stats, ranking, pendingCount } =
    useLoaderData<typeof loader>();
  const totalDue = myDues.reduce((sum, due) => sum + due.amount, 0);
  // 클럽 소식은 카드를 넘겨 봐도 늘 바로 다음 모임
  const soonest = upcoming[0];
  const guest = isGuest(me);
  const weekCount = upcoming.filter(
    (g) => daysBetween(today, g.event_date) < 7
  ).length;
  const sharedAccount =
    myDues.length > 0 &&
    myDues.every(
      (d) =>
        d.account_number &&
        d.account_number === myDues[0].account_number &&
        d.bank === myDues[0].bank
    )
      ? myDues[0]
      : null;
  const pct = stats ? Math.round(stats.overall.win_rate * 100) : 0;
  // 클럽 소식은 레이아웃(routes/app)이 불러 둔 것을 쓴다. 가장 최근 소식을 CLUB NEWS 줄에
  const notices =
    useRouteLoaderData<{ notices: Notice[] }>("routes/app")?.notices ?? [];
  const latestNotice = notices[0] ?? null;
  return (
    <PageBody>
      <PageHeader
        eyebrow="GOOD DAY, GOOD GAME."
        title="오늘도, 좋은 한 게임"
        sub={`${me.name}님, ${
          weekCount
            ? `이번 주 모임 ${weekCount}개가 기다리고 있어요.`
            : "반가워요. 다음 만남을 준비해 볼까요?"
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/app/calendar" className="btn-ghost">
              이번 달 일정 <ArrowUpRight size={16} />
            </Link>
            {/* 회원 이용 안내 웹페이지 (로그인 없이도 열린다) */}
            <Link to="/guide" className="btn-ghost">
              <BookOpen size={16} /> 이용 안내
            </Link>
            <Link to="/app/notices" className="btn-ghost">
              <Megaphone size={16} /> 클럽 소식
            </Link>
          </div>
        }
      />
      <div className="club-news">
        <span>
          <i className="h-1.5 w-1.5 rounded-full bg-house-green" />
          CLUB NEWS
        </span>
        <p>
          {me.is_admin && pendingCount
            ? `새로운 식구 ${pendingCount}명이 가입 승인을 기다려요.`
            : latestNotice
            ? `${NOTICE_ICON[latestNotice.kind]} ${latestNotice.title}`
            : soonest
            ? `${shortDay(soonest.event_date)} ${soonest.title} · ${
                soonest.attendance?.attending ?? 0
              }명 함께해요.`
            : "좋아하는 사람들과, 좋아하는 테니스를."}
        </p>
        <Link
          to={
            me.is_admin && pendingCount
              ? "/app/admin"
              : latestNotice
              ? "/app/notices"
              : soonest
              ? `/app/gatherings/${soonest.id}?from=${soonest.event_date}`
              : "/app/calendar"
          }
          className="text-link"
          aria-label={
            me.is_admin && pendingCount
              ? "가입 신청 확인"
              : latestNotice
              ? "클럽 소식 보기"
              : "모임 확인"
          }
        >
          <ArrowUpRight size={17} />
        </Link>
      </div>
      {canceledSoon.length ? (
        <ul className="space-y-2">
          {canceledSoon.map((g) => (
            <li key={g.id}>
              <Link
                to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                className="flex items-center gap-2.5 rounded-2xl bg-house-red/15 px-4 py-3 text-sm font-semibold text-[#9F2A17] transition-colors hover:bg-house-red/25 dark:text-red-300"
              >
                <CalendarX size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  <b>
                    {shortDay(g.event_date)} {g.title} 취소
                  </b>
                  {g.cancel_reason ? ` · ${g.cancel_reason}` : ""}
                </span>
                <ArrowUpRight size={16} className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="home-grid">
        <NextGatheringTile
          next={next}
          index={nextIndex}
          total={upcoming.length}
          today={today}
          me={me}
          myDue={
            next
              ? myDues.find((d) => d.gathering_id === next.id)?.amount ?? 0
              : 0
          }
        />
        <section className="tile-yellow home-dues">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>MY CLUB DUES</Eyebrow>
            <Wallet size={20} strokeWidth={1.7} />
          </div>
          <h2 className="mt-7 text-lg font-bold">내가 낼 참가비</h2>
          <p className="dues-number">{won(totalDue)}</p>
          <p className="mt-2 text-xs leading-relaxed">
            {myDues.length
              ? `${myDues.length}건 입금 전${
                  myDues.length === 1 ? ` · ${myDues[0].title}` : ""
                }`
              : "모두 정산했어요. 다음 모임에서 만나요!"}
          </p>
          <div className="mt-auto pt-6">
            {sharedAccount ? (
              <div className="club-account">
                <span className="min-w-0">
                  <span className="block">
                    {[sharedAccount.bank, sharedAccount.account_holder]
                      .filter(Boolean)
                      .join(" · ") || "입금 계좌"}
                  </span>
                  <strong className="mt-1 block break-all text-sm tabular-nums">
                    {sharedAccount.account_number}
                  </strong>
                </span>
                <CopyButton text={sharedAccount.account_number!} tone="ink" />
              </div>
            ) : myDues.length > 1 ? (
              <p className="border-y border-ink/15 py-4 text-xs leading-relaxed">
                모임마다 입금 계좌가 달라요.
                <br />
                {guest ? "모임 화면에서 확인해 주세요." : "정산 내역에서 확인해 주세요."}
              </p>
            ) : null}
            {/* 게스트는 정산 탭을 보지 않는다 */}
            {guest ? null : (
              <Link
                to="/app/payments"
                className="text-link mt-4 flex w-full justify-between"
              >
                정산 내역 보기 <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </section>
        <section className="card home-upcoming">
          <SectionHeading
            title="다음에도, 함께"
            sub="다가오는 우리 모임"
            action={
              <Link
                to="/app/calendar?view=list"
                className="circle-link"
                aria-label="전체 일정 보기"
              >
                <ArrowUpRight size={18} />
              </Link>
            }
          />
          {upcoming.length > 1 ? (
            <ul className="mt-2">
              {upcoming.slice(1, 4).map((g) => (
                <li key={g.id}>
                  <Link
                    to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                    className="upcoming-row"
                  >
                    <span className="w-11 shrink-0 text-center">
                      <strong className="block font-display text-[28px] font-semibold leading-none tracking-tight">
                        {dateParts(g.event_date).d}
                      </strong>
                      <small className="mt-1.5 block text-[10px] text-slate-500 dark:text-slate-400">
                        {dateParts(g.event_date).m}월{" "}
                        {dateParts(g.event_date).wd}요일
                      </small>
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="flex items-center gap-1.5 text-sm">
                        <i
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${KIND_DOT[g.kind]}`}
                        />
                        <span className="truncate">{g.title}</span>
                      </strong>
                      <span className="mt-1.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {g.start_time?.slice(0, 5) ?? "시간 미정"}
                        {g.end_time
                          ? ` — ${g.end_time.slice(0, 5)}`
                          : ""} · {g.location ?? "장소 미정"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <MyVotePill g={g} />
                      <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Users size={13} />
                        {g.attendance?.attending ?? 0}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-10 text-center">
              <CalendarDays size={24} className="mx-auto text-slate-400" />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                {next
                  ? "다음 모임 이후 일정은 아직 없어요."
                  : "다가오는 일정이 없어요."}
              </p>
            </div>
          )}
          <p className="border-t border-slate-200 pt-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            꾸준히 만나는 즐거움, 오테식
          </p>
        </section>
        <CourtTile next={next} wide={!stats} />
        {stats ? (
          <Link to={`/app/members/${me.id}`} className="tile-ink home-record">
            <span className="flex items-center justify-between gap-2">
              <Eyebrow>MY RECORD</Eyebrow>
              <ArrowUpRight size={17} className="text-white/70" />
            </span>
            <h2 className="mt-3 text-xs font-medium text-white/80">
              차곡차곡 쌓인 실력
            </h2>
            <p className="mt-5 font-display text-[48px] font-bold leading-none tracking-[-0.06em] text-house-yellow sm:text-[64px]">
              {stats.overall.total ? pct : "—"}
              {stats.overall.total > 0 && (
                <span className="ml-1 text-2xl">%</span>
              )}
            </p>
            {stats.overall.total > 0 && (
              <div
                className="record-meter"
                aria-label={`${stats.overall.wins}승 ${stats.overall.losses}패 ${stats.overall.draws}무`}
              >
                <span style={{ flex: stats.overall.wins }} />
                <span style={{ flex: stats.overall.losses }} />
                <span style={{ flex: stats.overall.draws }} />
              </div>
            )}
            <span className="mt-auto flex flex-wrap justify-between gap-2 pt-5 text-xs text-white/70">
              <span>
                {stats.overall.total
                  ? `${stats.overall.wins}승 ${stats.overall.losses}패`
                  : "첫 경기를 기다려요"}
              </span>
              <span>총 {stats.overall.total}경기</span>
            </span>
          </Link>
        ) : null}
        {FEATURES.ranking && stats ? (
          <section className="card home-ranking">
            <SectionHeading
              title="코트 위의 주인공들"
              sub="우리 클럽 승률 TOP 3"
              action={
                <Link to="/app/ranking" className="text-link">
                  전체 랭킹 <ArrowUpRight size={15} />
                </Link>
              }
            />
            {ranking.length ? (
              <div className="ranking-strip">
                {ranking.slice(0, 3).map((r) => (
                  <Link key={r.user.id} to={`/app/members/${r.user.id}`}>
                    <span className="font-display text-sm text-slate-500">
                      {String(r.rank).padStart(2, "0")}
                    </span>
                    <MemberAvatar user={r.user} className="!h-9 !w-9" />
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">
                        {r.user.name}
                      </strong>
                      <small className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {r.record.wins}승 {r.record.losses}패
                      </small>
                    </span>
                    <b className="ml-auto shrink-0 whitespace-nowrap font-display text-2xl font-semibold tracking-tight">
                      {Math.round(r.record.win_rate * 100)}
                      <span className="text-xs">%</span>
                    </b>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-7 text-sm text-slate-500 dark:text-slate-400">
                첫 경기 결과가 기록되면 랭킹이 생겨요.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </PageBody>
  );
}

function NextGatheringTile({
  next,
  index,
  total,
  today,
  me,
  myDue,
}: {
  next: GatheringDetail | null;
  /** 다가오는 모임 중 몇 번째(0부터)를 보여 주는지, 모두 몇 개인지 (‹ › 로 넘겨 보기) */
  index: number;
  total: number;
  today: string;
  me: User;
  myDue: number;
}) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  if (!next)
    return (
      <section className="tile-orange home-next">
        <Eyebrow>NEXT MATCH</Eyebrow>
        <ClubIllustration />
        <div className="mt-auto pt-40">
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
            다음 만남을
            <br />
            준비해 볼까요?
          </h2>
          <p className="mt-3 text-sm">앞으로 60일 안의 모임이 여기에 나와요.</p>
          <Link to="/app/calendar" className="btn-ink mt-5">
            캘린더 열기 <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>
    );
  const daysLeft = daysBetween(today, next.event_date);
  const { m, d, wd } = dateParts(next.event_date);
  const attendees = next.participants.filter((p) => p.status === "attending");
  const myVote = next.participants.find((p) => p.user.id === me.id)?.status;
  const full = isFull(next, attendees.length);
  const waiting = waitingList(next.participants);
  const myRank = waiting.findIndex((p) => p.user.id === me.id) + 1;
  // 누르는 즉시 보여 줄 상태 (정원이 찼으면 참석 신청은 대기)
  // "cancel": 참석을 한 번 더 눌러 투표 취소
  const pending = fetcher.formData?.get("status") as AttendanceStatus | "cancel" | null;
  const shownVote =
    pending === "cancel"
      ? undefined
      : pending === "attending" && full && myVote !== "attending" && myVote !== "waiting"
      ? "waiting"
      : pending ?? myVote;
  // 3일 전부터 참석자는 직접 불참 못 함 (관리자·임원진·총무는 가능)
  const locked = daysLeft <= ATTENDANCE_LOCK_DAYS && !isStaff(me);
  // 게스트는 일정은 정회원과 함께 보지만, 참석 투표는 모임 3일 전 0시부터 (직접 만든 일정은 바로)
  const guestVoteLocked =
    !me.is_admin && me.member_type === "guest" && !next.guest_vote_open && next.created_by !== me.id;
  const href = `/app/gatherings/${next.id}?from=${next.event_date}`;
  return (
    <section className="tile-orange home-next">
      <div className="relative z-10 flex items-center justify-between gap-3">
        <Eyebrow>
          NEXT MATCH / {m}.{String(d).padStart(2, "0")}
        </Eyebrow>
        <span className="flex items-center gap-1.5">
          {total > 1 ? (
            <span className="flex items-center rounded-full bg-white/25">
              <Link
                to={index - 1 <= 0 ? "/app" : `/app?n=${index - 1}`}
                preventScrollReset
                aria-label="이전 모임"
                aria-disabled={index === 0}
                className={`grid h-7 w-7 place-items-center rounded-full hover:bg-white/30 ${
                  index === 0 ? "pointer-events-none opacity-30" : ""
                }`}
              >
                <ChevronLeft size={16} />
              </Link>
              <span className="min-w-[2.2rem] text-center text-[11px] font-bold tabular-nums">
                {index + 1}/{total}
              </span>
              <Link
                to={`/app?n=${index + 1}`}
                preventScrollReset
                aria-label="다음 모임"
                aria-disabled={index >= total - 1}
                className={`grid h-7 w-7 place-items-center rounded-full hover:bg-white/30 ${
                  index >= total - 1 ? "pointer-events-none opacity-30" : ""
                }`}
              >
                <ChevronRight size={16} />
              </Link>
            </span>
          ) : null}
          <span className="chip-white !bg-white/25">
            {daysLeft === 0 ? "오늘" : `D−${daysLeft}`}
          </span>
        </span>
      </div>
      <div className="hero-intro">
        <h2 className="hero-title">
          <Link to={href} className="hover:underline">
            {next.title}
            <span className="text-white/70">.</span>
          </Link>
        </h2>
        <ClubIllustration />
      </div>
      <p className="hero-time">
        <span>
          {m}월 {d}일 {wd}요일
        </span>
        <span className="font-normal">
          {next.start_time?.slice(0, 5) ?? "시간 미정"}
          {next.end_time ? ` — ${next.end_time.slice(0, 5)}` : ""}
        </span>
      </p>
      <p className="relative z-10 mt-2 flex items-start gap-1.5 text-xs leading-relaxed">
        <MapPin size={14} className="mt-0.5 shrink-0" />
        <span>
          {next.location ?? "장소 미정"}
          {next.court_numbers ? ` · ${next.court_numbers}번 코트` : ""}
          {next.court_surface ? ` · ${COURT_SURFACE_LABEL[next.court_surface]}` : ""}
          {next.court_reservers ? (
            <span className="block">예약자명 {next.court_reservers}</span>
          ) : null}
        </span>
      </p>
      <div className="relative z-10 mt-auto pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex pl-1">
            {attendees.slice(0, 4).map((p) => (
              <MemberAvatar
                key={p.user.id}
                user={p.user}
                className="-ml-1 !h-7 !w-7 border-2 border-house-orange !text-[10px]"
              />
            ))}
          </span>
          <span className="text-xs">
            <b>{attendees.length}명</b> 함께해요
            {next.max_participants && (
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                / 정원 {next.max_participants}명
              </span>
            )}
          </span>
          <Link to={href} className="text-link ml-auto">
            모임 보기 <ArrowUpRight size={15} />
          </Link>
        </div>
        {!me.is_admin && (
          <fetcher.Form
            method="post"
            action={`/app/gatherings/${next.id}`}
            className="home-votes"
          >
            <input type="hidden" name="intent" value="vote" />
            {shownVote === "waiting" ? (
              <>
                <span role="status" className="btn-ink pointer-events-none">
                  <Check size={15} />
                  대기 {myRank > 0 ? `${myRank}번째` : "중"}
                </span>
                <button
                  name="status"
                  value="absent"
                  disabled={fetcher.state !== "idle"}
                  className="btn-line"
                >
                  대기 취소
                </button>
              </>
            ) : (
              <>
                <button
                  // 참석 중에 한 번 더 누르면 참석 취소 (모임 3일 전부터는 눌러도 그대로)
                  type={myVote === "attending" && locked ? "button" : "submit"}
                  name="status"
                  value={myVote === "attending" ? "cancel" : "attending"}
                  disabled={guestVoteLocked || fetcher.state !== "idle"}
                  aria-pressed={shownVote === "attending"}
                  title={
                    myVote === "attending"
                      ? locked
                        ? "모임 3일 전부터는 참석 취소를 할 수 없어요"
                        : "한 번 더 누르면 참석 취소"
                      : undefined
                  }
                  className={`${shownVote === "attending" ? "btn-ink" : "btn-line"}${
                    myVote === "attending" && locked ? " cursor-default" : ""
                  }`}
                >
                  {shownVote === "attending" && <Check size={15} />}
                  {full && shownVote !== "attending" ? "대기 신청" : "참석할게요"}
                </button>
                <button
                  name="status"
                  value="absent"
                  disabled={guestVoteLocked || (locked && myVote === "attending") || fetcher.state !== "idle"}
                  aria-pressed={shownVote === "absent"}
                  title={
                    locked && myVote === "attending"
                      ? "모임 3일 전부터는 불참으로 변경할 수 없어요"
                      : undefined
                  }
                  className={shownVote === "absent" ? "btn-ink" : "btn-line"}
                >
                  {shownVote === "absent" && <Check size={15} />}
                  불참
                </button>
              </>
            )}
          </fetcher.Form>
        )}
        {fetcher.data?.error && (
          <p role="alert" className="mt-3 rounded-xl bg-white/60 p-3 text-sm">
            {fetcher.data.error}
          </p>
        )}
        {(!me.is_admin && (guestVoteLocked || myVote === "waiting" || full || myVote === "attending")) ||
        myDue > 0 ? (
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px]">
            <span>
              {me.is_admin
                ? ""
                : guestVoteLocked && next.guest_vote_open_at
                ? `게스트 투표는 ${formatOpenAt(next.guest_vote_open_at)}부터 열려요.`
                : myVote === "waiting"
                ? "자리가 나면 순서대로 자동 참석돼요."
                : locked && myVote === "attending"
                ? "참석 취소는 운영진에게 문의해 주세요."
                : myVote === "attending"
                ? "참석을 한 번 더 누르면 취소돼요."
                : full
                ? `정원이 다 찼어요 · 대기 ${waiting.length}명`
                : ""}
            </span>
            {myDue > 0 && (
              <Link to={href} className="underline underline-offset-2">
                내 참가비 {won(myDue)} · 입금 전
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
function CourtTile({
  next,
  wide = false,
}: {
  next: GatheringDetail | null;
  /** 옆의 MY RECORD 카드가 없을 때(관리자 외) 그 자리까지 넓게 */
  wide?: boolean;
}) {
  const labels = next?.court_numbers
    ? next.court_numbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : Array.from({ length: next?.court_count ?? 0 }, () => "");
  return (
    <section className={`tile-blue home-court ${wide ? "home-court-wide" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>OUR COURT</Eyebrow>
        {next && (
          <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-[10px] sm:inline">
            {next.court_count}면
          </span>
        )}
      </div>
      {next ? (
        <>
          <div
            className={`my-6 grid gap-2.5 ${
              labels.length > 1
                ? wide
                  ? "grid-cols-2 sm:grid-cols-3"
                  : "grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            {labels.slice(0, 6).map((label, i) => (
              <TennisCourt key={i} label={label} surface={next.court_surface} />
            ))}
          </div>
          <div className="mt-auto flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold">우리의 코트</h2>
              <p className="mt-2 text-xs leading-relaxed text-white/85">
                {next.location ?? "장소 미정"}
                {next.court_surface ? ` · ${COURT_SURFACE_LABEL[next.court_surface]} 코트` : ""}
                {labels.length > 6 ? ` · 외 ${labels.length - 6}면` : ""}
              </p>
            </div>
            {naverMapUrl(next) && (
              <a
                href={naverMapUrl(next) ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/40"
                aria-label="네이버 지도에서 코트 보기"
              >
                <ArrowUpRight size={16} />
              </a>
            )}
          </div>
        </>
      ) : (
        <div className="my-auto py-9">
          <MapPin size={25} />
          <h2 className="mt-4 text-base font-bold">다음 코트는 어디?</h2>
          <p className="mt-2 text-xs leading-relaxed">
            모임이 등록되면 장소와 코트를 확인할 수 있어요.
          </p>
        </div>
      )}
    </section>
  );
}
