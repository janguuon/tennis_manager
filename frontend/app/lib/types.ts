// 백엔드(FastAPI) 응답과 1:1로 대응하는 타입 정의.

export type Gender = "male" | "female";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type MatchType =
  | "singles"
  | "mens_doubles"
  | "womens_doubles"
  | "mixed_doubles";
export type AttendanceStatus = "attending" | "absent" | "maybe";
export type GatheringStatus = "planned" | "ongoing" | "completed" | "canceled";

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
  created_at: string;
}

export interface UserBrief {
  id: number;
  username: string;
  name: string;
  nickname: string | null;
  gender: Gender | null;
  ntrp: number | null;
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
  fee: number;
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
  status: GatheringStatus;
  created_by: number;
  created_at: string;
  attendance: AttendanceSummary | null;
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
}

export interface GatheringDetail extends Gathering {
  participants: Participant[];
}

export interface GatheringPaymentSummary {
  id: number;
  title: string;
  event_date: string;
  fee: number;
  attending: number;
  paid_count: number;
  unpaid_count: number;
  collected: number;
  expected: number;
  unpaid_members: UserBrief[];
}

export interface MonthlyPaymentSummary {
  month: string;
  total_expected: number;
  total_collected: number;
  total_unpaid: number;
  gatherings: GatheringPaymentSummary[];
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
