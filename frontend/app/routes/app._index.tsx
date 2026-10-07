import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { ArrowUpRight, Check, Users } from "lucide-react";

import { BallBasket } from "~/components/BallBasket";
import { CopyButton } from "~/components/CopyButton";
import { Marquee } from "~/components/Marquee";
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
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
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
const VOTE_LABEL: Record<AttendanceStatus, string> = { attending: "참석", absent: "불참", maybe: "미정" };

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const today = todayKST();
  const [me, gatherings, myDues, ranking] = await Promise.all([
    api<User>("/users/me", { token }),
    api<Gathering[]>(`/gatherings?date_from=${today}&date_to=${addDays(today, 60)}`, { token }),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
    api<RankingEntry[]>("/stats/ranking", { token }),
  ]);
  const upcoming = gatherings.filter((g) => g.status !== "canceled");
  const [next, stats, pending] = await Promise.all([
    upcoming[0] ? api<GatheringDetail>(`/gatherings/${upcoming[0].id}`, { token }) : Promise.resolve(null),
    api<PlayerStats>(`/stats/users/${me.id}`, { token }),
    me.is_admin ? api<User[]>("/admin/signups/pending", { token }) : Promise.resolve([] as User[]),
  ]);
  return json({ today, me, next, upcoming, myDues, stats, ranking: ranking.slice(0, 5), pendingCount: pending.length });
}

