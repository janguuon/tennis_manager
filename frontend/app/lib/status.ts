import type { GatheringStatus } from "~/lib/types";

export const GATHERING_STATUS_LABEL: Record<GatheringStatus, string> = {
  planned: "예정",
  ongoing: "진행중",
  completed: "완료",
  canceled: "취소",
};

/** 상태 배지 클래스 (tailwind.css의 badge-*) */
export const GATHERING_STATUS_BADGE: Record<GatheringStatus, string> = {
  planned: "badge-lime",
  ongoing: "badge-amber",
  completed: "badge-gray",
  canceled: "badge-red",
};

/** 달력 모바일 점 색 */
export const GATHERING_STATUS_DOT: Record<GatheringStatus, string> = {
  planned: "bg-ball-500",
  ongoing: "bg-amber-500",
  completed: "bg-slate-300 dark:bg-slate-600",
  canceled: "bg-red-400",
};

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
