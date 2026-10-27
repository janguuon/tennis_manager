// 백엔드(FastAPI) 응답과 1:1로 대응하는 타입 정의.

export type Gender = "male" | "female";
export type ApprovalStatus = "pending" | "approved" | "rejected";
/** 회원 구분: 임원진(일정 즉시) · 정회원(전주 금요일 오전 10시) · 게스트(3일 전 0시) */
/** treasurer = 총무(임원진 권한 + 정산) */
export type MemberType = "treasurer" | "officer" | "member" | "guest";
export type MatchType =
  | "singles"
  | "mens_doubles"
  | "womens_doubles"
  | "mixed_doubles"
  | "open_doubles";
/** maybe(미정)는 예전 투표 표시용. waiting = 정원이 차서 대기 중 */
export type AttendanceStatus = "attending" | "absent" | "waiting" | "maybe";
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
  /** 대회 입상 별 개수 (관리자가 정한다): 금 우승 · 은 준우승 · 동 입상 */
  award_gold?: number;
  award_silver?: number;
  award_bronze?: number;
  award_note?: string | null;
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
  /** 프로필 사진 ("/avatars/…", 없으면 이름 첫 글자) */
  avatar_url: string | null;
  /** 이름만 적어 초대한 게스트면 데려온 회원 (가입한 회원은 null) */
  invited_by_id?: number | null;
  invited_by_name?: string | null;
  /** 대회 입상 별 개수 (관리자가 정한다): 금 우승 · 은 준우승 · 동 입상 */
  award_gold?: number;
  award_silver?: number;
  award_bronze?: number;
  award_note?: string | null;
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
  waiting: number;
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
  /** 코트요정: 코트를 잡아 준 사람(들) 이름 */
  court_fairy: string | null;
  /** 코트 주소(선택): 지도 버튼이 장소 이름보다 먼저 쓴다 */
  address: string | null;
  /** 예약자명: 코트에서 말할 예약 이름 (예: "3·5번 장미주, 2번 김다빈") */
  court_reservers: string | null;
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
  /** 일정 공개 시각(정회원·게스트, 한국 시간, 전주 금요일 오전 10시에 다음 주 월~일 일정) */
  member_open_at: string | null;
  /** 게스트 투표 시작 시각(한국 시간, 3일 전 0시. 일정 공개보다 빠르지 않음) */
  guest_vote_open_at: string | null;
  open_to_members: boolean;
  /** 게스트가 지금 참석 투표를 할 수 있는지 */
  guest_vote_open: boolean;
  /** 정해진 공개 시각(전주 금요일 오전 10시) */
  scheduled_open_at?: string | null;
  /** 운영진이 정해진 시각보다 미리 공개해 둔 상태 */
  opened_early?: boolean;
  /** 내가 누른 참석 투표 (참석·대기·불참). 안 눌렀으면 null */
  my_status?: AttendanceStatus | null;
  /** 오테식 모임: 코트 예약 금액 합 (회비 지출) */
  court_total: number;
  /** 캘린더 목록: 참석자 (투표한 순서). 상세에서는 participants 를 쓴다 */
  attendees?: AttendeeBrief[];
  /** 취소된 모임: 사유(우천 취소 등)와 취소한 시각(한국 시간) */
  cancel_reason: string | null;
  canceled_at: string | null;
  /** 취소 정산 금액 (취소돼도 낼 돈): 일반 벙개는 참석자끼리 나눌 총액, 오테식 모임은 게스트 1인. 0이면 없음 */
  cancel_fee: number;
}

/** 캘린더 목록에 보여 줄 참석자 */
export interface AttendeeBrief {
  id: number;
  name: string;
  avatar_url: string | null;
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
  /** 코트비를 받을 회원(코트요정). 엑셀로 올린 코트요정이 회원이 아니면 null */
  booker: UserBrief | null;
  /** 받을 사람 이름: 회원 이름, 또는 엑셀에 적은 이름 */
  booker_name: string;
  /** 회비에서 지급할 금액: 코트비, 코트를 취소했으면 취소 수수료 */
  amount: number;
  /** 원래 코트비 (코트를 취소해도 남는다) */
  court_fee: number;
  /** 코트 취소 (우천 등): 취소 수수료만 지급한다 */
  canceled: boolean;
  canceled_at: string | null;
  cancel_fee: number;
  court_label: string | null;
  reimbursed: boolean;
  reimbursed_at: string | null;
  reimbursed_by: UserBrief | null;
  account: BookerAccount | null;
  /** 모임이 정회원에게 공개됐는지 (공개 전 모임의 코트비는 정산 탭에 올리지 않는다) */
  open_to_members: boolean;
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
  /** 대기에 들어간 시각 (대기 순서) */
  waiting_since: string | null;
  paid: boolean;
  paid_at: string | null;
  /** 입금 처리 당시 금액 (이전 기록은 null) */
  paid_amount: number | null;
  /** 게스트비 면제 (관리자·총무, 오테식 모임 게스트) */
  fee_waived?: boolean;
  /** 면제 사유 (모임 화면에 보인다) */
  fee_waiver_reason?: string | null;
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
  /** 일반 벙개 총액 (취소된 모임은 취소 정산 총액) */
  fee: number;
  per_person: number;
  /** 오테식 모임 게스트 1인 금액 (취소된 모임은 취소 정산 금액) */
  guest_fee: number;
  /** 취소된 모임의 사유 */
  cancel_reason?: string | null;
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
  team1_score: number | null;
  team2_score: number | null;
  /** 관리자에게만 온다: 두 팀 레이팅과 팀1 기대 득점률(친 경기는 경기 직전 값) */
  balance: DrawBalance | null;
  /** 자리별 회원 id [팀1 1번, 팀1 2번, 팀2 1번, 팀2 2번] (빈자리 null) */
  slot_ids: (number | null)[];
}

export type Tier = "A" | "B" | "C" | "D" | "E";

export interface DrawBalance {
  team1_rating: number;
  team2_rating: number;
  expected_team1: number;
  tiers: Record<string, Tier>;
}

/** 내부 레이팅 · 티어 (관리자 전용) */
export interface RatingRow {
  user: UserBrief;
  rating: number;
  tier: Tier;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  provisional: boolean;
  placement_left: number;
  peak: number;
  last_played: string | null;
  last_change: number;
}

export interface RatingBoard {
  rows: RatingRow[];
  counted_matches: number;
  tier_counts: Record<Tier, number>;
  config: {
    base: number;
    k_placement: number;
    k_regular: number;
    placement_games: number;
    hysteresis: number;
    tier_floors: Record<string, number>;
  };
}

export interface RatingEvent {
  match_id: number;
  played_at: string;
  gathering_id: number | null;
  gathering_title: string | null;
  partners: UserBrief[];
  opponents: UserBrief[];
  games_for: number;
  games_against: number;
  outcome: "win" | "loss" | "draw";
  expected: number;
  actual: number;
  delta: number;
  rating_after: number;
  tier_after: Tier;
}

export interface RatingHistory {
  row: RatingRow;
  events: RatingEvent[];
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
  open_doubles: "잡복",
};

/** 모임 통장: 오테식 모임 게스트비를 받는 클럽 공용 계좌 (GET/PUT /club/account) */
export type ClubAccount = {
  bank: string | null;
  account_number: string;
  account_holder: string | null;
};

/** 클럽 소식 (운영진이 올리는 축하·소식) */
export type NoticeKind = "celebrate" | "news";
export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  body: string | null;
  show_until: string | null;
  created_at: string;
  author_name: string | null;
  is_new: boolean;
}
