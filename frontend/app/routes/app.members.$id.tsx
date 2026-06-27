import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import {
  MATCH_TYPE_LABEL,
  type OpponentStat,
  type PartnerStat,
  type PlayerStats,
  type RecordStats,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회원 전적 · 테니스 매니저" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const [stats, partners, opponents] = await Promise.all([
    api<PlayerStats>(`/stats/users/${id}`, { token }),
    api<PartnerStat[]>(`/stats/users/${id}/partners`, { token }),
    api<OpponentStat[]>(`/stats/users/${id}/opponents`, { token }),
  ]);
  return json({ stats, partners, opponents });
}

function RecordCell({ record }: { record: RecordStats }) {
  return (
    <span>
      <span className="text-court-600">{record.wins}</span>
      <span className="text-slate-400"> / </span>
      <span className="text-red-500">{record.losses}</span>
      <span className="ml-2 font-semibold">{(record.win_rate * 100).toFixed(0)}%</span>
    </span>
  );
}

export default function MemberDetailPage() {
  const { stats, partners, opponents } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold sm:text-xl">
          {stats.user.name}
          {stats.user.nickname ? (
            <span className="ml-2 text-sm text-slate-400">@{stats.user.nickname}</span>
          ) : null}
        </h1>
        <Link to="/app/members" className="btn-ghost px-3 py-1.5 text-sm">← 목록</Link>
      </div>

      {/* 종합 전적 */}
      <div className="card">
        <h2 className="mb-3 font-semibold">종합 전적</h2>
        <div className="grid grid-cols-4 gap-2 text-center sm:gap-3">
          <Stat label="경기" value={stats.overall.total} tint="slate" />
          <Stat label="승" value={stats.overall.wins} tint="green" />
          <Stat label="패" value={stats.overall.losses} tint="red" />
          <Stat label="승률" value={`${(stats.overall.win_rate * 100).toFixed(0)}%`} tint="blue" />
        </div>
      </div>

      {/* 유형별 */}
      <div className="card">
        <h2 className="mb-3 font-semibold">유형별 전적</h2>
        {stats.by_type.length === 0 ? (
          <p className="text-sm text-slate-500">기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {stats.by_type.map((t) => (
              <li key={t.match_type} className="flex justify-between py-2 text-sm">
                <span className="font-medium">{MATCH_TYPE_LABEL[t.match_type]}</span>
                <RecordCell record={t.record} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 페어 전적 */}
        <div className="card">
          <h2 className="mb-3 font-semibold">🤝 페어 전적</h2>
          {partners.length === 0 ? (
            <p className="text-sm text-slate-500">기록이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {partners.map((p) => (
                <li key={p.partner.id} className="flex justify-between py-2 text-sm">
                  <Link to={`/app/members/${p.partner.id}`} className="font-medium hover:text-court-600">
                    {p.partner.name}
                  </Link>
                  <RecordCell record={p.record} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 상대 전적 */}
        <div className="card">
          <h2 className="mb-3 font-semibold">⚔️ 상대 전적</h2>
          {opponents.length === 0 ? (
            <p className="text-sm text-slate-500">기록이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {opponents.map((o) => (
                <li key={o.opponent.id} className="flex justify-between py-2 text-sm">
                  <Link to={`/app/members/${o.opponent.id}`} className="font-medium hover:text-court-600">
                    {o.opponent.name}
                  </Link>
                  <RecordCell record={o.record} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const STAT_TINT: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100",
  green: "bg-court-50 text-court-700 dark:bg-court-900/30 dark:text-court-300",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
  blue: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
};

function Stat({
  label,
  value,
  tint = "slate",
}: {
  label: string;
  value: string | number;
  tint?: "slate" | "green" | "red" | "blue";
}) {
  return (
    <div className={`rounded-2xl px-2 py-3 ${STAT_TINT[tint]}`}>
      <div className="text-xl font-extrabold sm:text-2xl">{value}</div>
      <div className="mt-0.5 text-xs font-semibold opacity-70">{label}</div>
    </div>
  );
}
