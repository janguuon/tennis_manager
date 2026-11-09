import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { CalendarDays, Clock, MapPin, Plus, Swords, Users } from "lucide-react";

import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { api } from "~/lib/api.server";
import { isStaff } from "~/lib/club";
import { exchangeStatus, isPastExchange, OURS_LABEL, opponentLabel } from "~/lib/exchange";
import { formatDate, todayKST } from "~/lib/format";
import { requireMember } from "~/lib/guard.server";
import type { ExchangeSummary } from "~/lib/types";

/**
 * 교류전 (/app/exchanges): 캘린더의 교류전 일정이 그대로 목록이 된다.
 * 다가오는 교류전 · 지난 교류전과 클럽별 상대 전적. 대진·점수는 교류전 화면에서 (운영진이 꾸린다).
 */
export const meta: MetaFunction = () => [{ title: "교류전 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, me } = await requireMember(request);
  const exchanges = await api<ExchangeSummary[]>("/exchanges", { token });
  return json({ exchanges, staff: isStaff(me), today: todayKST() });
}

type ClubRecord = { name: string; wins: number; losses: number; draws: number };

/** 마친 교류전을 상대 클럽별로 묶은 전적 (이름은 띄어쓰기를 무시하고 같은 클럽으로 본다) */
function records(list: ExchangeSummary[]): ClubRecord[] {
  const by = new Map<string, ClubRecord>();
  for (const x of list) {
    if (!x.winner || x.canceled) continue;
    const name = opponentLabel(x);
    const key = name.replace(/\s+/g, "");
    const r = by.get(key) ?? { name, wins: 0, losses: 0, draws: 0 };
    if (x.winner === "ours") r.wins += 1;
    else if (x.winner === "theirs") r.losses += 1;
    else r.draws += 1;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws));
}

const recordText = (r: Omit<ClubRecord, "name">) =>
  [r.wins ? `${r.wins}승` : "", r.losses ? `${r.losses}패` : "", r.draws ? `${r.draws}무` : ""]
    .filter(Boolean)
    .join(" ") || "-";

export default function ExchangesPage() {
  const { exchanges, staff, today } = useLoaderData<typeof loader>();
  const upcoming = exchanges.filter((x) => !isPastExchange(x, today)).reverse();
  const past = exchanges.filter((x) => isPastExchange(x, today));
  const byClub = records(exchanges);
  const total = byClub.reduce(
    (acc, r) => ({ wins: acc.wins + r.wins, losses: acc.losses + r.losses, draws: acc.draws + r.draws }),
    { wins: 0, losses: 0, draws: 0 },
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="CLUB MATCH"
        title="교류전"
        sub="다른 클럽과 겨루는 교류전이에요. 캘린더에 교류전 일정을 올리면 여기에 생기고, 대진과 점수를 한곳에서 챙겨요."
        actions={
          staff ? (
            <Link to="/app/calendar?new=exchange" className="btn-primary">
              <Plus size={16} /> 교류전 일정 등록
            </Link>
          ) : null
        }
      />

      {byClub.length ? (
        <section className="card space-y-3" aria-label="상대 전적">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-title">상대 전적</h2>
            <p className="text-[13px] font-bold">
              {OURS_LABEL} 통산 {recordText(total)}
            </p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {byClub.map((r) => (
              <li key={r.name} className="chip-white !h-8 !px-3 text-[13px]">
                <span className="font-extrabold">{r.name}</span>
                <span className="text-slate-500">{recordText(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {exchanges.length === 0 ? (
        <EmptyCard icon={<Swords size={28} />}>
          아직 교류전 일정이 없어요.
          {staff ? " ‘교류전 일정 등록’으로 캘린더에 교류전을 올려 보세요." : ""}
        </EmptyCard>
      ) : (
        <>
          <ExchangeList title="다가오는 교류전" list={upcoming} empty="예정된 교류전이 없어요." />
          {past.length ? <ExchangeList title="지난 교류전" list={past} /> : null}
        </>
      )}
    </PageBody>
  );
}

function ExchangeList({ title, list, empty }: { title: string; list: ExchangeSummary[]; empty?: string }) {
  return (
    <section className="space-y-3">
      <h2 className="section-title">{title}</h2>
      {list.length === 0 ? (
        <p className="card text-sm font-medium text-slate-500">{empty}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((x) => (
            <ExchangeCardLink key={x.gathering_id} x={x} />
          ))}
        </div>
      )}
    </section>
  );
}

function ExchangeCardLink({ x }: { x: ExchangeSummary }) {
  const status = exchangeStatus(x);
  const opponent = opponentLabel(x);
  return (
    <Link to={`/app/exchanges/${x.gathering_id}`} className="card-link space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-blue">vs {opponent}</span>
        <span className={status.badge}>{status.label}</span>
      </div>
      <div>
        <h3 className="section-title">{x.title}</h3>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={13} /> {formatDate(x.event_date)}
          </span>
          {x.start_time ? (
            <span className="inline-flex items-center gap-1">
              <Clock size={13} /> {x.start_time.slice(0, 5)}
            </span>
          ) : null}
          {x.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} /> {x.location}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Users size={13} /> {OURS_LABEL} {x.ours_count} · 상대 {x.theirs_count}
          </span>
        </p>
      </div>
      {x.played > 0 ? (
        <p className="flex items-center gap-3 font-display text-lg font-extrabold">
          <span className="team-chip-blue">{OURS_LABEL}</span>
          {x.score.ours_wins} : {x.score.theirs_wins}
          <span className="team-chip-white max-w-[9rem] truncate">{opponent}</span>
          {x.score.draws ? <span className="text-xs font-semibold text-slate-500">무 {x.score.draws}</span> : null}
        </p>
      ) : x.total > 0 ? (
        <p className="text-[13px] font-semibold text-slate-500">경기 {x.total}개 대진 완료</p>
      ) : null}
    </Link>
  );
}
