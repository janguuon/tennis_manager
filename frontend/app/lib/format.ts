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
