import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { RankingEntry } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "랭킹 · 테니스 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const ranking = await api<RankingEntry[]>("/stats/ranking", { token });
  return json({ ranking });
}

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
}

export default function RankingPage() {
  const { ranking } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">🏆 팀 랭킹</h1>

      {ranking.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          아직 집계된 전적이 없습니다.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">순위</th>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3 text-center">승</th>
                <th className="px-4 py-3 text-center">패</th>
                <th className="px-4 py-3 text-center">승률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {ranking.map((row) => (
                <tr key={row.user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-3 text-center font-bold">{medal(row.rank)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/app/members/${row.user.id}`} className="font-medium hover:text-court-600">
                      {row.user.name}
                    </Link>
                    {row.user.nickname ? (
                      <span className="ml-1 text-xs text-slate-400">@{row.user.nickname}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-center text-court-600">{row.record.wins}</td>
                  <td className="px-4 py-3 text-center text-red-500">{row.record.losses}</td>
                  <td className="px-4 py-3 text-center font-semibold">
                    {(row.record.win_rate * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
