import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { ArrowRight, CalendarDays, Check, ChevronRight, MapPin, Users } from "lucide-react";

import { HeroHeader, PageBody, PageHero } from "~/components/Page";
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
  User,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "홈 · 테니스 매니저" }];

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

const ATTENDANCE_LOCK_DAYS = 3;
const VOTE_LABEL: Record<AttendanceStatus, string> = { attending: "참석", absent: "불참", maybe: "미정" };

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const today = todayKST();
  const [me, gatherings, myDues] = await Promise.all([
    api<User>("/users/me", { token }),
    api<Gathering[]>(`/gatherings?date_from=${today}&date_to=${addDays(today, 60)}`, { token }),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
  ]);
  const upcoming = gatherings.filter((g) => g.status !== "canceled");
  const [next, stats, pending] = await Promise.all([
    upcoming[0] ? api<GatheringDetail>(`/gatherings/${upcoming[0].id}`, { token }) : Promise.resolve(null),
    api<PlayerStats>(`/stats/users/${me.id}`, { token }),
    me.is_admin ? api<User[]>("/admin/signups/pending", { token }) : Promise.resolve([] as User[]),
  ]);
  return json({ today, me, next, upcoming, myDues, stats, pendingCount: pending.length });
}

export default function HomePage() {
  const { today, me, next, upcoming, myDues, stats, pendingCount } = useLoaderData<typeof loader>();
  const myDueTotal = myDues.reduce((s, d) => s + d.amount, 0);
  const weekCount = upcoming.filter((g) => daysBetween(today, g.event_date) < 7).length;
  const winPct = Math.round(stats.overall.win_rate * 100);

  return (
    <>
      <PageHero>
        <HeroHeader
          title={`안녕하세요, ${me.name}님`}
          sub={
            weekCount > 0
              ? `이번 주에 모임이 ${weekCount}개 있어요.`
              : next
                ? `다음 모임은 ${dateParts(next.event_date).m}월 ${dateParts(next.event_date).d}일이에요.`
                : "다가오는 모임이 없어요."
          }
        />
      </PageHero>

      <PageBody>
        {next ? (
          <NextGatheringCard next={next} today={today} me={me} myDue={myDues.find((d) => d.gathering_id === next.id)?.amount ?? 0} />
        ) : (
          <section className="card flex flex-col items-center gap-3 py-12 text-center">
            <CalendarDays size={28} className="text-slate-300" />
            <p className="text-sm text-slate-500">앞으로 60일 안에 잡힌 모임이 없어요.</p>
            <Link to="/app/calendar" className="btn-primary btn-sm">
              캘린더 열기
            </Link>
          </section>
        )}

        {/* 요약 */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryTile
            to="/app/payments"
            label="내가 낼 참가비"
            value={myDueTotal > 0 ? won(myDueTotal) : "없음"}
            sub={myDueTotal > 0 ? `${myDues.length}건 입금 전` : "모두 입금했어요"}
            tone={myDueTotal > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
          <SummaryTile
            to={`/app/members/${me.id}`}
            label="내 승률"
            value={stats.overall.total > 0 ? `${winPct}%` : "–"}
            sub={
              stats.overall.total > 0
                ? `${stats.overall.wins}승 ${stats.overall.losses}패`
                : "아직 기록이 없어요"
            }
          />
          {me.is_admin ? (
            <SummaryTile
              to="/app/admin"
              label="가입 신청"
              value={`${pendingCount}건`}
              sub={pendingCount > 0 ? "승인을 기다려요" : "대기 없음"}
              tone={pendingCount > 0 ? "text-ball-800 dark:text-ball-300" : undefined}
            />
          ) : (
            <SummaryTile
              to="/app/calendar?view=list"
              label="다가오는 모임"
              value={`${upcoming.length}개`}
              sub="60일 안"
            />
          )}
        </div>

        {/* 다가오는 일정 */}
        <section className="card overflow-hidden !p-0">
          <div className="flex items-center justify-between px-4 pb-1 pt-4 sm:px-5">
            <h2 className="section-title">다가오는 일정</h2>
            <Link
              to="/app/calendar"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              캘린더
              <ArrowRight size={14} />
            </Link>
          </div>
          {upcoming.length <= 1 ? (
            <p className="px-4 pb-5 pt-2 text-sm text-slate-400 sm:px-5">
              {upcoming.length === 0 ? "잡힌 일정이 없어요." : "다음 모임 이후 일정은 아직 없어요."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {upcoming.slice(1, 6).map((g) => {
                const { m, d, wd } = dateParts(g.event_date);
                return (
                  <li key={g.id}>
                    <Link
                      to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-5"
                    >
                      <div className="w-10 shrink-0 text-center leading-tight">
                        <div className="text-[11px] font-medium text-slate-400">{m}월</div>
                        <div className="text-lg font-bold text-slate-900 dark:text-white">{d}</div>
                        <div className="text-[11px] text-slate-400">{wd}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900 dark:text-white">{g.title}</p>
                        <p className="truncate text-[13px] text-slate-500">
                          {g.start_time ? g.start_time.slice(0, 5) : "시간 미정"} · {g.location ?? "장소 미정"}
                          {g.fee > 0 && g.per_person > 0 ? ` · 1인 ${won(g.per_person)}` : ""}
                        </p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-slate-500">
                        <Users size={14} />
                        {g.attendance?.attending ?? 0}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}

/** 다음 모임: D-day, 일시·장소, 참석자, 바로 참석 투표, 내 참가비 */
function NextGatheringCard({
  next,
  today,
  me,
  myDue,
}: {
  next: GatheringDetail;
  today: string;
  me: User;
  myDue: number;
}) {
  // 모임 상세의 투표 액션을 그대로 호출하고, 페이지 이동 없이 홈을 갱신한다
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const daysLeft = daysBetween(today, next.event_date);
  const { m, d, wd } = dateParts(next.event_date);
  const attendees = next.participants.filter((p) => p.status === "attending");
  const myVote = next.participants.find((p) => p.user.id === me.id)?.status;
  const shownVote = (fetcher.formData?.get("status") as AttendanceStatus | null) ?? myVote;
  const locked = daysLeft <= ATTENDANCE_LOCK_DAYS;
  const time = next.start_time
    ? `${next.start_time.slice(0, 5)}${next.end_time ? ` – ${next.end_time.slice(0, 5)}` : ""}`
    : "시간 미정";

  return (
    <section className="card space-y-5 sm:!p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="badge-accent">{daysLeft === 0 ? "오늘" : `D-${daysLeft}`}</span>
          <h2 className="mt-2 truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            {next.title}
          </h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} />
              {m}월 {d}일 ({wd}) · {time}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} />
              {next.location ?? "장소 미정"}
            </span>
          </p>
        </div>
        <Link to={`/app/gatherings/${next.id}?from=${next.event_date}`} className="btn-ghost btn-sm shrink-0">
          자세히
          <ChevronRight size={14} />
        </Link>
      </div>

      {/* 참석자 */}
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {attendees.slice(0, 6).map((p) => (
            <span
              key={p.user.id}
              title={p.user.name}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 ring-2 ring-white dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-900"
            >
              {p.user.name.charAt(0)}
            </span>
          ))}
        </div>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {attendees.length > 0 ? `${attendees.length}명 참석` : "아직 참석자가 없어요"}
          {next.max_participants ? ` · 정원 ${next.max_participants}명` : ""}
        </span>
      </div>

      {/* 바로 투표 (관리자는 투표하지 않음) */}
      {!me.is_admin ? (
        <fetcher.Form method="post" action={`/app/gatherings/${next.id}`} className="grid grid-cols-3 gap-2">
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
        </fetcher.Form>
      ) : null}
      {fetcher.data?.error ? <p className="alert-error">{fetcher.data.error}</p> : null}

      {/* 이 모임의 내 참가비 */}
      {myDue > 0 ? (
        <Link
          to={`/app/gatherings/${next.id}?from=${next.event_date}`}
          className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span>
            내 참가비 <b className="font-bold">{won(myDue)}</b> · 입금 전
          </span>
          <span className="inline-flex items-center gap-0.5 text-[13px] font-medium">
            계좌 보기
            <ChevronRight size={14} />
          </span>
        </Link>
      ) : null}
    </section>
  );
}

function SummaryTile({
  to,
  label,
  value,
  sub,
  tone = "text-slate-900 dark:text-white",
}: {
  to: string;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <Link to={to} className="card-link !p-3.5 sm:!p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold sm:text-xl ${tone}`}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>
    </Link>
  );
}
