import type { GatheringStatus } from "~/lib/types";

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
