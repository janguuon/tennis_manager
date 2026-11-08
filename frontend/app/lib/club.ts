// 모임 종류·회원 등급 표기와 권한 (서버·클라이언트 공용)
import type { CourtSurface, GatheringKind, MemberType, User } from "~/lib/types";

/*
 * 교류전(다른 클럽과 겨루는 모임)은 정산 방식에 따라 둘로 저장한다:
 * exchange = 회비에서 지출 (오테식 정모처럼), exchange_split = 참석자끼리 n빵 (일반 벙개처럼).
 * 이름·색·필터에서는 한 종류(교류전)로 보인다 — kindGroup.
 */
export const KIND_LABEL: Record<GatheringKind, string> = {
  club_regular: "오테식 정모",
  club_flash: "오테식 벙개",
  exchange: "교류전",
  exchange_split: "교류전",
  flash: "일반 벙개",
};

/** 달력 칩처럼 좁은 곳에 쓰는 짧은 이름 */
export const KIND_SHORT: Record<GatheringKind, string> = {
  club_regular: "정모",
  club_flash: "오테식 벙개",
  exchange: "교류전",
  exchange_split: "교류전",
  flash: "벙개",
};

/*
 * 일정 종류 색: 오테식 정모 = 초록, 오테식 벙개 = 보라, 교류전 = 파랑, 일반 벙개 = 주황.
 * 캘린더 칩·점, 목록 띠, 배지, 종류 고르기에서 같은 색을 쓴다. (클래스 이름을 그대로 써야 빌드에 남는다)
 */

/** 종류 배지 (중립 바탕용) */
export const KIND_BADGE: Record<GatheringKind, string> = {
  club_regular: "badge-green",
  club_flash: "badge-lav",
  exchange: "badge-blue",
  exchange_split: "badge-blue",
  flash: "badge-orange-soft",
};

/** 종류 색 점·띠 (원색) */
export const KIND_DOT: Record<GatheringKind, string> = {
  club_regular: "bg-house-green",
  club_flash: "bg-house-lav",
  exchange: "bg-house-blue",
  exchange_split: "bg-house-blue",
  flash: "bg-house-orange",
};

/** 캘린더 칸 안의 일정 칩 */
export const KIND_CHIP: Record<GatheringKind, string> = {
  club_regular: "bg-house-green text-ink",
  club_flash: "bg-house-lav text-ink",
  exchange: "bg-house-blue text-ink",
  exchange_split: "bg-house-blue text-ink",
  flash: "bg-house-orange text-ink",
};

/** 종류 선택 버튼에 붙는 한 줄 설명 */
export const KIND_HINT: Record<GatheringKind, string> = {
  club_regular: "회비에서 지출 · 게스트만 참가비",
  club_flash: "회비에서 지출 · 게스트만 참가비",
  exchange: "다른 클럽과 교류 · 회비에서 지출 · 게스트만 참가비",
  exchange_split: "다른 클럽과 교류 · 코트비 + 캔볼값을 참석자끼리 n빵",
  flash: "코트비 + 캔볼값을 참석자끼리 n빵",
};

/** 저장되는 모든 종류 (서버 GatheringKind) */
export const GATHERING_KINDS: GatheringKind[] = [
  "club_regular",
  "club_flash",
  "exchange",
  "exchange_split",
  "flash",
];

/** 화면에 보이는 종류 (교류전은 하나): 종류 고르기·범례·필터 순서 */
export const KIND_ORDER: GatheringKind[] = [
  "club_regular",
  "club_flash",
  "exchange",
  "flash",
];

/** 교류전 정산 방식 고르기 */
export const EXCHANGE_PAY_LABEL: Record<"exchange" | "exchange_split", string> = {
  exchange: "회비에서 지출",
  exchange_split: "참석자끼리 n빵",
};

export const isExchangeKind = (kind: GatheringKind) =>
  kind === "exchange" || kind === "exchange_split";

/** 화면에 보이는 종류로 묶기: n빵 교류전도 교류전 */
export const kindGroup = (kind: GatheringKind): GatheringKind =>
  kind === "exchange_split" ? "exchange" : kind;

/** 회비에서 지출하는 모임 (오테식 정모·벙개, 회비 교류전): 게스트만 참가비, 코트비는 코트요정에게 */
export const isClubKind = (kind: GatheringKind) =>
  kind === "club_regular" || kind === "club_flash" || kind === "exchange";

/** 관리자·임원진만 만들고 임원진이 함께 관리하는 클럽 일정 (오테식 정모·벙개, 교류전) */
export const isStaffKind = (kind: GatheringKind) => kind !== "flash";

/**
 * 오테식 정모·벙개 (교류전 제외): 대진 결과가 레이팅에 들어가 점수가 꼭 필요하고,
 * 회칙 제10조 정원(코트 1면에 6명)을 안내한다. 교류전은 상대 클럽과 겨루고 인원도 상대와 정한다
 */
export const isOtesikKind = (kind: GatheringKind) =>
  kind === "club_regular" || kind === "club_flash";

export const COURT_SURFACES: CourtSurface[] = ["hard", "turf", "clay", "carpet"];

export const COURT_SURFACE_LABEL: Record<CourtSurface, string> = {
  hard: "하드",
  turf: "인조잔디",
  clay: "클레이",
  carpet: "카펫",
};

/** 코트 바닥 색 점: 하드 파랑 · 인조잔디 초록 · 클레이 벽돌색 · 카펫 회색 */
export const COURT_SURFACE_DOT: Record<CourtSurface, string> = {
  hard: "bg-[#2F5BD3]",
  turf: "bg-[#3E8E41]",
  clay: "bg-[#C4562B]",
  carpet: "bg-slate-500",
};

/** 네이버 지도 검색 링크: 주소가 있으면 주소로, 없으면 장소 이름으로. 둘 다 없으면 null */
export function naverMapUrl(g: { address?: string | null; location?: string | null }) {
  const query = g.address?.trim() || g.location?.trim();
  return query ? `https://map.naver.com/p/search/${encodeURIComponent(query)}` : null;
}

/** 게스트(관리자 제외): 일정(홈·캘린더·모임)만 본다. 회원 명단·정산·회칙은 보지 않는다 (서버 User.is_guest) */
export const isGuest = (u: Pick<User, "is_admin" | "member_type">) =>
  !u.is_admin && u.member_type === "guest";

/** 임원진 직함 (서버 OFFICER_TYPES). 모두 임원진 권한이고, 정산은 총무만 한다 */
export const OFFICER_TYPES: MemberType[] = [
  "president",
  "vice_president",
  "advisor",
  "match_director",
  "treasurer",
  "vice_treasurer",
  "officer",
];

export const isOfficer = (u: Pick<User, "member_type">) => OFFICER_TYPES.includes(u.member_type);

/** 관리자·임원진(회장·부회장·고문·경기이사·총무·부총무 포함): 오테식 모임 생성·운영, 대진, 일정 먼저 보기 (서버 User.is_staff) */
export const isStaff = (u: Pick<User, "is_admin" | "member_type">) => u.is_admin || isOfficer(u);

/** 관리자·총무: 정산(오테식 모임 입금 확인, 코트비 지급·지급 내역, 예약자 계좌) (서버 User.can_settle) */
export const canSettle = (u: Pick<User, "is_admin" | "member_type">) =>
  u.is_admin || u.member_type === "treasurer";
