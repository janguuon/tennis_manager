import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { ChevronRight, Lock, Sparkles, X } from "lucide-react";

import { MemberAvatar } from "~/components/Club";
import { BackLink, PageBody, PageHeader } from "~/components/Page";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import { MEMBER_TYPE_LABEL } from "~/lib/status";
import { TIERS, TIER_CLASS, signed } from "~/lib/tier";
import type { RatingBoard, RatingHistory, RatingRow, Tier } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "내부 티어 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const userId = new URL(request.url).searchParams.get("user");
  try {
    const [board, history] = await Promise.all([
      api<RatingBoard>("/admin/ratings", { token }),
      userId && /^\d+$/.test(userId)
        ? api<RatingHistory>(`/admin/ratings/${userId}`, { token }).catch(
            () => null
          )
        : Promise.resolve(null),
    ]);
    return json({ board, history });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw redirect("/app");
    throw err;
  }
}

function tierRange(tier: Tier, floors: Record<string, number>, short = false) {
  const i = TIERS.indexOf(tier);
  const low = floors[tier];
  const high = i > 0 ? floors[TIERS[i - 1]] : undefined;
  if (low === undefined) return short ? `<${high}` : `${high}점 미만`;
  if (high === undefined || short) return short ? `${low}+` : `${low}점 이상`;
  return `${low}~${high - 1}점`;
}

function record(r: { wins: number; losses: number; draws: number }) {
  return `${r.wins}승 ${r.losses}패${r.draws ? ` ${r.draws}무` : ""}`;
}

function changeClass(n: number) {
  return n > 0
    ? "text-[#2F5A22] dark:text-green-300"
    : n < 0
    ? "text-[#B42318] dark:text-red-300"
    : "text-slate-400";
}

export default function TiersPage() {
  const { board, history } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const selected = Number(params.get("user")) || null;
  const rated = board.rows.filter((r) => r.games > 0);
  const unrated = board.rows.filter((r) => r.games === 0);
  const floors = board.config.tier_floors;

  return (
    <PageBody>
      <PageHeader
        back={<BackLink to="/app/admin">클럽 관리</BackLink>}
        eyebrow="ONLY FOR THE ADMIN."
        title="내부 티어"
        sub={
          board.counted_matches > 0
            ? `오테식 모임 대진 결과 ${board.counted_matches}경기로 계산했어요`
            : "오테식 모임 대진 결과가 쌓이면 티어가 나뉘어요"
        }
        actions={
          <span className="badge-gray !h-9 px-4">
            <Lock size={14} />
            관리자만 볼 수 있어요
          </span>
        }
      />

      {/* 티어 분포 */}
      <section className="card">
        <ul className="grid grid-cols-5 gap-2 sm:gap-3">
          {TIERS.map((t) => (
            <li
              key={t}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 px-1 py-3 text-center dark:border-slate-700 sm:py-4"
            >
              <span className={TIER_CLASS[t]}>{t}</span>
              <strong className="font-display text-[22px] font-bold leading-none tracking-[-0.05em] sm:text-[28px]">
                {board.tier_counts[t] ?? 0}
              </strong>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
                <span className="sm:hidden">{tierRange(t, floors, true)}</span>
                <span className="hidden sm:inline">{tierRange(t, floors)}</span>
              </span>
            </li>
          ))}
        </ul>
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-bold text-slate-600 dark:text-slate-300">
            <ChevronRight
              size={15}
              className="transition-transform group-open:rotate-90"
            />
            티어는 이렇게 정해져요
          </summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-6 text-[13px] font-medium text-slate-600 dark:text-slate-400">
            <li>
              오테식 정모·벙개에서 <b>대진표로 치르고 결과를 입력한 경기만</b>{" "}
              반영해요. 일반 벙개, 직접 입력한 경기, 탈퇴한 회원이 뛴 경기는 빠져요. 게스트도 똑같이
              계산해요.
            </li>
            <li>
              모두 <b>{board.config.base}점</b>에서 시작해요. NTRP는 쓰지 않고
              앞으로의 경기 결과로만 정해요.
            </li>
            <li>
              <b>게임 수</b>로 계산해요. 두 팀 레이팅으로 예상한 득점률보다 많이
              따면 오르고 적게 따면 내려가요. 6:0 승리가 6:4 승리보다 많이 오르고,
              5:5 해피게임 무승부도 반영돼요. 타이브레이크로 끝내면 6:5로 적어 주세요.
            </li>
            <li>
              처음 {board.config.placement_games}경기는 배치 경기라 크게
              움직이고(경기당 최대 ±{board.config.k_placement / 2}점), 그
              뒤로는 천천히 움직여요(최대 ±{board.config.k_regular / 2}점).
            </li>
            <li>
              경계에서 오락가락하지 않도록 구간을{" "}
              {board.config.hysteresis}점 넘어서야 티어가 바뀌어요.
            </li>
            <li>
              대진을 만들 때 <b>실력 밸런스</b>를 고르면 이 레이팅으로 코트마다
              두 팀이 비슷해지게 짜요. 티어 자체는 회원에게 보이지 않아요.
            </li>
          </ul>
        </details>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* 레이팅 목록 */}
        <section className="card">
          <h2 className="section-title">레이팅 순위</h2>
          {rated.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-500">
              <Sparkles size={16} />
              아직 반영된 경기가 없어요. 오테식 모임에서 대진을 만들고 결과를
              입력해 보세요.
            </p>
          ) : (
            <ol className="mt-3">
              {rated.map((r, i) => (
                <li key={r.user.id}>
                  <RatingRowLink
                    row={r}
                    rank={i + 1}
                    selected={selected === r.user.id}
                  />
                </li>
              ))}
            </ol>
          )}
          {unrated.length > 0 ? (
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
              <p className="text-[13px] font-bold text-slate-600 dark:text-slate-300">
                아직 반영된 경기가 없는 회원 {unrated.length}명 ·{" "}
                {board.config.base}점 C에서 시작
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {unrated.map((r) => (
                  <span key={r.user.id} className="badge-gray">
                    {r.user.name}
                    {r.user.member_type === "guest" ? " · 게스트" : ""}
                  </span>
                ))}
              </p>
            </div>
          ) : null}
        </section>

        {/* 선택한 회원의 경기별 변화 */}
        <section id="history" className="card lg:sticky lg:top-6">
          {history ? (
            <HistoryPanel history={history} floors={floors} />
          ) : (
            <div className="py-6 text-center text-sm font-medium text-slate-500">
              <p className="font-bold text-ink dark:text-white">
                회원을 고르면 경기별 변화를 보여 줘요
              </p>
              <p className="mt-1">
                누구와 같은 편이었는지, 예상보다 얼마나 잘했는지 볼 수 있어요.
              </p>
            </div>
          )}
        </section>
      </div>
    </PageBody>
  );
}

