// 백엔드(FastAPI) 응답과 1:1로 대응하는 타입 정의.

export type Gender = "male" | "female";
export type ApprovalStatus = "pending" | "approved" | "rejected";
/** 회원 구분: 임원진(일정 즉시) · 정회원(그 주 월요일 0시) · 게스트(3일 전 0시) */
export type MemberType = "officer" | "member" | "guest";
export type MatchType =
  | "singles"
  | "mens_doubles"
  | "womens_doubles"
  | "mixed_doubles";
export type AttendanceStatus = "attending" | "absent" | "maybe";
export type GatheringStatus = "planned" | "ongoing" | "completed" | "canceled";
/** 모임 종류: 오테식 정모 / 오테식 벙개 (회비 지출) / 일반 벙개 (n빵) */
export type GatheringKind = "club_regular" | "club_flash" | "flash";

export interface User {
  id: number;
  username: string;
  email: string | null;
  name: string;
  nickname: string | null;
  gender: Gender | null;
  ntrp: number | null;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  approval_status: ApprovalStatus;
  is_active: boolean;
  is_admin: boolean;
  member_type: MemberType;
  created_at: string;
}

/** 내 프로필 (/users/me): 본인에게만 보이는 환급 계좌 포함 */
export interface Me extends User {
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
}

export interface UserBrief {
  id: number;
  username: string;
  name: string;
  nickname: string | null;
  gender: Gender | null;
  ntrp: number | null;
  member_type: MemberType;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface SignupResponse {
  user: User;
  message: string;
}

export interface RecordStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  win_rate: number;
}

export interface RankingEntry {
  rank: number;
  user: UserBrief;
  record: RecordStats;
}

export interface AttendanceSummary {
  attending: number;
  absent: number;
  maybe: number;
  total: number;
}

export interface Gathering {
  id: number;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  court_count: number;
  court_numbers: string | null;
  max_participants: number | null;
  kind: GatheringKind;
  /** 일반 벙개: n빵할 총액 (= 코트비 + 캔볼값). 오테식 모임은 0. */
  fee: number;
  court_fee: number;
  ball_fee: number;
  /** 오테식 모임: 게스트 1인 참가비 */
  guest_fee: number;
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
  status: GatheringStatus;
  created_by: number;
  created_at: string;
  attendance: AttendanceSummary | null;
  /** 1인 참가비 (총액 ÷ 참석 인원, 100원 단위 올림). 서버가 계산. 오테식 모임은 0. */
  per_person: number;
  /** 정회원 공개 시각(한국 시간, 그 주 월요일 0시) */
  member_open_at: string | null;
  /** 게스트 공개 시각(한국 시간, 3일 전 0시) */
  guest_open_at: string | null;
  open_to_members: boolean;
  open_to_guests: boolean;
  /** 오테식 모임: 코트 예약 금액 합 (회비 지출) */
  court_total: number;
}

/** 예약자 계좌 (본인과 관리자·임원진에게만 채워짐) */
export interface BookerAccount {
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
}

/** 오테식 모임의 코트 예약 1건: 예약자가 낸 코트비를 회비에서 돌려준다 */
export interface CourtBooking {
  id: number;
  gathering_id: number;
  gathering_title: string;
  event_date: string;
  kind: GatheringKind;
  booker: UserBrief;
  amount: number;
  court_label: string | null;
  reimbursed: boolean;
  reimbursed_at: string | null;
  reimbursed_by: UserBrief | null;
  account: BookerAccount | null;
}

export interface TypeRecord {
  match_type: MatchType;
  record: RecordStats;
}

export interface PlayerStats {
  user: UserBrief;
  overall: RecordStats;
  by_type: TypeRecord[];
}

export interface PartnerStat {
  partner: UserBrief;
  record: RecordStats;
}

export interface OpponentStat {
  opponent: UserBrief;
  record: RecordStats;
}

export interface Participant {
  user: UserBrief;
  status: AttendanceStatus;
  voted_at: string;
  paid: boolean;
  paid_at: string | null;
  /** 입금 처리 당시 금액 (이전 기록은 null) */
  paid_amount: number | null;
}

export interface GatheringDetail extends Gathering {
  participants: Participant[];
  /** 참가비 정산 내역 (받을 돈이 있는 모임만). 금액은 모두 서버 계산값. */
  payment: GatheringPaymentSummary | null;
  /** 오테식 모임의 코트 예약 내역 */
  court_bookings: CourtBooking[];
}

/** 사람별 금액 한 줄 (받을 돈 / 돌려줄 돈) */
export interface PaymentLine {
  user: UserBrief;
  amount: number;
}

export interface GatheringPaymentSummary {
  id: number;
  title: string;
  event_date: string;
  status: GatheringStatus;
  kind: GatheringKind;
  fee: number;
  per_person: number;
  guest_fee: number;
  attending: number;
  /** 낼 돈이 있는 참석자 수 (일반 벙개: 참석자 전원, 오테식 모임: 게스트) */
  payer_count: number;
  paid_count: number;
  collected: number;
  expected: number;
  outstanding: number;
  /** 받을 돈: 미입금 + 추가 입금(차액) */
  dues: PaymentLine[];
  /** 돌려줄 돈: 입금 후 불참 + 초과 입금(차액) */
  refunds: PaymentLine[];
}

export interface MonthlyPaymentSummary {
  month: string;
  total_expected: number;
  total_collected: number;
  total_outstanding: number;
  total_refund: number;
  gatherings: GatheringPaymentSummary[];
  /** 오테식 모임 코트비 (회비 지출) */
  court_total: number;
  court_reimbursed: number;
  court_pending: number;
  court_bookings: CourtBooking[];
}

/** 내가 아직 내야 할 참가비 */
export interface MyPaymentDue {
  gathering_id: number;
  title: string;
  event_date: string;
  kind: GatheringKind;
  amount: number;
  /** 1인 금액 (오테식 모임 게스트는 게스트비) */
  per_person: number;
  /** 이미 일부 입금했고 차액만 남음 */
  partial: boolean;
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
}

export interface DrawMatch {
  id: number;
  court_number: number | null;
  round_number: number | null;
  match_type: MatchType;
  team1: UserBrief[];
  team2: UserBrief[];
  result_match_id: number | null;
}

export interface Draw {
  id: number;
  gathering_id: number;
  name: string | null;
  generation_method: string;
  created_at: string;
  matches: DrawMatch[];
}

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  singles: "단식",
  mens_doubles: "남복",
  womens_doubles: "여복",
  mixed_doubles: "혼복",
};
