import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowUpRight, Trophy } from "lucide-react";

import { MemberAvatar, SectionHeading } from "~/components/Club";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { RankingEntry } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "랭킹 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const ranking = await api<RankingEntry[]>("/stats/ranking", { token });
  return json({ ranking });
}

const PODIUM_TILE = ["tile-green", "tile-yellow", "tile-lav"];
export default function RankingPage() {
  const { ranking } = useLoaderData<typeof loader>();
  return (
    <PageBody>
      <PageHeader
        eyebrow="EVERY GAME COUNTS."
        title="함께 쌓아온 기록"
        sub="이기는 날도, 배우는 날도. 모두 우리의 테니스."
        actions={
          <span className="badge-gray !h-9 px-4">전체 경기 · 승률순</span>
        }
      />
      {!ranking.length ? (
        <EmptyCard icon={<Trophy size={28} />}>
          아직 집계된 전적이 없어요. 첫 경기를 기다리고 있어요.
        </EmptyCard>
      ) : (
        <>
          <div className="podium-grid">
            {ranking.slice(0, 3).map((row, i) => (
              <Link
                key={row.user.id}
                to={`/app/members/${row.user.id}`}
                className={`${PODIUM_TILE[i]} podium-card transition-transform hover:-translate-y-1`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="eyebrow !text-[8px] sm:!text-[10px]">
                    CLUB RANKING
                  </span>
                  <Trophy size={18} className="hidden sm:block" />
                </div>
                <span className="podium-number" aria-hidden="true">
                  {String(row.rank).padStart(2, "0")}
                </span>
                <span className="sr-only">{row.rank}위</span>
                <MemberAvatar
                  user={row.user}
                  className="relative mt-8 border-2 border-white/40 !bg-white/30"
                />
                <h2 className="relative mt-3 truncate text-base font-bold sm:text-xl">
                  {row.user.name}
                </h2>
                <div className="relative mt-2 flex flex-wrap items-baseline justify-between gap-1">
                  <span className="text-[11px] sm:text-sm">
                    {row.record.wins}승 {row.record.losses}패
                  </span>
                  <strong className="whitespace-nowrap font-display text-[28px] font-semibold tracking-tight sm:text-[36px]">
                    {Math.round(row.record.win_rate * 100)}%
                  </strong>
                </div>
              </Link>
            ))}
          </div>
          <section className="card">
            <SectionHeading
              title="우리 클럽 랭킹"
              sub="승률 → 승수 → 경기수 순으로 집계해요. 무승부는 승률에서 제외해요."
            />
            <ol className="mt-4">
              {ranking.map((row) => (
                <li key={row.user.id}>
                  <Link
                    to={`/app/members/${row.user.id}`}
                    className="ranking-row"
                  >
                    <span className="w-5 shrink-0 font-display text-sm text-slate-500">
                      {String(row.rank).padStart(2, "0")}
                    </span>
                    <MemberAvatar
                      user={row.user}
                      className="!h-8 !w-8 !text-xs sm:!h-10 sm:!w-10"
                    />
                    <strong>{row.user.name}</strong>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400 sm:text-sm">
                      {row.record.wins}승 {row.record.losses}패
                    </span>
                    <b>{Math.round(row.record.win_rate * 100)}%</b>
                    <ArrowUpRight
                      size={16}
                      className="hidden shrink-0 text-slate-400 sm:block"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </PageBody>
  );
}
