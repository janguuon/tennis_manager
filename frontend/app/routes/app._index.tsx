import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import {
  ArrowUpRight,
  Check,
  Users,
  MapPin,
  Wallet,
  CalendarDays,
} from "lucide-react";

import {
  ClubIllustration,
  Eyebrow,
  MemberAvatar,
  SectionHeading,
  TennisCourt,
} from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { PageBody, PageHeader } from "~/components/Page";
import { api } from "~/lib/api.server";
import { won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import { WEEKDAYS } from "~/lib/status";
import type {
  AttendanceStatus,
  Gathering,
  GatheringDetail,
  MyPaymentDue,
  PlayerStats,
  RankingEntry,
  User,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "홈 · 오테식 매니저" }];

/** 오늘 날짜 "YYYY-MM-DD" (서버가 어느 시간대에 있든 한국 기준) */
function todayKST(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date()
  );
}

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

const ATTENDANCE_LOCK_DAYS = 3;
const VOTE_LABEL: Record<AttendanceStatus, string> = {
  attending: "참석",
  absent: "불참",
  maybe: "미정",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const today = todayKST();
  const [me, gatherings, myDues, ranking] = await Promise.all([
    api<User>("/users/me", { token }),
    api<Gathering[]>(
      `/gatherings?date_from=${today}&date_to=${addDays(today, 60)}`,
      { token }
    ),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
    api<RankingEntry[]>("/stats/ranking", { token }),
  ]);
  const upcoming = gatherings.filter(
    (g) => g.status === "planned" || g.status === "ongoing"
  );
  const [next, stats, pending] = await Promise.all([
    upcoming[0]
      ? api<GatheringDetail>(`/gatherings/${upcoming[0].id}`, { token })
      : Promise.resolve(null),
    api<PlayerStats>(`/stats/users/${me.id}`, { token }),
    me.is_admin
      ? api<User[]>("/admin/signups/pending", { token })
      : Promise.resolve([] as User[]),
  ]);
  return json({
    today,
    me,
    next,
    upcoming,
    myDues,
    stats,
    ranking: ranking.slice(0, 5),
    pendingCount: pending.length,
  });
}

export default function HomePage() {
  const { today, me, next, upcoming, myDues, stats, ranking, pendingCount } =
    useLoaderData<typeof loader>();
  const totalDue = myDues.reduce((sum, due) => sum + due.amount, 0);
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
  const pct = Math.round(stats.overall.win_rate * 100);
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
          <Link to="/app/calendar" className="btn-ghost">
            이번 달 일정 <ArrowUpRight size={16} />
          </Link>
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
            : next
            ? `${shortDay(next.event_date)} ${next.title} · ${
                next.attendance?.attending ?? 0
              }명 함께해요.`
            : "좋아하는 사람들과, 좋아하는 테니스를."}
        </p>
        <Link
          to={
            me.is_admin && pendingCount
              ? "/app/admin"
              : next
              ? `/app/gatherings/${next.id}`
              : "/app/calendar"
          }
          className="text-link"
          aria-label={
            me.is_admin && pendingCount ? "가입 신청 확인" : "모임 확인"
          }
        >
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="home-grid">
        <NextGatheringTile
          next={next}
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
                정산 내역에서 확인해 주세요.
              </p>
            ) : null}
            <Link
              to="/app/payments"
              className="text-link mt-4 flex w-full justify-between"
            >
              정산 내역 보기 <ArrowUpRight size={16} />
            </Link>
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
                      <strong className="block truncate text-sm">
                        {g.title}
                      </strong>
                      <span className="mt-1.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {g.start_time?.slice(0, 5) ?? "시간 미정"}
                        {g.end_time
                          ? ` — ${g.end_time.slice(0, 5)}`
                          : ""} · {g.location ?? "장소 미정"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      <Users size={13} />
                      {g.attendance?.attending ?? 0}
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
        <CourtTile next={next} />
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
      </div>
    </PageBody>
  );
}

function NextGatheringTile({
  next,
  today,
  me,
  myDue,
}: {
  next: GatheringDetail | null;
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
  const shownVote =
    (fetcher.formData?.get("status") as AttendanceStatus | null) ?? myVote;
  const locked = daysLeft <= ATTENDANCE_LOCK_DAYS;
  const href = `/app/gatherings/${next.id}?from=${next.event_date}`;
  return (
    <section className="tile-orange home-next">
      <div className="relative z-10 flex items-center justify-between gap-3">
        <Eyebrow>
          NEXT MATCH / {m}.{String(d).padStart(2, "0")}
        </Eyebrow>
        <span className="chip-white !bg-white/25">
          {daysLeft === 0 ? "오늘" : `D−${daysLeft}`}
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
            {(["attending", "maybe", "absent"] as AttendanceStatus[]).map(
              (s) => {
                const selected = shownVote === s;
                const blocked = s !== "attending" && locked;
                return (
                  <button
                    key={s}
                    name="status"
                    value={s}
                    disabled={blocked || fetcher.state !== "idle"}
                    aria-pressed={selected}
                    title={
                      blocked
                        ? "모임 3일 전부터는 불참·미정으로 변경할 수 없어요"
                        : undefined
                    }
                    className={selected ? "btn-ink" : "btn-line"}
                  >
                    {selected && <Check size={15} />}
                    {s === "attending" ? "참석할게요" : VOTE_LABEL[s]}
                  </button>
                );
              }
            )}
          </fetcher.Form>
        )}
        {fetcher.data?.error && (
          <p role="alert" className="mt-3 rounded-xl bg-white/60 p-3 text-sm">
            {fetcher.data.error}
          </p>
        )}
        {(locked && !me.is_admin) || myDue > 0 ? (
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px]">
            <span>
              {locked && !me.is_admin
                ? "불참·미정 변경은 관리자에게 문의해 주세요."
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
function CourtTile({ next }: { next: GatheringDetail | null }) {
  const labels = next?.court_numbers
    ? next.court_numbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : Array.from({ length: next?.court_count ?? 0 }, () => "");
  return (
    <section className="tile-blue home-court">
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
              labels.length > 1 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {labels.slice(0, 6).map((label, i) => (
              <TennisCourt key={i} label={label} />
            ))}
          </div>
          <div className="mt-auto flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold">우리의 코트</h2>
              <p className="mt-2 text-xs leading-relaxed text-white/85">
                {next.location ?? "장소 미정"}
                {labels.length > 6 ? ` · 외 ${labels.length - 6}면` : ""}
              </p>
            </div>
            {next.location && (
              <a
                href={`https://map.naver.com/p/search/${encodeURIComponent(
                  next.location
                )}`}
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
