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

/** 달력 칸 안의 일정 칩 색 */
export const GATHERING_STATUS_CHIP: Record<GatheringStatus, string> = {
  planned: "bg-house-blue text-white",
  ongoing: "bg-house-yellow text-ink",
  completed: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  canceled: "bg-house-red/15 text-[#B42318] line-through dark:text-red-300",
};

/** 달력 모바일 점 색 */
export const GATHERING_STATUS_DOT: Record<GatheringStatus, string> = {
  planned: "bg-house-blue",
  ongoing: "bg-house-yellow",
  completed: "bg-slate-300 dark:bg-slate-600",
  canceled: "bg-house-red",
};

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 회원 구분 이름 */
export const MEMBER_TYPE_LABEL: Record<MemberType, string> = {
  officer: "임원진",
  member: "정회원",
  guest: "게스트",
};

/** "2026-10-13T00:00:00" → "10월 13일(월) 0시" (서버가 준 한국 시간 그대로) */
export function formatOpenAt(iso: string): string {
  const [d, t = "00:00"] = iso.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, day).getDay()];
  return `${m}월 ${day}일(${wd}) ${Number(t.slice(0, 2))}시`;
}

/** "임원진" → "임원진으로", "게스트" → "게스트로" (받침에 맞춘 조사) */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  // 받침 없음 또는 ㄹ받침 → "로", 그 밖의 받침 → "으로"
  return `${word}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}
