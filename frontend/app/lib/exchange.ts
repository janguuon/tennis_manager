// 교류전 화면 공통 (서버 app/exchange.py, routers/exchanges.py)

import { courtLabels } from "~/lib/courts";
import type { ExchangeResult, ExchangeSummary } from "~/lib/types";

export const OURS_LABEL = "오테식";

/** 상대 클럽 이름 (비어 있으면 '상대 클럽') */
export function opponentLabel(x: Pick<ExchangeSummary, "opponent_name">) {
  return x.opponent_name || "상대 클럽";
}

export function resultLabel(winner: ExchangeResult, opponent: string) {
  return winner === "ours" ? `${OURS_LABEL} 승리` : winner === "theirs" ? `${opponent} 승리` : "무승부";
}

/** 대진 코트 순번 → 일정 코트 번호 ("3, 5" 의 2번째 → "5번 코트"), 번호가 모자라면 "3코트" */
export function courtName(courtNumbers: string | null, court: number) {
  const labels = courtLabels(courtNumbers);
  const label = labels[court - 1];
  return label ? `${label}번 코트` : `${court}코트`;
}

/** 목록·카드에 쓰는 상태: 취소 · 결과 · 진행 중 · 대진 전 */
export function exchangeStatus(x: ExchangeSummary): { label: string; badge: string } {
  if (x.canceled) return { label: "취소", badge: "badge-gray" };
  if (x.winner) return { label: resultLabel(x.winner, opponentLabel(x)), badge: x.winner === "theirs" ? "badge-gray" : "badge-yellow" };
  if (x.played > 0) return { label: "진행 중", badge: "badge-orange" };
  if (x.total > 0) return { label: "대진 완료", badge: "badge-blue" };
  return { label: "대진 전", badge: "badge-gray" };
}

/** 지난 교류전으로 볼지: 마쳤거나 취소됐거나 날짜가 지났다 */
export function isPastExchange(x: ExchangeSummary, today: string) {
  return !!x.winner || x.canceled || x.event_date < today;
}
