import type { AttendanceStatus, Participant } from "~/lib/types";

/** 참석 투표 상태. 미정은 더 이상 고를 수 없고 예전 투표 표시용으로만 남는다. */
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  attending: "참석",
  absent: "불참",
  waiting: "대기",
  maybe: "미정",
};

/** 모임 며칠 전부터 참석자가 불참으로 바꿀 수 없는지 (서버 ATTENDANCE_LOCK_DAYS 와 같게) */
export const ATTENDANCE_LOCK_DAYS = 3;

/** 대기자를 대기 순서대로 */
export function waitingList<T extends Pick<Participant, "status" | "waiting_since">>(participants: T[]): T[] {
  return participants
    .filter((p) => p.status === "waiting")
    .sort((a, b) => (a.waiting_since ?? "").localeCompare(b.waiting_since ?? ""));
}

/** 정원이 다 찼는지 */
export function isFull(g: { max_participants: number | null }, attending: number) {
  return g.max_participants != null && attending >= g.max_participants;
}
