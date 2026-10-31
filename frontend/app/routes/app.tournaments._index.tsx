import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { CalendarDays, MapPin, Medal, Plus, Trophy, Users } from "lucide-react";
import { useState } from "react";

import { Modal } from "~/components/Modal";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { isStaff } from "~/lib/club";
import { formatDate } from "~/lib/format";
import { requireMember } from "~/lib/guard.server";
import { requireToken } from "~/lib/session.server";
import {
  TOURNAMENT_KINDS,
  numberOrNull,
  TOURNAMENT_KIND_BADGE,
  TOURNAMENT_KIND_HINT,
  TOURNAMENT_KIND_LABEL,
  TEAM_RESULT_LABEL,
  entryName,
  tournamentStatus,
} from "~/lib/tournament";
import type { TournamentDetail, TournamentKind, TournamentSummary } from "~/lib/types";

/**
 * 클럽 대회 (/app/tournaments): 청백전 · 단식·복식 토너먼트 목록.
 * 운영진(관리자·임원진)이 대회를 만들고, 회원은 대진과 결과를 본다. 게스트는 들어오지 않는다.
 */
export const meta: MetaFunction = () => [{ title: "클럽 대회 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, me } = await requireMember(request);
  const tournaments = await api<TournamentSummary[]>("/tournaments", { token });
  return json({ tournaments, staff: isStaff(me) });
}


export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const kind = String(formData.get("kind")) as TournamentKind;
  try {
    const t = await api<TournamentDetail>("/tournaments", {
      method: "POST",
      token,
      body: {
        title: String(formData.get("title") ?? ""),
        kind,
        event_date: String(formData.get("event_date") ?? "") || null,
        location: String(formData.get("location") ?? ""),
        note: String(formData.get("note") ?? ""),
        blue_size: kind === "team_battle" ? numberOrNull(formData.get("blue_size")) : null,
        white_size: kind === "team_battle" ? numberOrNull(formData.get("white_size")) : null,
      },
    });
    return redirect(`/app/tournaments/${t.id}`);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "대회를 만들지 못했어요.";
    return json({ error: message }, { status: 400 });
  }
}

export default function TournamentsPage() {
  const { tournaments, staff } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);

  return (
    <PageBody>
      <PageHeader
        eyebrow="CLUB CUP"
        title="클럽 대회"
        sub="청백전과 단식·복식 토너먼트를 열고, 팀 나누기부터 점수까지 한곳에서 챙겨요."
        actions={
          staff ? (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> 대회 만들기
            </button>
          ) : null
        }
      />

      {tournaments.length === 0 ? (
        <EmptyCard icon={<Medal size={28} />}>
          아직 열린 대회가 없어요.
          {staff ? " 위의 ‘대회 만들기’로 청백전이나 토너먼트를 열어 보세요." : ""}
        </EmptyCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tournaments.map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </div>
      )}

      {creating || actionData?.error ? (
        <CreateTournamentModal error={actionData?.error ?? null} onClose={() => setCreating(false)} />
      ) : null}
    </PageBody>
  );
}

function TournamentCard({ t }: { t: TournamentSummary }) {
  const status = tournamentStatus(t);
  return (
    <Link to={`/app/tournaments/${t.id}`} className="card-link space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={TOURNAMENT_KIND_BADGE[t.kind]}>{TOURNAMENT_KIND_LABEL[t.kind]}</span>
        <span className={status.badge}>{status.label}</span>
      </div>
      <div>
        <h2 className="section-title">{t.title}</h2>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          {t.event_date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={13} /> {formatDate(t.event_date)}
            </span>
          ) : null}
          {t.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} /> {t.location}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Users size={13} /> {t.players}명
          </span>
        </p>
      </div>
      {t.score && t.played > 0 ? (
        <p className="flex items-center gap-3 font-display text-lg font-extrabold">
          <span className="team-chip-blue">청</span>
          {t.score.blue_wins} : {t.score.white_wins}
          <span className="team-chip-white">백</span>
          {t.score.draws ? (
            <span className="text-xs font-semibold text-slate-500">무승부 {t.score.draws}</span>
          ) : null}
        </p>
      ) : null}
      {t.winner_team ? (
        <p className="flex items-center gap-2 text-sm font-bold">
          <Trophy size={16} className="text-[#C9A227]" /> 최종 {TEAM_RESULT_LABEL[t.winner_team]}
        </p>
      ) : null}
      {t.champion ? (
        <p className="flex items-center gap-2 text-sm font-bold">
          <Trophy size={16} className="text-[#C9A227]" /> 우승 {entryName(t.champion)}
        </p>
      ) : null}
    </Link>
  );
}

function CreateTournamentModal({ error, onClose }: { error: string | null; onClose: () => void }) {
  const navigation = useNavigation();
  const [kind, setKind] = useState<TournamentKind>("team_battle");
  const busy = navigation.state !== "idle";
  return (
    <Modal title="대회 만들기" onClose={onClose}>
      <Form method="post" className="space-y-4">
        <fieldset>
          <legend className="label">종류</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TOURNAMENT_KINDS.map((k) => (
              <label key={k}>
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="peer sr-only"
                />
                <span className="block h-full cursor-pointer rounded-2xl border border-slate-300 px-4 py-3 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 dark:border-slate-600 dark:peer-checked:bg-white dark:peer-checked:text-ink">
                  <strong className="block text-sm">{TOURNAMENT_KIND_LABEL[k]}</strong>
                  <span className="mt-0.5 block text-xs opacity-75">{TOURNAMENT_KIND_HINT[k]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="t_title">
            대회 이름
          </label>
          <input
            id="t_title"
            name="title"
            required
            maxLength={100}
            className="input"
            placeholder={kind === "team_battle" ? "예: 가을 청백전" : "예: 오테식배 단식 토너먼트"}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t_date">
              날짜 <span className="font-medium text-slate-400">(선택)</span>
            </label>
            <input id="t_date" name="event_date" type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="t_location">
              장소 <span className="font-medium text-slate-400">(선택)</span>
            </label>
            <input id="t_location" name="location" maxLength={200} className="input" />
          </div>
        </div>
        {kind === "team_battle" ? (
          <div>
            <p className="label">팀별 인원 수 <span className="font-medium text-slate-400">(선택)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <input
                name="blue_size"
                type="number"
                inputMode="numeric"
                min="1"
                className="input"
                placeholder="청팀"
                aria-label="청팀 인원 수"
              />
              <input
                name="white_size"
                type="number"
                inputMode="numeric"
                min="1"
                className="input"
                placeholder="백팀"
                aria-label="백팀 인원 수"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              랜덤 배정이 이 인원까지 채워요. 비우면 남은 사람을 반씩 나눠요. 나중에 바꿀 수 있어요.
            </p>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="t_note">
            메모 <span className="font-medium text-slate-400">(선택)</span>
          </label>
          <textarea id="t_note" name="note" rows={2} maxLength={1000} className="input" />
        </div>
        <div className="modal-actions space-y-3">
          {error ? <p className="alert-error">{error}</p> : null}
          <button type="submit" className="btn-primary h-12 w-full" disabled={busy}>
            {busy ? "만드는 중…" : "대회 만들기"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}
