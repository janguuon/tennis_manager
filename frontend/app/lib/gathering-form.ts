// 일정 등록·수정 폼 → API 요청 본문 (종류·금액·계좌·코트 예약)
import { GATHERING_KINDS, hasEntryFee, isClubKind } from "~/lib/club";
import type { GatheringKind } from "~/lib/types";

/** 종류와 금액 칸. 일반 벙개의 n빵 총액(fee)은 코트비 + 캔볼값. 교류전(참가비)은 1인 참가비(entry_fee). */
export function feeFieldsFromForm(formData: FormData) {
  const num = (k: string) => {
    const v = formData.get(k);
    return v ? Number(v) : 0;
  };
  const text = (k: string) => {
    const v = formData.get(k);
    return v ? String(v).trim() || null : null;
  };
  const raw = String(formData.get("kind") ?? "");
  const kind: GatheringKind = GATHERING_KINDS.includes(raw as GatheringKind)
    ? (raw as GatheringKind)
    : "flash";
  const court_fee = num("court_fee");
  const ball_fee = num("ball_fee");
  return {
    kind,
    court_fee,
    ball_fee,
    fee: isClubKind(kind) || hasEntryFee(kind) ? 0 : court_fee + ball_fee,
    guest_fee: num("guest_fee"),
    entry_fee: hasEntryFee(kind) ? num("entry_fee") : 0,
    bank: text("bank"),
    account_number: text("account_number"),
    account_holder: text("account_holder"),
  };
}

/** 코트 예약 줄 (예약자·코트·금액). 예약자나 금액이 빈 줄은 뺀다. */
export function bookingsFromForm(formData: FormData) {
  const bookers = formData.getAll("booking_booker");
  const labels = formData.getAll("booking_label");
  const amounts = formData.getAll("booking_amount");
  return bookers
    .map((booker, i) => ({
      booker_id: Number(booker),
      court_label: String(labels[i] ?? "").trim() || null,
      amount: Number(amounts[i] || 0),
    }))
    .filter((b) => b.booker_id > 0 && b.amount > 0);
}
