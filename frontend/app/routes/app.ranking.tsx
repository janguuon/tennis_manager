import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowUpRight, Trophy } from "lucide-react";

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

/** 1~3위 시상대 타일 색 */
const PODIUM_TILE = ["tile-yellow", "tile-blue", "tile-orange"];

export default function RankingPage() {
  const { ranking } = useLoaderData<typeof loader>();
  const podium = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  return (
    <PageBody>
      <PageHeader
        title="랭킹"
        sub={ranking.length > 0 ? `${ranking.length}명 · 기록된 경기의 승률 순위예요` : "기록된 경기의 승률 순위예요"}
      />

      {ranking.length === 0 ? (
        <EmptyCard icon={<Trophy size={28} />}>아직 집계된 전적이 없어요.</EmptyCard>
      ) : (
        <>
          {/* 시상대 */}
          <div className="grid gap-3.5 sm:grid-cols-3">
            {podium.map((row, i) => {
              const pct = Math.round(row.record.win_rate * 100);
              return (
                <Link
                  key={row.user.id}
                  to={`/app/members/${row.user.id}`}
                  className={`${PODIUM_TILE[i]} flex min-h-[180px] flex-col transition-transform hover:-translate-y-0.5 sm:min-h-[220px]`}
                >
                  <span className="flex items-start justify-between">
                    <span className="font-display text-[56px] font-extrabold leading-[0.85] tracking-[-0.06em] sm:text-[72px]">
                      {row.rank}
                    </span>
                    <ArrowUpRight size={18} />
                  </span>
                  <span className="mt-auto pt-4">
                    <span className="block truncate font-display text-[24px] font-extrabold tracking-[-0.04em]">
                      {row.user.name}
                      {row.user.nickname ? <span className="ml-2 text-[14px] font-bold opacity-70">{row.user.nickname}</span> : null}
                    </span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-[14.5px] font-bold">
                      <span>
                        {row.record.wins}승 {row.record.losses}패
                      </span>
                      <span className="font-display text-[26px] font-extrabold tracking-[-0.04em]">{pct}%</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

          {/* 4위부터 */}
          {rest.length > 0 ? (
            <section className="tile-green">
              <h2 className="tile-title">전체 순위</h2>
              <ol className="tile-rows mt-2">
                {rest.map((row) => {
                  const pct = Math.round(row.record.win_rate * 100);
                  return (
                    <li key={row.user.id}>
                      <Link to={`/app/members/${row.user.id}`} className="flex min-w-0 items-center gap-4 hover:underline">
                        <b className="w-6 text-center font-display text-[17px] font-extrabold">{row.rank}</b>
                        <span className="truncate font-bold">
                          {row.user.name}
                          {row.user.nickname ? <span className="ml-1.5 text-xs font-semibold opacity-70">{row.user.nickname}</span> : null}
                        </span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-[13.5px] sm:inline">
                          {row.record.wins}승 {row.record.losses}패
                        </span>
                        <span className="hidden h-3 w-28 overflow-hidden rounded-full border-[1.5px] border-ink md:block">
                          <span className="block h-full bg-ink" style={{ width: `${pct}%` }} />
                        </span>
                        <b className="w-11 text-right font-display font-extrabold">{pct}%</b>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </PageBody>
  );
}
