import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Trophy } from "lucide-react";

import { HeroHeader, PageBody, PageHero } from "~/components/Page";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { RankingEntry } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "랭킹 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const ranking = await api<RankingEntry[]>("/stats/ranking", { token });
  return json({ ranking });
}

/** 1~3위 순위 배지 색 */
const PODIUM: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  2: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  3: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
};

export default function RankingPage() {
  const { ranking } = useLoaderData<typeof loader>();

  return (
    <>
      <PageHero>
        <HeroHeader title="랭킹" sub={ranking.length > 0 ? `${ranking.length}명 · 기록된 경기의 승률 순위예요` : "기록된 경기의 승률 순위예요"} />
      </PageHero>

      <PageBody>
        {ranking.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-14 text-center">
            <Trophy size={28} className="text-slate-300" />
            <p className="text-sm text-slate-500">아직 집계된 전적이 없어요.</p>
          </div>
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem] items-center border-b border-slate-100 px-2 py-2.5 text-xs font-medium text-slate-400 dark:border-slate-800 sm:grid-cols-[4rem_1fr_6rem_10rem] sm:px-4">
              <span className="text-center">순위</span>
              <span>회원</span>
              <span className="text-center">전적</span>
              <span className="text-right sm:text-left">승률</span>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {ranking.map((row) => {
                const pct = Math.round(row.record.win_rate * 100);
                return (
                  <li key={row.user.id}>
                    <Link
                      to={`/app/members/${row.user.id}`}
                      className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem] items-center px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:grid-cols-[4rem_1fr_6rem_10rem] sm:px-4"
                    >
                      <span className="flex justify-center">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold ${
                            PODIUM[row.rank] ?? "text-slate-400"
                          }`}
                        >
                          {row.rank}
                        </span>
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-semibold text-slate-900 dark:text-white">{row.user.name}</span>
                        {row.user.nickname ? (
                          <span className="ml-1.5 text-xs text-slate-400">{row.user.nickname}</span>
                        ) : null}
                      </span>
                      <span className="text-center text-[13px] text-slate-600 dark:text-slate-300">
                        {row.record.wins}승 {row.record.losses}패
                      </span>
                      <span className="flex items-center justify-end gap-2 sm:justify-start">
                        <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:block">
                          <span className="block h-full rounded-full bg-ball-500 dark:bg-ball-400" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                          {pct}%
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PageBody>
    </>
  );
}
