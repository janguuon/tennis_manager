import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  isRouteErrorResponse,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "@remix-run/react";
import {
  CalendarDays,
  Check,
  Crown,
  MapPin,
  Pencil,
  Shuffle,
  Trash2,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MemberAvatar } from "~/components/Club";
import { Modal } from "~/components/Modal";
import { BackLink, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { formatDate } from "~/lib/format";
import { membersOrEmpty, requireMember } from "~/lib/guard.server";
import { requireToken } from "~/lib/session.server";
import {
  TEAM_LABEL,
  TEAM_RESULT_LABEL,
  numberOrNull,
  TOURNAMENT_KIND_BADGE,
  TOURNAMENT_KIND_LABEL,
  entryName,
  roundLabel,
  tournamentStatus,
} from "~/lib/tournament";
import {
  MATCH_TYPE_LABEL,
  type TeamColor,
  type TeamResult,
  type TournamentDetail,
  type TournamentEntry,
  type TournamentMatch,
  type UserBrief,
} from "~/lib/types";

/**
 * 대회 화면 (/app/tournaments/:id).
 * - 청백전: 참가자 → 팀장·인원 수 → 직접 넣기 + 나머지 랜덤 배정 → 경기 짜기(직접·랜덤) → 점수 → 청·백 승패
 * - 토너먼트: 참가자(복식은 짝) → 대진표 추첨 → 점수를 적으면 다음 라운드로 → 우승
 * 대회를 꾸리는 건 운영진, 청백전 경기는 팀장도 짠다. 점수는 운영진·팀장·그 경기 선수가 적는다 (서버와 같음).
 */
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.t.title ?? "대회"} · 오테식 매니저` },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token } = await requireMember(request);
  try {
    const t = await api<TournamentDetail>(`/tournaments/${params.id}`, { token });
    // 참가자 고르기는 대회를 꾸리는 사람에게만 (회원 탭처럼 직함 없는 관리자 계정은 뺀다)
    const members = t.can_manage ? await membersOrEmpty(token, { hideAdmin: true }) : [];
    return json({ t, members });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Response("대회를 찾을 수 없어요.", { status: 404 });
    }
    throw err;
  }
}

const ids = (values: FormDataEntryValue[]) => values.map(String).filter(Boolean).map(Number);

export async function action({ request, params }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const base = `/tournaments/${params.id}`;
  const entry = formData.get("entry_id");
  const match = formData.get("match_id");
  try {
    switch (intent) {
      case "update_info":
        await api(base, {
          method: "PATCH",
          token,
          body: {
            title: String(formData.get("title") ?? ""),
            event_date: String(formData.get("event_date") ?? "") || null,
            location: String(formData.get("location") ?? ""),
            note: String(formData.get("note") ?? ""),
            ...(formData.has("blue_size")
              ? {
                  blue_size: numberOrNull(formData.get("blue_size")),
                  white_size: numberOrNull(formData.get("white_size")),
                }
              : {}),
          },
        });
        break;
      case "set_winner":
        await api(base, {
          method: "PATCH",
          token,
          body: { winner_team: String(formData.get("winner_team") ?? "") || null },
        });
        break;
      case "delete_tournament":
        await api(base, { method: "DELETE", token });
        return redirect("/app/tournaments");
      case "add_players":
        await api(`${base}/players`, {
          method: "POST",
          token,
          body: {
            user_ids: ids(formData.getAll("user_id")),
            team: String(formData.get("team") ?? "") || null,
          },
        });
        break;
      case "entry_menu": {
        const op = String(formData.get("op"));
        if (op === "remove") {
          await api(`${base}/entries/${entry}`, { method: "DELETE", token });
        } else if (op === "split") {
          await api(`${base}/entries/${entry}/split`, { method: "POST", token });
        } else {
          await api(`${base}/entries/${entry}`, {
            method: "PATCH",
            token,
            body: op === "captain" ? { is_captain: true } : { team: op === "none" ? null : op },
          });
        }
        break;
      }
      case "random_teams":
        await api(base, {
          method: "PATCH",
          token,
          body: {
            blue_size: numberOrNull(formData.get("blue_size")),
            white_size: numberOrNull(formData.get("white_size")),
          },
        });
        await api(`${base}/teams/random`, { method: "POST", token });
        break;
      case "add_match":
        await api(`${base}/matches`, {
          method: "POST",
          token,
          body: {
            blue_ids: ids(formData.getAll("blue_id")),
            white_ids: ids(formData.getAll("white_id")),
          },
        });
        break;
      case "random_matches":
        await api(`${base}/matches/random`, {
          method: "POST",
          token,
          body: { match_type: formData.get("match_type") === "singles" ? "singles" : "doubles" },
        });
        break;
      case "delete_match":
        await api(`${base}/matches/${match}`, { method: "DELETE", token });
        break;
      case "pair":
        await api(`${base}/pairs`, {
          method: "POST",
          token,
          body: { entry_ids: [Number(entry), Number(formData.get("partner_id"))] },
        });
        break;
      case "random_pairs":
        await api(`${base}/pairs/random`, { method: "POST", token });
        break;
      case "bracket":
        await api(`${base}/bracket`, { method: "POST", token });
        break;
      case "delete_bracket":
        await api(`${base}/bracket`, { method: "DELETE", token });
        break;
      case "result":
        await api(`${base}/matches/${match}/result`, {
          method: "PUT",
          token,
          body: {
            team1_score: Number(formData.get("team1_score") || 0),
            team2_score: Number(formData.get("team2_score") || 0),
          },
        });
        break;
      case "delete_result":
        await api(`${base}/matches/${match}/result`, { method: "DELETE", token });
        break;
    }
    return json({ ok: true, error: null as string | null, at: Date.now() });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리하지 못했어요.";
    return json({ ok: false, error: message, at: Date.now() }, { status: 400 });
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <PageBody narrow>
      <PageHeader
        back={<BackLink to="/app/tournaments">대회 목록</BackLink>}
        title="대회를 열 수 없어요"
        sub={isRouteErrorResponse(error) ? String(error.data) : "잠시 뒤 다시 시도해 주세요."}
      />
    </PageBody>
  );
}

export default function TournamentPage() {
  const { t, members } = useLoaderData<typeof loader>();
  const [editing, setEditing] = useState(false);
  const status = tournamentStatus(t);
  return (
    <PageBody>
      <PageHeader
        back={<BackLink to="/app/tournaments">대회 목록</BackLink>}
        eyebrow="CLUB CUP"
        title={t.title}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={TOURNAMENT_KIND_BADGE[t.kind]}>{TOURNAMENT_KIND_LABEL[t.kind]}</span>
            <span className={status.badge}>{status.label}</span>
            {t.event_date ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={14} /> {formatDate(t.event_date)}
              </span>
            ) : null}
            {t.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {t.location}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users size={14} /> {t.players}명 참가
            </span>
          </span>
        }
        actions={
          t.can_manage ? (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={14} /> 정보 고치기
              </button>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("이 대회를 지울까요? 팀·대진·점수가 모두 지워져요.")) e.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="delete_tournament" />
                <button className="btn-danger btn-sm">
                  <Trash2 size={14} /> 지우기
                </button>
              </Form>
            </>
          ) : null
        }
      />
      {t.note ? (
        <p className="card whitespace-pre-line text-sm font-medium text-slate-600 dark:text-slate-300">
          {t.note}
        </p>
      ) : null}

      {t.kind === "team_battle" ? (
        <TeamBattle t={t} members={members} />
      ) : (
        <Knockout t={t} members={members} />
      )}

      {editing ? <EditInfoModal t={t} onClose={() => setEditing(false)} /> : null}
      <ActionToast />
    </PageBody>
  );
}

/** 처리하지 못했을 때 화면 아래에 잠깐 띄운다 (어디서 눌렀든 보이게) */
function ActionToast() {
  const actionData = useActionData<typeof action>();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!actionData?.error) return;
    setShown(actionData.error);
    const timer = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(timer);
  }, [actionData]);
  if (!shown) return null;
  return (
    <p
      role="alert"
      className="alert-error fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+92px)] z-30 mx-auto max-w-md shadow-pop md:bottom-8"
      onClick={() => setShown(null)}
    >
      {shown}
    </p>
  );
}

/** 이 폼을 보내는 중인지 (intent와 대상 id로) */
function useBusy(intent: string, key?: { name: string; value: number }) {
  const navigation = useNavigation();
  return (
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === intent &&
    (!key || navigation.formData?.get(key.name) === String(key.value))
  );
}

function PlayerLine({ user, children }: { user: UserBrief; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MemberAvatar user={user} className="!h-8 !w-8 shrink-0 !text-xs" />
      <span className="truncate">{user.name}</span>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 청백전
// ---------------------------------------------------------------------------
function TeamBattle({ t, members }: { t: TournamentDetail; members: UserBrief[] }) {
  const [adding, setAdding] = useState(false);
  const team = (color: TeamColor) => t.entries.filter((e) => e.team === color && e.players.length);
  const pool = t.entries.filter((e) => !e.team && e.players.length);
  const score = t.score!;
  const finalChip = (color: TeamColor) =>
    t.winner_team === color ? (
      <span className="chip-ink mb-1">
        <Trophy size={12} /> 최종 승리
      </span>
    ) : null;
  return (
    <>
      {t.winner_team ? (
        <section className="tile-yellow flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink text-house-yellow">
            <Trophy size={26} />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">FINAL</p>
            <p className="tile-title">{TEAM_RESULT_LABEL[t.winner_team]}</p>
            <p className="tile-sub">
              청팀 {score.blue_wins}승 · 백팀 {score.white_wins}승{score.draws ? ` · 무승부 ${score.draws}` : ""}
            </p>
          </div>
        </section>
      ) : null}
      <section className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3" aria-label="청백전 점수">
        <div className="team-card-blue flex flex-col items-center justify-center !py-5 text-center">
          {finalChip("blue")}
          <span className="text-[13px] font-bold">청팀</span>
          <strong className="font-display text-5xl font-extrabold">{score.blue_wins}</strong>
          <span className="text-xs font-semibold opacity-75">게임 {score.blue_games}</span>
        </div>
        <div className="flex flex-col items-center justify-center text-center text-xs font-semibold text-slate-500">
          <span className="font-display text-2xl text-slate-400">:</span>
          {score.draws ? <span>무 {score.draws}</span> : null}
        </div>
        <div className="team-card-white flex flex-col items-center justify-center !py-5 text-center">
          {finalChip("white")}
          <span className="text-[13px] font-bold">백팀</span>
          <strong className="font-display text-5xl font-extrabold">{score.white_wins}</strong>
          <span className="text-xs font-semibold opacity-75">게임 {score.white_games}</span>
        </div>
      </section>
      {t.can_manage ? <FinalWinnerForm t={t} /> : null}

      <section className="grid gap-4 md:grid-cols-2">
        {(["blue", "white"] as const).map((color) => (
          <TeamCard
            key={color}
            color={color}
            entries={team(color)}
            size={color === "blue" ? t.blue_size : t.white_size}
            manage={t.can_manage}
          />
        ))}
      </section>

      {t.can_manage ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">팀이 없는 참가자 {pool.length}명</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(true)}>
                <UserPlus size={14} /> 참가자 넣기
              </button>
            </div>
            {pool.length === 0 ? (
              <p className="text-sm font-medium text-slate-500">
                {t.entries.length ? "모두 팀에 들어갔어요." : "참가자를 먼저 넣어 주세요."}
              </p>
            ) : (
              <ul>
                {pool.map((e) => (
                  <li key={e.id} className="team-row !border-slate-200 dark:!border-slate-700">
                    <PlayerLine user={e.players[0]} />
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {(["blue", "white"] as const).map((c) => (
                        <EntryOp key={c} entry={e} op={c}>
                          <span className={c === "blue" ? "team-chip-blue" : "team-chip-white"}>
                            {c === "blue" ? "청" : "백"}
                          </span>
                        </EntryOp>
                      ))}
                      <EntryOp entry={e} op="remove" confirmText={`${e.players[0].name} 님을 대회에서 뺄까요?`}>
                        <span className="px-1 text-[11px] font-semibold text-slate-500 hover:underline">빼기</span>
                      </EntryOp>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <RandomTeamsForm t={t} />
        </section>
      ) : pool.length ? (
        <p className="card text-sm font-medium text-slate-500">
          팀이 없는 참가자: {pool.map((e) => e.players[0].name).join(", ")}
        </p>
      ) : null}

      <TeamBattleMatches t={t} />

      {adding ? (
        <AddPlayersModal t={t} members={members} onClose={() => setAdding(false)} />
      ) : null}
    </>
  );
}

/** 운영진: 청백전 최종 승리팀 정하기 (경기 승수와 상관없이). 다시 누르면 바꾸고, 취소하면 정하기 전으로 */
function FinalWinnerForm({ t }: { t: TournamentDetail }) {
  const busy = useBusy("set_winner");
  const score = t.score!;
  const leading =
    score.blue_wins > score.white_wins ? "청팀이" : score.white_wins > score.blue_wins ? "백팀이" : null;
  const choose = (value: TeamResult | "", label: string, className: string) => (
    <Form
      method="post"
      onSubmit={(e) => {
        const ask = value ? `최종 결과를 '${label}'로 정할까요?` : "정한 최종 결과를 취소할까요?";
        if (!confirm(ask)) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="set_winner" />
      <input type="hidden" name="winner_team" value={value} />
      <button className={className} disabled={busy}>
        {label}
      </button>
    </Form>
  );
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="section-title">최종 승리팀</h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          {t.winner_team
            ? `'${TEAM_RESULT_LABEL[t.winner_team]}'로 정했어요. 회원 모두에게 보여요.`
            : `경기 승수와 상관없이 운영진이 정해요.${
                t.played ? (leading ? ` 지금은 ${leading} 앞서요.` : " 지금은 승수가 같아요.") : ""
              }`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["blue", "white", "draw"] as const).map((v) => (
          <span key={v}>
            {choose(v, TEAM_RESULT_LABEL[v], t.winner_team === v ? "btn-primary btn-sm" : "btn-ghost btn-sm")}
          </span>
        ))}
        {t.winner_team
          ? choose("", "선택 취소", "px-1 text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline")
          : null}
      </div>
    </section>
  );
}

function TeamCard({
  color,
  entries,
  size,
  manage,
}: {
  color: TeamColor;
  entries: TournamentEntry[];
  size: number | null;
  manage: boolean;
}) {
  const captain = entries.find((e) => e.is_captain);
  return (
    <div className={color === "blue" ? "team-card-blue" : "team-card-white"}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="tile-title">{TEAM_LABEL[color]}</h2>
        <span className="text-sm font-bold">
          {entries.length}
          {size ? `/${size}` : ""}명
        </span>
      </div>
      <p className="tile-sub flex items-center gap-1.5">
        <Crown size={14} />
        {captain ? `팀장 ${captain.players[0].name}` : manage ? "팀장은 이름 옆 ‘바꾸기’에서 정해요" : "팀장 미정"}
      </p>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm font-medium opacity-70">아직 아무도 없어요.</p>
      ) : (
        <ul className="mt-3">
          {[...entries]
            .sort((a, b) => Number(b.is_captain) - Number(a.is_captain))
            .map((e) => (
              <li key={e.id} className="team-row">
                <PlayerLine user={e.players[0]}>
                  {e.is_captain ? <Crown size={14} className="shrink-0" aria-label="팀장" /> : null}
                  {e.random_pick ? <span className="chip-line !h-5 !px-2 !text-[10px]">랜덤</span> : null}
                </PlayerLine>
                {manage ? <EntryMenu entry={e} /> : null}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** 청백전 참가자 한 명의 메뉴: 팀장으로 · 다른 팀으로 · 팀에서 빼기 · 대회에서 빼기 */
function EntryMenu({ entry }: { entry: TournamentEntry }) {
  const busy = useBusy("entry_menu", { name: "entry_id", value: entry.id });
  const name = entry.players[0]?.name ?? "";
  return (
    <Form method="post" className="ml-auto">
      <input type="hidden" name="intent" value="entry_menu" />
      <input type="hidden" name="entry_id" value={entry.id} />
      <select
        name="op"
        value=""
        disabled={busy}
        aria-label={`${name} 바꾸기`}
        className="team-menu"
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (e.currentTarget.value === "remove" && !confirm(`${name} 님을 대회에서 뺄까요?`)) return;
          form?.requestSubmit();
        }}
      >
        <option value="" disabled>
          {busy ? "바꾸는 중…" : "바꾸기"}
        </option>
        {!entry.is_captain ? <option value="captain">팀장으로 정하기</option> : null}
        {entry.team !== "blue" ? <option value="blue">청팀으로 옮기기</option> : null}
        {entry.team !== "white" ? <option value="white">백팀으로 옮기기</option> : null}
        <option value="none">팀에서 빼기</option>
        <option value="remove">대회에서 빼기</option>
      </select>
    </Form>
  );
}

/** 버튼 하나로 하는 참가자 처리 (청·백 넣기, 빼기, 짝 풀기) */
function EntryOp({
  entry,
  op,
  confirmText,
  children,
}: {
  entry: TournamentEntry;
  op: string;
  confirmText?: string;
  children: ReactNode;
}) {
  const busy = useBusy("entry_menu", { name: "entry_id", value: entry.id });
  return (
    <Form
      method="post"
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="entry_menu" />
      <input type="hidden" name="entry_id" value={entry.id} />
      <input type="hidden" name="op" value={op} />
      <button disabled={busy} className="flex items-center disabled:opacity-40">
        {children}
      </button>
    </Form>
  );
}

function RandomTeamsForm({ t }: { t: TournamentDetail }) {
  const busy = useBusy("random_teams");
  const rerun = t.entries.some((e) => e.random_pick);
  return (
    <Form method="post" className="card space-y-3">
      <input type="hidden" name="intent" value="random_teams" />
      <h2 className="section-title">나머지 랜덤 배정</h2>
      <p className="text-[13px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
        팀장과 직접 넣은 사람은 그대로 두고, 팀이 없는 사람만 팀별 인원 수까지 랜덤으로 넣어요. 남녀가 한쪽에
        몰리지 않게 나눠요. 다시 누르면 랜덤으로 넣은 사람만 다시 돌려요.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="r_blue">
            청팀 인원
          </label>
          <input
            id="r_blue"
            name="blue_size"
            type="number"
            inputMode="numeric"
            min="1"
            className="input"
            placeholder="반씩"
            defaultValue={t.blue_size ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor="r_white">
            백팀 인원
          </label>
          <input
            id="r_white"
            name="white_size"
            type="number"
            inputMode="numeric"
            min="1"
            className="input"
            placeholder="반씩"
            defaultValue={t.white_size ?? ""}
          />
        </div>
      </div>
      <button className="btn-primary w-full sm:w-auto" disabled={busy}>
        <Shuffle size={16} />
        {busy ? "배정하는 중…" : rerun ? "랜덤 다시 돌리기" : "나머지 랜덤 배정"}
      </button>
    </Form>
  );
}

function TeamBattleMatches({ t }: { t: TournamentDetail }) {
  const lineup = t.can_manage || !!t.captain_of;
  const [composing, setComposing] = useState(false);
  const randomBusy = useBusy("random_matches");
  const blue = t.entries.filter((e) => e.team === "blue" && e.players.length).map((e) => e.players[0]);
  const white = t.entries.filter((e) => e.team === "white" && e.players.length).map((e) => e.players[0]);
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">경기 {t.matches.length}</h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            이긴 경기마다 그 팀이 1승이에요. 점수는 그 경기 선수·팀장·운영진이 적어요.
          </p>
        </div>
        {lineup ? (
          <div className="flex flex-wrap items-center gap-2">
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="random_matches" />
              <select name="match_type" className="input !h-8 !w-auto !py-0 !pl-3 !pr-8 text-[13px] font-semibold" aria-label="종목">
                <option value="doubles">복식</option>
                <option value="singles">단식</option>
              </select>
              <button className="btn-primary btn-sm" disabled={randomBusy}>
                <Shuffle size={14} /> {randomBusy ? "짜는 중…" : "랜덤으로 한 라운드"}
              </button>
            </Form>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setComposing((v) => !v)}>
              {composing ? "닫기" : "직접 짜기"}
            </button>
          </div>
        ) : null}
      </div>
      {lineup && composing ? <ComposeMatch blue={blue} white={white} matches={t.matches} onDone={() => setComposing(false)} /> : null}
      {t.matches.length === 0 ? (
        <p className="text-sm font-medium text-slate-500">
          {lineup
            ? "팀을 나눈 뒤 ‘랜덤으로 한 라운드’나 ‘직접 짜기’로 경기를 만들어요. 랜덤은 경기를 덜 뛴 사람부터 넣어요."
            : "아직 짠 경기가 없어요."}
        </p>
      ) : (
        <div className="draw-grid !mt-0">
          {t.matches.map((m, i) => (
            <TeamBattleMatch key={m.id} match={m} index={i + 1} lineup={lineup} />
          ))}
        </div>
      )}
    </section>
  );
}

function ComposeMatch({
  blue,
  white,
  matches,
  onDone,
}: {
  blue: UserBrief[];
  white: UserBrief[];
  matches: TournamentMatch[];
  onDone: () => void;
}) {
  const [doubles, setDoubles] = useState(true);
  // 자리마다 고른 선수 id ("" = 아직): 한 사람을 두 자리에 고를 수 없게 다른 자리에서 고른 사람은 목록에서 뺀다
  const [picked, setPicked] = useState<Record<"blue_id" | "white_id", string[]>>({
    blue_id: ["", ""],
    white_id: ["", ""],
  });
  const busy = useBusy("add_match");
  const seats = doubles ? [0, 1] : [0];
  // 고를 때 참고: 지금까지 뛴 경기 수, 점수가 아직 없는 경기에 들어가 있으면 '경기 중'
  const played = new Map<number, number>();
  const playing = new Set<number>();
  for (const m of matches) {
    for (const p of [...m.team1, ...m.team2]) {
      played.set(p.id, (played.get(p.id) ?? 0) + 1);
      if (!m.recorded) playing.add(p.id);
    }
  }
  const picker = (name: "blue_id" | "white_id", players: UserBrief[], i: number, label: string) => {
    const others = new Set(picked[name].filter((v, j) => j !== i && j < seats.length && v));
    return (
      <select
        key={`${name}${i}`}
        name={name}
        required
        value={picked[name][i]}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setPicked((prev) => ({ ...prev, [name]: prev[name].map((v, j) => (j === i ? value : v)) }));
        }}
        className="input !h-10 !py-0 text-[13px] font-semibold"
        aria-label={`${label} ${i + 1}번`}
      >
        <option value="">{label} 선수</option>
        {players
          .filter((p) => !others.has(String(p.id)))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {playing.has(p.id) ? "경기 중" : `${played.get(p.id) ?? 0}경기`}
            </option>
          ))}
      </select>
    );
  };
  return (
    <Form method="post" className="space-y-3 rounded-2xl bg-slate-100 p-4 dark:bg-slate-800" onSubmit={() => setTimeout(onDone, 0)}>
      <input type="hidden" name="intent" value="add_match" />
      <div className="segmented">
        {[true, false].map((d) => (
          <button
            key={String(d)}
            type="button"
            className={`segmented-item ${doubles === d ? "segmented-item-active" : ""}`}
            onClick={() => setDoubles(d)}
          >
            {d ? "복식" : "단식"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-2">
        <div className="space-y-2">{seats.map((i) => picker("blue_id", blue, i, "청팀"))}</div>
        <span className="text-center font-display text-xs text-slate-400">VS</span>
        <div className="space-y-2">{seats.map((i) => picker("white_id", white, i, "백팀"))}</div>
      </div>
      <button className="btn-primary btn-sm" disabled={busy}>
        {busy ? "넣는 중…" : "경기 넣기"}
      </button>
    </Form>
  );
}

function TeamBattleMatch({ match, index, lineup }: { match: TournamentMatch; index: number; lineup: boolean }) {
  const side = (label: string, chip: string, players: UserBrief[], won: boolean) => (
    <div className={`space-y-2.5 ${won ? "" : match.recorded ? "opacity-60" : ""}`}>
      <span className={chip}>
        {label}
        {won ? " 승" : ""}
      </span>
      {players.map((p) => (
        <span key={p.id} className="draw-player">
          <PlayerLine user={p} />
        </span>
      ))}
    </div>
  );
  return (
    <div className="draw-card">
      <div className="flex items-center justify-between gap-2">
        <span className="badge-gray">
          {index}경기 · {MATCH_TYPE_LABEL[match.match_type]}
        </span>
        {lineup ? (
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm(match.recorded ? "이 경기를 뺄까요? 적은 점수도 함께 빠져요." : "이 경기를 뺄까요?"))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete_match" />
            <input type="hidden" name="match_id" value={match.id} />
            <button className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">
              경기 빼기
            </button>
          </Form>
        ) : null}
      </div>
      <div className="draw-teams">
        {side("청팀", "team-chip-blue", match.team1, match.winner === 1)}
        <span className="text-center font-display text-xs text-slate-400">VS</span>
        {side("백팀", "team-chip-white", match.team2, match.winner === 2)}
      </div>
      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <ScoreBox match={match} labels={["청팀", "백팀"]} />
      </div>
    </div>
  );
}

/** 점수 보기·적기·고치기·지우기 */
function ScoreBox({
  match,
  labels,
  compact = false,
}: {
  match: TournamentMatch;
  labels: [string, string];
  compact?: boolean;
}) {
  const busy = useBusy("result", { name: "match_id", value: match.id });
  const [fixing, setFixing] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) wasBusy.current = true;
    else if (wasBusy.current) {
      wasBusy.current = false;
      setFixing(false);
    }
  }, [busy]);

  if (match.recorded && !fixing) {
    const result =
      match.winner === null ? "무승부" : `${labels[match.winner - 1]} 승`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {compact ? null : (
          <span className="badge-gray">
            <Check size={13} /> {match.team1_score}:{match.team2_score} · {result}
          </span>
        )}
        {match.can_score ? (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setFixing(true)}>
              <Pencil size={13} /> 수정
            </button>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("이 경기 점수를 지울까요?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete_result" />
              <input type="hidden" name="match_id" value={match.id} />
              <button className="px-1 text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">
                지우기
              </button>
            </Form>
          </span>
        ) : null}
      </div>
    );
  }
  if (!match.can_score) {
    return compact ? null : <p className="text-center text-xs text-slate-500 dark:text-slate-400">경기 예정</p>;
  }
  return (
    <Form method="post" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="result" />
      <input type="hidden" name="match_id" value={match.id} />
      {(["team1_score", "team2_score"] as const).map((name, i) => (
        <span key={name} className="contents">
          {i === 1 ? <span className="text-slate-400">:</span> : null}
          <input
            name={name}
            type="number"
            min="0"
            max="99"
            required
            inputMode="numeric"
            className="input !w-14 !px-2 !py-1.5 text-center"
            placeholder="0"
            aria-label={`${labels[i]} 게임 수`}
            defaultValue={match.recorded ? match[name] ?? undefined : undefined}
          />
        </span>
      ))}
      {fixing ? (
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setFixing(false)}>
          취소
        </button>
      ) : null}
      <button className={`btn-primary btn-sm ${fixing ? "" : "ml-auto"}`} disabled={busy}>
        {busy ? "저장 중…" : fixing ? "저장" : "점수 적기"}
      </button>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// 단식·복식 토너먼트
// ---------------------------------------------------------------------------
function Knockout({ t, members }: { t: TournamentDetail; members: UserBrief[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      {t.champion ? (
        <section className="tile-yellow flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink text-house-yellow">
            <Trophy size={26} />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">CHAMPION</p>
            <p className="tile-title truncate">{entryName(t.champion)}</p>
            <p className="tile-sub">우승을 축하해요!</p>
          </div>
        </section>
      ) : null}
      {t.matches.length ? <Bracket t={t} /> : <KnockoutEntries t={t} onAdd={() => setAdding(true)} />}
      {adding ? <AddPlayersModal t={t} members={members} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function KnockoutEntries({ t, onAdd }: { t: TournamentDetail; onAdd: () => void }) {
  const doubles = t.kind === "doubles";
  const filled = t.entries.filter((e) => e.players.length);
  const pairs = doubles ? filled.filter((e) => e.players.length === 2) : filled;
  const alone = doubles ? filled.filter((e) => e.players.length === 1) : [];
  const bracketBusy = useBusy("bracket");
  const pairBusy = useBusy("random_pairs");
  const ready = pairs.length >= 2 && alone.length === 0;
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">
            참가 {pairs.length}
            {doubles ? "팀" : "명"}
            {alone.length ? ` · 짝 없음 ${alone.length}명` : ""}
          </h2>
          {t.can_manage ? (
            <button type="button" className="btn-ghost btn-sm" onClick={onAdd}>
              <UserPlus size={14} /> 참가자 넣기
            </button>
          ) : null}
        </div>
        {filled.length === 0 ? (
          <p className="text-sm font-medium text-slate-500">
            {t.can_manage ? "참가자를 넣어 주세요." : "아직 참가자가 없어요."}
          </p>
        ) : (
          <ul>
            {pairs.map((e) => (
              <li key={e.id} className="team-row !border-slate-200 dark:!border-slate-700">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  {e.players.map((p) => (
                    <PlayerLine key={p.id} user={p} />
                  ))}
                  {e.random_pick ? <span className="badge-line !h-5 !px-2 !text-[10px]">랜덤 짝</span> : null}
                </span>
                {t.can_manage ? (
                  <EntryOp
                    entry={e}
                    op={doubles ? "split" : "remove"}
                    confirmText={doubles ? undefined : `${e.players[0].name} 님을 대회에서 뺄까요?`}
                  >
                    <span className="px-1 text-[11px] font-semibold text-slate-500 hover:underline">
                      {doubles ? "짝 풀기" : "빼기"}
                    </span>
                  </EntryOp>
                ) : null}
              </li>
            ))}
            {alone.map((e) => (
              <li key={e.id} className="team-row !border-slate-200 dark:!border-slate-700">
                <PlayerLine user={e.players[0]}>
                  <span className="badge-orange-soft !h-5 !px-2 !text-[10px]">짝 없음</span>
                </PlayerLine>
                {t.can_manage ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <PartnerPicker entry={e} options={alone.filter((o) => o.id !== e.id)} />
                    <EntryOp entry={e} op="remove" confirmText={`${e.players[0].name} 님을 대회에서 뺄까요?`}>
                      <span className="px-1 text-[11px] font-semibold text-slate-500 hover:underline">빼기</span>
                    </EntryOp>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {t.can_manage ? (
        <div className="space-y-4">
          {doubles ? (
            <Form method="post" className="card space-y-3">
              <input type="hidden" name="intent" value="random_pairs" />
              <h2 className="section-title">나머지 랜덤 짝</h2>
              <p className="text-[13px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                직접 지은 짝은 그대로 두고 짝이 없는 사람끼리 랜덤으로 지어요. 남녀가 같이 있으면 혼복 짝부터
                지어요. 다시 누르면 랜덤 짝만 다시 돌려요.
              </p>
              <button
                className="btn-ghost w-full"
                disabled={pairBusy || (alone.length < 2 && !pairs.some((e) => e.random_pick))}
              >
                <Shuffle size={16} /> {pairs.some((e) => e.random_pick) ? "랜덤 짝 다시 돌리기" : "나머지 랜덤 짝"}
              </button>
            </Form>
          ) : null}
          <Form method="post" className="tile-green space-y-3">
            <input type="hidden" name="intent" value="bracket" />
            <h2 className="tile-title">대진표 추첨</h2>
            <p className="tile-sub leading-relaxed">
              참가 순서를 랜덤으로 섞어 1라운드부터 결승까지 만들어요. 2·4·8·16팀이 아니면 1라운드에 부전승이
              생겨요. 추첨한 뒤에는 참가자를 바꿀 수 없어요.
            </p>
            <button className="btn-ink w-full" disabled={!ready || bracketBusy}>
              <Shuffle size={16} /> {bracketBusy ? "추첨하는 중…" : "대진표 추첨"}
            </button>
            {!ready ? (
              <p className="text-xs font-semibold">
                {alone.length ? "짝이 없는 사람을 짝지어 주거나 빼 주세요." : "참가가 둘 이상이어야 해요."}
              </p>
            ) : null}
          </Form>
        </div>
      ) : (
        <p className="card text-sm font-medium text-slate-500">운영진이 대진표를 추첨하면 여기에 떠요.</p>
      )}
    </section>
  );
}

function PartnerPicker({ entry, options }: { entry: TournamentEntry; options: TournamentEntry[] }) {
  const busy = useBusy("pair", { name: "entry_id", value: entry.id });
  if (!options.length) return null;
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="pair" />
      <input type="hidden" name="entry_id" value={entry.id} />
      <select
        name="partner_id"
        value=""
        disabled={busy}
        aria-label={`${entry.players[0].name} 짝 고르기`}
        className="team-menu !border-slate-300 dark:!border-slate-600 dark:!text-slate-100"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="" disabled>
          {busy ? "짝 짓는 중…" : "짝 고르기"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.players[0].name}
          </option>
        ))}
      </select>
    </Form>
  );
}

function Bracket({ t }: { t: TournamentDetail }) {
  const rounds = Array.from({ length: t.rounds }, (_, i) => i + 1);
  const deleting = useBusy("delete_bracket");
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">대진표</h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            점수를 적으면 이긴 쪽이 다음 라운드로 올라가요. 그 경기 선수와 운영진이 적어요.
            <span className="sm:hidden"> 옆으로 밀면 다음 라운드가 보여요.</span>
          </p>
        </div>
        {t.can_manage ? (
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("대진표를 지울까요? 적은 점수도 함께 지워지고, 참가자는 그대로 남아요."))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete_bracket" />
            <button className="btn-ghost btn-sm" disabled={deleting}>
              <Trash2 size={14} /> 대진표 지우고 다시
            </button>
          </Form>
        ) : null}
      </div>
      <div className="bracket">
        {rounds.map((r) => (
          <div key={r} className="bracket-round">
            <p className="eyebrow text-slate-500 dark:text-slate-400">
              {roundLabel(r, t.rounds)}
            </p>
            <div className="bracket-col">
              {t.matches
                .filter((m) => m.round_number === r)
                .map((m) => (
                  <BracketMatch key={m.id} match={m} final={r === t.rounds} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BracketMatch({ match, final }: { match: TournamentMatch; final: boolean }) {
  const line = (players: UserBrief[], score: number | null, side: 1 | 2) => {
    const won = match.winner === side && (match.recorded || match.bye);
    const lost = match.recorded && match.winner !== side;
    return (
      <div className={`bracket-line ${lost ? "opacity-45" : ""}`}>
        {players.length ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="flex shrink-0 -space-x-2">
              {players.map((p) => (
                <MemberAvatar key={p.id} user={p} className="!h-7 !w-7 !text-[11px] ring-2 ring-paper dark:ring-slate-900" />
              ))}
            </span>
            <span className={`truncate ${won ? "font-extrabold" : ""}`}>{entryName(players)}</span>
            {won && final ? <Trophy size={14} className="shrink-0 text-[#C9A227]" /> : null}
          </span>
        ) : (
          <span className="flex-1 text-xs font-medium text-slate-400">
            {match.bye ? "부전승" : "승자 기다리는 중"}
          </span>
        )}
        {match.recorded ? (
          <span className={`font-display text-base ${won ? "font-extrabold" : ""}`}>{score}</span>
        ) : null}
      </div>
    );
  };
  return (
    <div className={`bracket-match ${final ? "border-ink dark:border-slate-400" : ""}`}>
      {line(match.team1, match.team1_score, 1)}
      {line(match.team2, match.team2_score, 2)}
      {match.can_score || match.recorded ? (
        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          <ScoreBox match={match} labels={["위", "아래"]} compact />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 참가자 넣기 · 정보 고치기
// ---------------------------------------------------------------------------
function AddPlayersModal({
  t,
  members,
  onClose,
}: {
  t: TournamentDetail;
  members: UserBrief[];
  onClose: () => void;
}) {
  const joined = new Set(t.entries.flatMap((e) => e.players.map((p) => p.id)));
  const candidates = members.filter((m) => !joined.has(m.id));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const q = query.trim();
  const shown = q ? candidates.filter((m) => `${m.name}${m.nickname ?? ""}`.includes(q)) : candidates;
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((m) => picked.has(m.id));
  return (
    <Modal title="참가자 넣기" onClose={onClose}>
      <Form method="post" className="space-y-4" onSubmit={() => setTimeout(onClose, 0)}>
        <input type="hidden" name="intent" value="add_players" />
        {[...picked].map((id) => (
          <input key={id} type="hidden" name="user_id" value={id} />
        ))}
        {t.kind === "team_battle" ? (
          <fieldset>
            <legend className="label">어디에 넣을까요?</legend>
            <div className="segmented">
              {[
                ["", "팀 없음 (랜덤 대상)"],
                ["blue", "청팀"],
                ["white", "백팀"],
              ].map(([value, label]) => (
                <label key={value} className="cursor-pointer">
                  <input type="radio" name="team" value={value} defaultChecked={!value} className="peer sr-only" />
                  <span className="segmented-item peer-checked:bg-paper peer-checked:text-ink peer-checked:shadow-sm dark:peer-checked:bg-slate-600 dark:peer-checked:text-white">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="search"
            className="input"
            placeholder="이름으로 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="이름으로 찾기"
          />
          <button
            type="button"
            className="btn-ghost shrink-0"
            disabled={!shown.length}
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                for (const m of shown) {
                  if (allShown) next.delete(m.id);
                  else next.add(m.id);
                }
                return next;
              })
            }
          >
            {allShown ? "모두 풀기" : "모두 고르기"}
          </button>
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm font-medium text-slate-500">회원이 모두 들어 있어요.</p>
        ) : (
          <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {shown.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                  picked.has(m.id)
                    ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-ink"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <input type="checkbox" className="sr-only" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                <MemberAvatar user={m} className="!h-7 !w-7 shrink-0 !text-[11px]" />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="submit" className="btn-primary h-12 w-full" disabled={picked.size === 0}>
            {picked.size ? `${picked.size}명 넣기` : "넣을 사람을 골라 주세요"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}

function EditInfoModal({ t, onClose }: { t: TournamentDetail; onClose: () => void }) {
  return (
    <Modal title="대회 정보 고치기" onClose={onClose}>
      <Form method="post" className="space-y-4" onSubmit={() => setTimeout(onClose, 0)}>
        <input type="hidden" name="intent" value="update_info" />
        <div>
          <label className="label" htmlFor="e_title">
            대회 이름
          </label>
          <input id="e_title" name="title" required maxLength={100} className="input" defaultValue={t.title} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e_date">
              날짜
            </label>
            <input id="e_date" name="event_date" type="date" className="input" defaultValue={t.event_date ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="e_location">
              장소
            </label>
            <input id="e_location" name="location" maxLength={200} className="input" defaultValue={t.location ?? ""} />
          </div>
        </div>
        {t.kind === "team_battle" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="e_blue">
                청팀 인원
              </label>
              <input id="e_blue" name="blue_size" type="number" min="1" className="input" placeholder="반씩" defaultValue={t.blue_size ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="e_white">
                백팀 인원
              </label>
              <input id="e_white" name="white_size" type="number" min="1" className="input" placeholder="반씩" defaultValue={t.white_size ?? ""} />
            </div>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="e_note">
            메모
          </label>
          <textarea id="e_note" name="note" rows={3} maxLength={1000} className="input" defaultValue={t.note ?? ""} />
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn-primary h-12 w-full">
            저장
          </button>
        </div>
      </Form>
    </Modal>
  );
}
