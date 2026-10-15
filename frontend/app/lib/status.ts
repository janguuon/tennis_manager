import type { GatheringStatus, MemberType } from "~/lib/types";

export const GATHERING_STATUS_LABEL: Record<GatheringStatus, string> = {
  planned: "예정",
  ongoing: "진행중",
  completed: "완료",
  canceled: "취소",
};

/** 상태 배지 클래스 (tailwind.css의 badge-*) */
export const GATHERING_STATUS_BADGE: Record<GatheringStatus, string> = {
  planned: "badge-line",
  ongoing: "badge-yellow",
  completed: "badge-gray",
  canceled: "badge-red",
};

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 회원 구분 이름 */
export const MEMBER_TYPE_LABEL: Record<MemberType, string> = {
  treasurer: "총무",
  officer: "임원진",
  member: "정회원",
  guest: "게스트",
};

/**
 * "2026-10-16T10:00:00" → "10월 16일(금) 오전 10시", 자정은 "0시"
 * (서버가 준 한국 시간 그대로, backend visibility.format_open_at 와 같은 표기)
 */
export function formatOpenAt(iso: string): string {
  const [d, t = "00:00"] = iso.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, day).getDay()];
  const h = Number(t.slice(0, 2));
  const min = Number(t.slice(3, 5));
  const hour =
    h === 0
      ? "0시"
      : h < 12
      ? `오전 ${h}시`
      : h === 12
      ? "낮 12시"
      : `오후 ${h - 12}시`;
  return `${m}월 ${day}일(${wd}) ${hour}${min ? ` ${min}분` : ""}`;
}

/** "임원진" → "임원진으로", "게스트" → "게스트로" (받침에 맞춘 조사) */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  // 받침 없음 또는 ㄹ받침 → "로", 그 밖의 받침 → "으로"
  return `${word}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}