export default function HomePage() {
  const { today, me, next, upcoming, myDues, stats, ranking, pendingCount } = useLoaderData<typeof loader>();
  const myDueTotal = myDues.reduce((s, d) => s + d.amount, 0);
  const weekCount = upcoming.filter((g) => daysBetween(today, g.event_date) < 7).length;
  const winPct = Math.round(stats.overall.win_rate * 100);

  // 소식 띠: 지금 알아두면 좋은 것들
  const news = [
    next ? `${shortDay(next.event_date)} ${next.title}${next.location ? ` · ${next.location}` : ""}` : "",
    weekCount > 0 ? `이번 주 모임 ${weekCount}개` : "",
    myDueTotal > 0 ? `내가 낼 참가비 ${won(myDueTotal)}` : "",
    ranking[0] ? `랭킹 1위 ${ranking[0].user.name} · 승률 ${Math.round(ranking[0].record.win_rate * 100)}%` : "",
    ...upcoming.slice(1, 4).map((g) => `${shortDay(g.event_date)} ${g.title}`),
    me.is_admin && pendingCount > 0 ? `가입 신청 ${pendingCount}건 대기 중` : "",
  ].filter(Boolean);
  if (news.length < 3) news.push("오순도순 테니스 식구, 오테식");

  return (
    <PageBody>
      <PageHeader
        title={`안녕하세요, ${me.name}님`}
        sub={
          weekCount > 0
            ? `이번 주에 모임이 ${weekCount}개 있어요.`
            : next
              ? `다음 모임은 ${dateParts(next.event_date).m}월 ${dateParts(next.event_date).d}일이에요.`
              : "다가오는 모임이 없어요."
        }
        actions={
          me.is_admin && pendingCount > 0 ? (
            <Link to="/app/admin" className="btn-accent btn-sm">
              가입 신청 {pendingCount}건
              <ArrowUpRight size={14} />
            </Link>
          ) : null
        }
      />

      <Marquee items={news} />

      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* 1열: 다음 모임 */}
        <NextGatheringTile next={next} today={today} me={me} myDue={next ? (myDues.find((d) => d.gathering_id === next.id)?.amount ?? 0) : 0} />

        {/* 참가비 · 승률 · 다가오는 일정 (모바일에서는 다음 모임 바로 아래) */}
        <div className="grid grid-cols-2 content-start gap-3.5 md:grid-cols-1 xl:order-last">
          <section className="tile-yellow flex flex-col">
            <h2 className="tile-title">내가 낼 참가비</h2>
            <p className="tile-sub truncate">
              {myDues.length === 0 ? "모두 입금했어요" : myDues.length === 1 ? myDues[0].title : `${myDues.length}건 입금 전`}
            </p>
            <p className="mt-4 font-display text-[30px] font-extrabold leading-none tracking-[-0.05em] sm:text-[42px]">
              {myDueTotal > 0 ? won(myDueTotal) : "없음"}
            </p>
            {myDues[0]?.account_number ? (
              <div className="tile-rows mt-3 hidden sm:block">
                <div>
                  <span className="min-w-0 truncate">
                    {myDues[0].bank ? `${myDues[0].bank} ` : ""}
                    {myDues[0].account_number}
                  </span>
                  <CopyButton text={myDues[0].account_number} tone="ink" className="!h-7" />
                </div>
                {myDues[0].account_holder ? (
                  <div>
                    <span>예금주 {myDues[0].account_holder}</span>
                    <span className="text-[13px] font-bold">입금 전</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <Link to="/app/payments" className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-bold">
              정산 보기
              <ArrowUpRight size={14} />
            </Link>
          </section>

          <Link to={`/app/members/${me.id}`} className="tile-ink flex flex-col transition-transform hover:-translate-y-0.5">
            <span className="flex items-center justify-between text-[15px] font-bold">
              내 승률
              <ArrowUpRight size={16} className="text-white/55" />
            </span>
            <span className="mt-auto flex flex-wrap items-baseline gap-x-3 pt-4">
              <span className="font-display text-[44px] font-extrabold leading-none tracking-[-0.05em] text-house-yellow sm:text-[58px]">
                {stats.overall.total > 0 ? `${winPct}%` : "–"}
              </span>
              <span className="text-[13px] font-semibold text-white/70">
                {stats.overall.total > 0 ? `${stats.overall.wins}승 ${stats.overall.losses}패` : "아직 기록이 없어요"}
              </span>
            </span>
          </Link>

          <section className="tile-green col-span-2 md:col-span-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="tile-title">다가오는 일정</h2>
                <p className="tile-sub">60일 안 {upcoming.length}개</p>
              </div>
              <Link to="/app/calendar?view=list" className="btn-line btn-sm">
                전체
                <ArrowUpRight size={14} />
              </Link>
            </div>
            {upcoming.length <= 1 ? (
              <p className="mt-4 text-sm font-semibold">
                {upcoming.length === 0 ? "잡힌 일정이 없어요." : "다음 모임 이후 일정은 아직 없어요."}
              </p>
            ) : (
              <ul className="tile-rows mt-3">
                {upcoming.slice(1, 5).map((g) => (
                  <li key={g.id}>
                    <Link to={`/app/gatherings/${g.id}?from=${g.event_date}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                      <b className="shrink-0 font-extrabold">{shortDay(g.event_date)}</b>
                      <span className="truncate">{g.title}</span>
                    </Link>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-bold">
                      <Users size={13} />
                      {g.attendance?.attending ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 코트 · 랭킹 */}
        <div className="grid content-start gap-3.5 md:col-span-2 md:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
          {next ? <CourtTile next={next} /> : null}
          <section className="tile-lav">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="tile-title">랭킹</h2>
                <p className="tile-sub">승률 TOP {Math.min(5, ranking.length) || 5}</p>
              </div>
              <Link to="/app/ranking" className="btn-line btn-sm">
                전체
                <ArrowUpRight size={14} />
              </Link>
            </div>
            {ranking.length === 0 ? (
              <p className="mt-4 text-sm font-semibold">아직 집계된 전적이 없어요.</p>
            ) : (
              <ol className="tile-rows mt-3">
                {ranking.map((r) => (
                  <li key={r.user.id}>
                    <Link to={`/app/members/${r.user.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                      <b className="w-3 font-display font-extrabold">{r.rank}</b>
                      <span className="truncate">{r.user.name}</span>
                    </Link>
                    <span className="shrink-0 text-[13.5px]">
                      {r.record.wins}승 {r.record.losses}패 · <b className="font-extrabold">{Math.round(r.record.win_rate * 100)}%</b>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </PageBody>
  );
}

/** 다음 모임: D-day, 일시·장소, 참석자, 바로 참석 투표, 내 참가비 */
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
  // 모임 상세의 투표 액션을 그대로 호출하고, 페이지 이동 없이 홈을 갱신한다
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();

  if (!next) {
    return (
      <section className="tile-orange flex min-h-[340px] flex-col">
        <BallBasket className="pointer-events-none absolute right-5 top-5 w-28 sm:w-36" />
        <div className="mt-auto">
          <h2 className="font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.05em]">
            잡힌 모임이
            <br />
            아직 없어요
          </h2>
          <p className="mt-2 text-[15px] font-semibold">앞으로 60일 안의 일정이 여기 나와요.</p>
          <Link to="/app/calendar" className="btn-ink mt-5">
            캘린더 열기
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
    );
  }

  const daysLeft = daysBetween(today, next.event_date);
  const { m, d, wd } = dateParts(next.event_date);
  const attendees = next.participants.filter((p) => p.status === "attending");
  const myVote = next.participants.find((p) => p.user.id === me.id)?.status;
  const shownVote = (fetcher.formData?.get("status") as AttendanceStatus | null) ?? myVote;
  const locked = daysLeft <= ATTENDANCE_LOCK_DAYS;
  const time = next.start_time
    ? `${next.start_time.slice(0, 5)}${next.end_time ? ` – ${next.end_time.slice(0, 5)}` : ""}`
    : "시간 미정";
  const detailHref = `/app/gatherings/${next.id}?from=${next.event_date}`;

  return (
    <section className="tile-orange flex min-h-[400px] flex-col sm:p-7 xl:min-h-[660px]">
      <div>
        <span className="chip-line h-8 px-3.5 text-[13px]">다음 모임 · {daysLeft === 0 ? "오늘" : `D-${daysLeft}`}</span>
      </div>
      <BallBasket className="pointer-events-none absolute right-4 top-4 w-28 sm:w-36 xl:left-1/2 xl:right-auto xl:top-20 xl:w-64 xl:-translate-x-1/2" />

      <div className="mt-auto pt-24 sm:pt-32 xl:pt-[300px]">
        {attendees.length > 0 ? (
          <div className="flex items-center">
            {attendees.slice(0, 5).map((p, i) => (
              <span
                key={p.user.id}
                title={p.user.name}
                className={`avatar h-9 w-9 border-2 border-ink bg-white text-[13px] text-ink ${i > 0 ? "-ml-2" : ""}`}
              >
                {p.user.name.charAt(0)}
              </span>
            ))}
            {attendees.length > 5 ? (
              <span className="avatar -ml-2 h-9 w-9 border-2 border-ink bg-ink text-[11px] text-white">
                +{attendees.length - 5}
              </span>
            ) : null}
          </div>
        ) : null}

        <h2 className="mt-4 font-display text-[36px] font-extrabold leading-[1.02] tracking-[-0.05em] sm:text-[50px]">
          <Link to={detailHref} className="hover:underline">
            {next.title}
          </Link>
        </h2>
        <p className="mt-3 text-[16px] font-extrabold">
          {m}.{d} {wd} · {time}
        </p>
        <p className="mt-1 text-[14.5px] font-medium">
          {next.location ?? "장소 미정"} · 참석 {attendees.length}
          {next.max_participants ? ` / ${next.max_participants}` : ""}명
          {next.fee > 0 && next.per_person > 0 ? ` · 1인 ${won(next.per_person)}` : ""}
        </p>

        {/* 바로 투표 (관리자는 투표하지 않음) */}
        {!me.is_admin ? (
          <fetcher.Form method="post" action={`/app/gatherings/${next.id}`} className="mt-5 flex gap-2">
            <input type="hidden" name="intent" value="vote" />
            {(["attending", "absent", "maybe"] as AttendanceStatus[]).map((s) => {
              const selected = shownVote === s;
              const blocked = s !== "attending" && locked;
              return (
                <button
                  key={s}
                  name="status"
                  value={s}
                  disabled={blocked}
                  aria-pressed={selected}
                  title={blocked ? `모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 바꿀 수 없어요` : undefined}
                  className={`${selected ? "btn-ink" : "btn-line"} h-11 flex-1 text-[15px] disabled:cursor-not-allowed`}
                >
                  {selected ? <Check size={16} /> : null}
                  {VOTE_LABEL[s]}
                </button>
              );
            })}
          </fetcher.Form>
        ) : null}
        {fetcher.data?.error ? <p className="mt-3 rounded-2xl bg-white/70 px-4 py-2.5 text-sm font-bold">{fetcher.data.error}</p> : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[14px] font-bold">
          {myDue > 0 ? (
            <Link to={detailHref} className="underline decoration-2 underline-offset-4">
              내 참가비 {won(myDue)} · 입금 전
            </Link>
          ) : (
            <span />
          )}
          <Link to={detailHref} className="inline-flex items-center gap-1">
            자세히
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** 다음 모임 장소와 코트 배정 (코트는 위에서 본 모양) */
function CourtTile({ next }: { next: GatheringDetail }) {
  const labels = next.court_numbers
    ? next.court_numbers.split(",").map((s) => s.trim()).filter(Boolean)
    : Array.from({ length: next.court_count }, () => "");
  const shown = labels.slice(0, 6);
  return (
    <section className="tile-blue">
      <div className="flex items-start justify-between gap-2">
        <span className="chip-white h-8 min-w-0 truncate px-3.5 text-[13px]">{next.location ?? "장소 미정"}</span>
        {next.location ? (
          <a
            href={`https://map.naver.com/p/search/${encodeURIComponent(next.location)}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ink btn-sm shrink-0"
          >
            지도
            <ArrowUpRight size={14} />
          </a>
        ) : null}
      </div>
      <div className={`mt-5 grid gap-2.5 ${shown.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {shown.map((label, i) => (
          <div key={i} className="relative aspect-[2.2/1] rounded-lg border-2 border-white/85 bg-house-yellow">
            {/* 네트 + 서비스 라인 */}
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/85" />
            <span className="absolute inset-x-[22%] top-1/2 h-0.5 -translate-y-1/2 bg-white/70" />
            <span className="absolute inset-y-[14%] left-[22%] w-0.5 bg-white/70" />
            <span className="absolute inset-y-[14%] right-[22%] w-0.5 bg-white/70" />
            {label ? (
              <span className="absolute left-2 top-1/2 flex h-8 w-7 -translate-y-1/2 items-center justify-center rounded-[8px_8px_8px_2px] bg-ink font-display text-sm font-extrabold text-white">
                {label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[15px] font-bold">
        {next.court_numbers ? `코트 ${labels.join(" · ")}번` : "코트"} · {next.court_count}면
      </p>
    </section>
  );
}