function RatingRowLink({
  row: r,
  rank,
  selected,
}: {
  row: RatingRow;
  rank: number;
  selected: boolean;
}) {
  return (
    <Link
      to={selected ? "." : `?user=${r.user.id}#history`}
      preventScrollReset={false}
      className={`tier-row ${selected ? "is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <span className="font-display text-sm text-slate-500">{rank}</span>
      <span className="flex min-w-0 items-center gap-2.5">
        <MemberAvatar user={r.user} className="!h-8 !w-8 shrink-0 !text-xs" />
        <span className="min-w-0">
          <strong className="flex items-center gap-1.5 truncate text-sm">
            {r.user.name}
            {r.user.member_type !== "member" ? (
              <span className="text-[11px] font-semibold text-slate-500">
                {MEMBER_TYPE_LABEL[r.user.member_type]}
              </span>
            ) : null}
          </strong>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {r.games}경기 · {record(r)}
            {r.provisional ? " · 배치 중" : ""}
          </span>
        </span>
      </span>
      <span className="flex items-center justify-end gap-2">
        <span className={TIER_CLASS[r.tier]}>{r.tier}</span>
        <b className="w-11 text-right font-display text-lg font-bold tracking-[-0.04em]">
          {r.rating}
        </b>
      </span>
      <span className="hidden text-right text-xs text-slate-500 dark:text-slate-400 sm:block">
        {r.last_played ? `${r.last_played.slice(5).replace("-", ".")} 경기` : ""}
      </span>
      <span
        className={`hidden text-right text-sm font-bold sm:block ${changeClass(
          r.last_change
        )}`}
        title="마지막으로 뛴 모임에서의 변화"
      >
        {signed(r.last_change)}
      </span>
      <ChevronRight size={15} className="hidden text-slate-400 sm:block" />
    </Link>
  );
}

function Sparkline({
  points,
  floors,
}: {
  points: number[];
  floors: Record<string, number>;
}) {
  const W = 320;
  const H = 72;
  const lo = Math.min(...points) - 30;
  const hi = Math.max(...points) + 30;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[72px] w-full overflow-visible"
      role="img"
      aria-label="레이팅 변화 그래프"
    >
      {Object.entries(floors).map(([t, v]) =>
        v > lo && v < hi ? (
          <g key={t}>
            <line
              x1={0}
              x2={W}
              y1={y(v)}
              y2={y(v)}
              className="stroke-slate-300 dark:stroke-slate-600"
              strokeDasharray="3 4"
            />
            <text
              x={0}
              y={y(v) - 3}
              className="fill-slate-400 text-[9px] font-bold"
            >
              {t} {v}
            </text>
          </g>
        ) : null
      )}
      <polyline
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        className="stroke-house-blue"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1])}
        r={4}
        className="fill-house-blue"
      />
    </svg>
  );
}

function HistoryPanel({
  history,
  floors,
}: {
  history: RatingHistory;
  floors: Record<string, number>;
}) {
  const { row: r, events } = history;
  const chronological = [...events].reverse();
  const points = [
    chronological.length ? chronological[0].rating_after - chronological[0].delta : r.rating,
    ...chronological.map((e) => e.rating_after),
  ].map(Math.round);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar user={r.user} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-extrabold">
              {r.user.name}
              <span className={TIER_CLASS[r.tier]}>{r.tier}</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {MEMBER_TYPE_LABEL[r.user.member_type]} · {r.games}경기 ·{" "}
              {record(r)}
            </p>
          </div>
        </div>
        <Link
          to="."
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-ink/10"
          aria-label="닫기"
        >
          <X size={16} />
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-slate-100 py-2.5 dark:bg-slate-800">
          <dt className="text-[11px] font-bold text-slate-500">지금</dt>
          <dd className="font-display text-xl font-bold">{r.rating}</dd>
        </div>
        <div className="rounded-2xl bg-slate-100 py-2.5 dark:bg-slate-800">
          <dt className="text-[11px] font-bold text-slate-500">최고</dt>
          <dd className="font-display text-xl font-bold">{r.peak}</dd>
        </div>
        <div className="rounded-2xl bg-slate-100 py-2.5 dark:bg-slate-800">
          <dt className="text-[11px] font-bold text-slate-500">
            {r.provisional ? "배치 남음" : "최근 모임"}
          </dt>
          <dd
            className={`font-display text-xl font-bold ${
              r.provisional ? "" : changeClass(r.last_change)
            }`}
          >
            {r.provisional ? `${r.placement_left}경기` : signed(r.last_change)}
          </dd>
        </div>
      </dl>

      {events.length > 0 ? (
        <>
          <div className="mt-4">
            <Sparkline points={points} floors={floors} />
          </div>
          <ol className="mt-3">
            {events.map((e) => (
              <li
                key={e.match_id}
                className="border-b border-slate-200 py-3 text-sm last:border-0 dark:border-slate-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {e.played_at.replaceAll("-", ".")}
                    {e.gathering_id ? (
                      <>
                        {" · "}
                        <Link
                          to={`/app/gatherings/${e.gathering_id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {e.gathering_title ?? "모임"}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <span className="flex shrink-0 items-center gap-2">
                    <b className={`text-sm ${changeClass(Math.round(e.delta))}`}>
                      {signed(Math.round(e.delta))}
                    </b>
                    <span className="font-display text-sm font-bold">
                      {e.rating_after}
                    </span>
                    <span className={TIER_CLASS[e.tier_after]}>
                      {e.tier_after}
                    </span>
                  </span>
                </div>
                <p className="mt-1 font-bold">
                  <span
                    className={
                      e.outcome === "win"
                        ? "badge-green mr-2"
                        : e.outcome === "loss"
                        ? "badge-red mr-2"
                        : "badge-gray mr-2"
                    }
                  >
                    {e.games_for}:{e.games_against}{" "}
                    {e.outcome === "win" ? "승" : e.outcome === "loss" ? "패" : "무"}
                  </span>
                  {e.partners.length ? (
                    <>
                      {e.partners.map((p) => p.name).join("·")}
                      <span className="font-medium text-slate-500">와 함께</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                    </>
                  ) : null}
                  <span className="font-medium text-slate-500">vs</span>{" "}
                  {e.opponents.map((p) => p.name).join("·")}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  예상 득점률 {Math.round(e.expected * 100)}% → 실제{" "}
                  {Math.round(e.actual * 100)}%
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-4 text-sm font-medium text-slate-500">
          아직 반영된 경기가 없어요. {r.rating}점 {r.tier}에서 시작해요.
        </p>
      )}
    </div>
  );
}
