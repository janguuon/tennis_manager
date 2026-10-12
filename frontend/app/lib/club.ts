// 모임 종류·회원 등급 표기와 권한 (서버·클라이언트 공용)
import type { GatheringKind, User } from "~/lib/types";

export const KIND_LABEL: Record<GatheringKind, string> = {
  club_regular: "오테식 정모",
  club_flash: "오테식 벙개",
  flash: "일반 벙개",
};

/** 달력 칩처럼 좁은 곳에 쓰는 짧은 이름 */
export const KIND_SHORT: Record<GatheringKind, string> = {
  club_regular: "정모",
  club_flash: "오테식 벙개",
  flash: "벙개",
};

/** 종류 배지 (중립 바탕용) */
export const KIND_BADGE: Record<GatheringKind, string> = {
  club_regular: "badge-green",
  club_flash: "badge-lav",
  flash: "badge-line",
};

/** 종류 선택 버튼에 붙는 한 줄 설명 */
export const KIND_HINT: Record<GatheringKind, string> = {
  club_regular: "회비에서 지출 · 게스트만 참가비",
  club_flash: "회비에서 지출 · 게스트만 참가비",
  flash: "코트비 + 캔볼값을 참석자끼리 n빵",
};

export const KIND_ORDER: GatheringKind[] = [
  "club_regular",
  "club_flash",
  "flash",
];

export const isClubKind = (kind: GatheringKind) => kind !== "flash";

/** 관리자 또는 임원진: 오테식 모임 생성, 코트비 지급 처리 */
export const isStaff = (u: Pick<User, "is_admin" | "member_type">) =>
  u.is_admin || u.member_type === "officer";
