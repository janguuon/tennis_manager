// 화면 표기용 포맷터 (서버·클라이언트 공용)

/** 13400 → "13,400원" */
export const won = (n: number) => `${n.toLocaleString()}원`;

/** "국민 123-456-7890 (홍길동)" — 계좌번호가 없으면 빈 문자열 */
export function accountText(a: {
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
}): string {
  if (!a.account_number) return "";
  return `${a.bank ? `${a.bank} ` : ""}${a.account_number}${a.account_holder ? ` (${a.account_holder})` : ""}`;
}

/** 전화 걸기 링크: "010-1234-5678" → "tel:01012345678" */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** 오늘 날짜 "YYYY-MM-DD" (서버가 어느 시간대에 있든 한국 기준) */
export function todayKST(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

/** "2026-10-31" → "10월 31일(토)" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${wd})`;
}
