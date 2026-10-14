/**
 * 화면 기능 켜고 끄기. 데이터·API 는 그대로 두고 화면에서만 숨긴다.
 * - ranking: 랭킹(우리의 기록) 메뉴, /app/ranking, 홈의 승률 TOP 3 카드. 아직 쓰지 않아 숨김.
 */
export const FEATURES = {
  ranking: false,
} as const;

/**
 * 승률·전적(홈 MY RECORD, 회원 페이지의 승률·종목별·파트너별·상대별)은 당분간 관리자만 본다.
 * 임원진도 볼 수 없다. 서버도 /stats·/matches 조회를 관리자에게만 연다.
 */
export function canSeeRecords(user: { is_admin: boolean }) {
  return user.is_admin;
}
