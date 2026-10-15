import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { Eyebrow, MemberAvatar } from "~/components/Club";
import { BackLink, PageBody } from "~/components/Page";

import { api } from "~/lib/api.server";
import { canSeeRecords } from "~/lib/features";
import { MEMBER_TYPE_LABEL } from "~/lib/status";
import { requireMember } from "~/lib/guard.server";
import {
  MATCH_TYPE_LABEL,
  type Me,
  type OpponentStat,
  type PartnerStat,
  type PlayerStats,
  type RecordStats,
  type User,
} from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "회원 프로필 · 오테식 매니저" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, me } = await requireMember(request);
  const id = params.id;
  // 승률·전적은 당분간 관리자만 본다 (임원진 포함 다른 회원은 프로필만)
  if (!canSeeRecords(me)) {
    const user = await api<User>(`/users/${id}`, { token });
    return json({ user, records: null });
  }
  const [stats, partners, opponents] = await Promise.all([
    api<PlayerStats>(`/stats/users/${id}`, { token }),
    api<PartnerStat[]>(`/stats/users/${id}/partners`, { token }),
    api<OpponentStat[]>(`/stats/users/${id}/opponents`, { token }),
  ]);
  return json({ user: stats.user, records: { stats, partners, opponents } });
}

const GENDER_LABEL = { male: "남", female: "여" } as const;

export default function MemberDetailPage() {
  const { user: u, records } = useLoaderData<typeof loader>();
  const meta = [
    MEMBER_TYPE_LABEL[u.member_type],
    u.gender ? GENDER_LABEL[u.gender] : null,
    u.ntrp ? `NTRP ${u.ntrp}` : null,
  ].filter(Boolean);

  return (
    <PageBody>
      <div className="px-1 pt-1 md:pt-2">
        <BackLink to="/app/members">회원</BackLink>
      </div>

      <div
        className={`grid gap-3.5 ${
          records ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""
        }`}
      >
        {/* 프로필 */}
        <section className="tile-lav flex items-center gap-4 sm:gap-5">
          <MemberAvatar
            user={u}
            className="!h-16 !w-16 shrink-0 !bg-house-yellow !text-[26px] sm:!h-20 sm:!w-20 sm:!text-[32px]"
          />
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

        {/* 종합 전적 (관리자만) */}
        {records ? (
          <section className="tile-ink">
            <p className="text-[15px] font-bold">승률</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4">
              <span className="font-display text-[56px] font-extrabold leading-none tracking-[-0.05em] text-house-yellow">
                {(records.stats.overall.win_rate * 100).toFixed(0)}%
              </span>
              <span className="text-[14px] font-semibold text-white/75">
                {records.stats.overall.total}경기 ·{" "}
                {records.stats.overall.wins}승 {records.stats.overall.losses}패
              </span>
            </div>
          </section>
        ) : null}
      </div>

      {records ? (
        <div className="grid items-start gap-3.5 xl:grid-cols-3">
          <RecordTile
            tile="card"
            title="종목별"
            empty="기록이 없어요."
            rows={records.stats.by_type.map((t) => ({
              key: t.match_type,
              label: MATCH_TYPE_LABEL[t.match_type],
              record: t.record,
            }))}
          />
          <RecordTile
            tile="card"
            title="파트너별"
            empty="함께 뛴 기록이 없어요."
            rows={records.partners.map((p) => ({
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
            rows={records.opponents.map((o) => ({
              key: o.opponent.id,
              label: o.opponent.name,
              to: `/app/members/${o.opponent.id}`,
              record: o.record,
            }))}
          />
        </div>
      ) : null}
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
