// 대회(청백전 · 단식·복식 토너먼트) 표기 (서버 app/routers/tournaments.py 와 같은 규칙)
import type { TeamColor, TeamResult, TournamentKind, TournamentSummary, UserBrief } from "~/lib/types";

export const TOURNAMENT_KIND_LABEL: Record<TournamentKind, string> = {
  team_battle: "청백전",
  singles: "단식 토너먼트",
  doubles: "복식 토너먼트",
};

export const TOURNAMENT_KIND_HINT: Record<TournamentKind, string> = {
  team_battle: "청팀·백팀으로 나눠 이긴 경기 수로 승부",
  singles: "한 명씩 추첨해 이기면 다음 라운드로",
  doubles: "두 명이 한 팀, 짝을 짓고 추첨",
};

export const TOURNAMENT_KIND_BADGE: Record<TournamentKind, string> = {
  team_battle: "badge-blue",
  singles: "badge-green",
  doubles: "badge-lav",
};

export const TOURNAMENT_KINDS: TournamentKind[] = ["team_battle", "singles", "doubles"];

export const TEAM_LABEL: Record<TeamColor, string> = { blue: "청팀", white: "백팀" };

export const TEAM_RESULT_LABEL: Record<TeamResult, string> = {
  blue: "청팀 승리",
  white: "백팀 승리",
  draw: "무승부",
};

/** 토너먼트 라운드 이름: 마지막 = 결승, 그 앞 = 4강, 8강 … */
export function roundLabel(round: number, rounds: number) {
  const left = 2 ** (rounds - round + 1);
  return left === 2 ? "결승" : `${left}강`;
}

/** 복식은 "김민준 · 이서연" */
export const entryName = (players: UserBrief[]) =>
  players.length ? players.map((p) => p.name).join(" · ") : "—";

/** 목록·머리에 쓰는 진행 상태. 청백전은 경기를 더 짤 수 있어 "끝"이 없다 */
export function tournamentStatus(t: TournamentSummary) {
  if (t.champion || t.winner_team) return { label: "끝", badge: "badge-ink" };
  if (t.total === 0) return { label: "준비 중", badge: "badge-gray" };
  return { label: `경기 ${t.played}/${t.total}`, badge: "badge-yellow" };
}

/** 폼의 인원 수 칸: 비우거나 0 이하면 null */
export function numberOrNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
