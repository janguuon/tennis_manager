import type { Tier } from "~/lib/types";

/** 내부 티어 (관리자 전용) 표시 도우미. */
export const TIERS: Tier[] = ["A", "B", "C", "D", "E"];

// Tailwind 가 지우지 않도록 클래스 이름을 그대로 적는다
export const TIER_CLASS: Record<Tier, string> = {
  A: "tier-badge tier-a",
  B: "tier-badge tier-b",
  C: "tier-badge tier-c",
  D: "tier-badge tier-d",
  E: "tier-badge tier-e",
};

/** 대진 생성 방식. skill 은 예전 이름(실력 균형). */
export const DRAW_METHOD_LABEL: Record<string, string> = {
  random: "다양하게",
  balanced: "실력 밸런스",
  skill: "실력 균형",
  manual: "수동",
};

/** 팀1 기대 득점률 → "52:48" */
export function expectedSplit(expectedTeam1: number) {
  const a = Math.round(expectedTeam1 * 100);
  return `${a}:${100 - a}`;
}

export function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0";
}
