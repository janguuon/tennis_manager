import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { Eyebrow } from "~/components/Club";
import { BackLink, PageBody } from "~/components/Page";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import {
  MATCH_TYPE_LABEL,
  type OpponentStat,
  type PartnerStat,
  type PlayerStats,
  type RecordStats,
} from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "회원 전적 · 오테식 매니저" },
];

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

const GENDER_LABEL = { male: "남", female: "여" } as const;

export default function MemberDetailPage() {
  const { stats, partners, opponents } = useLoaderData<typeof loader>();
  const u = stats.user;
  const meta = [
    u.gender ? GENDER_LABEL[u.gender] : null,
    u.ntrp ? `NTRP ${u.ntrp}` : null,
  ].filter(Boolean);
  const pct = (stats.overall.win_rate * 100).toFixed(0);

  return (
    <PageBody>
      <div className="px-1 pt-1 md:pt-2">
        <BackLink to="/app/members">회원</BackLink>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* 프로필 */}
        <section className="tile-lav flex items-center gap-4 sm:gap-5">
          <span className="avatar h-16 w-16 bg-house-yellow text-[26px] text-ink sm:h-20 sm:w-20 sm:text-[32px]">
            {u.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <Eyebrow>PLAYER PROFILE</Eyebrow>
            <h1 className="truncate font-display text-[32px] font-extrabold leading-tight tracking-[-0.05em] sm:text-[42px]">
              {u.name}
              {u.nickname ? (
                <span className="ml-2 text-[18px] font-bold opacity-70">
                  {u.nickname}
                </span>
              ) : null}
            </h1>
            {meta.length ? (
              <p className="mt-1 text-[15px] font-bold">{meta.join(" · ")}</p>
            ) : null}
          </div>
        </section>

        {/* 종합 전적 */}
        <section className="tile-ink">
          <p className="text-[15px] font-bold">승률</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4">
            <span className="font-display text-[56px] font-extrabold leading-none tracking-[-0.05em] text-house-yellow">
              {pct}%
            </span>
            <span className="text-[14px] font-semibold text-white/75">
              {stats.overall.total}경기 · {stats.overall.wins}승{" "}
              {stats.overall.losses}패
            </span>
          </div>
        </section>
      </div>

      <div className="grid items-start gap-3.5 xl:grid-cols-3">
        <RecordTile
          tile="card"
          title="종목별"
          empty="기록이 없어요."
          rows={stats.by_type.map((t) => ({
            key: t.match_type,
            label: MATCH_TYPE_LABEL[t.match_type],
            record: t.record,
          }))}
        />
        <RecordTile
          tile="card"
          title="파트너별"
          empty="함께 뛴 기록이 없어요."
          rows={partners.map((p) => ({
            key: p.partner.id,
            label: p.partner.name,
            to: `/app/members/${p.partner.id}`,
            record: p.record,
          }))}
        />
        <RecordTile
          tile="card"
          title="상대별"
          empty="상대한 기록이 없어요."
          rows={opponents.map((o) => ({
            key: o.opponent.id,
            label: o.opponent.name,
            to: `/app/members/${o.opponent.id}`,
            record: o.record,
          }))}
        />
      </div>
    </PageBody>
  );
}

function RecordTile({
  tile,
  title,
  empty,
  rows,
}: {
  tile: string;
  title: string;
  empty: string;
  rows: {
    key: string | number;
    label: string;
    to?: string;
    record: RecordStats;
  }[];
}) {
  return (
    <section className={tile}>
      <h2 className="tile-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm font-semibold">{empty}</p>
      ) : (
        <ul className="record-rows mt-4">
          {rows.map((r) => (
            <li key={r.key}>
              {r.to ? (
                <Link to={r.to} className="truncate font-bold hover:underline">
                  {r.label}
                </Link>
              ) : (
                <span className="truncate font-bold">{r.label}</span>
              )}
              <span className="flex shrink-0 items-center gap-3 text-[13.5px]">
                <span>
                  {r.record.wins}승 {r.record.losses}패
                </span>
                <b className="w-10 text-right font-display font-extrabold">
                  {(r.record.win_rate * 100).toFixed(0)}%
                </b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
