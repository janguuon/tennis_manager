import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

import { PageBody, PageHero } from "~/components/Page";

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
    <span className="flex items-center gap-3 text-[13px]">
      <span className="text-slate-500">
        {record.wins}승 {record.losses}패
      </span>
      <span className="w-10 text-right font-semibold tabular-nums text-slate-900 dark:text-white">
        {(record.win_rate * 100).toFixed(0)}%
      </span>
    </span>
  );
}

const GENDER_LABEL = { male: "남", female: "여" } as const;

export default function MemberDetailPage() {
  const { stats, partners, opponents } = useLoaderData<typeof loader>();
  const u = stats.user;
  const meta = [u.gender ? GENDER_LABEL[u.gender] : null, u.ntrp ? `NTRP ${u.ntrp}` : null].filter(Boolean);

  return (
    <>
      <PageHero>
        <Link to="/app/members" className="back-link-hero">
          <ArrowLeft size={16} />
          회원
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ball-400 text-xl font-bold text-slate-900">
            {u.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <h1 className="hero-title truncate">
              {u.name}
              {u.nickname ? <span className="ml-2 text-lg font-medium text-white/60">{u.nickname}</span> : null}
            </h1>
            {meta.length ? <p className="hero-sub !mt-0.5">{meta.join(" · ")}</p> : null}
          </div>
        </div>
      </PageHero>

      <PageBody>
        {/* 종합 전적 */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <Stat label="경기" value={stats.overall.total} />
          <Stat label="승" value={stats.overall.wins} tone="text-ball-800 dark:text-ball-300" />
          <Stat label="패" value={stats.overall.losses} tone="text-rose-600 dark:text-rose-400" />
          <Stat label="승률" value={`${(stats.overall.win_rate * 100).toFixed(0)}%`} />
        </div>

        {/* 종목별 */}
        <RecordList
          title="종목별"
          empty="기록이 없어요."
          rows={stats.by_type.map((t) => ({ key: t.match_type, label: MATCH_TYPE_LABEL[t.match_type], record: t.record }))}
        />

        <div className="grid gap-5 md:grid-cols-2">
          <RecordList
            title="파트너별"
            empty="함께 뛴 기록이 없어요."
            rows={partners.map((p) => ({ key: p.partner.id, label: p.partner.name, to: `/app/members/${p.partner.id}`, record: p.record }))}
          />
          <RecordList
            title="상대별"
            empty="상대한 기록이 없어요."
            rows={opponents.map((o) => ({ key: o.opponent.id, label: o.opponent.name, to: `/app/members/${o.opponent.id}`, record: o.record }))}
          />
        </div>
      </PageBody>
    </>
  );
}

function RecordList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { key: string | number; label: string; to?: string; record: RecordStats }[];
}) {
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between py-2.5 text-sm">
              {r.to ? (
                <Link to={r.to} className="font-medium text-slate-800 hover:underline dark:text-slate-100">
                  {r.label}
                </Link>
              ) : (
                <span className="font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
              )}
              <RecordCell record={r.record} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, tone = "text-slate-900 dark:text-white" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card !p-3 text-center sm:!p-4">
      <p className={`text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}
