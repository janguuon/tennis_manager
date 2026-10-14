import { Lock, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FieldGroup } from "~/components/Modal";
import {
  KIND_DOT,
  KIND_HINT,
  KIND_LABEL,
  KIND_ORDER,
  isClubKind,
} from "~/lib/club";
import { won } from "~/lib/format";
import type { GatheringKind, UserBrief } from "~/lib/types";

export type AccountDefaults = {
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
};

export type FeeDefaults = {
  kind: GatheringKind;
  court_fee: number;
  ball_fee: number;
  guest_fee: number;
  /** 입금 계좌 기본값: 일반 벙개(받는 사람 계좌) / 오테식 모임(회비 통장) */
  accounts: { flash: AccountDefaults; club: AccountDefaults };
};

type BookingRow = {
  key: number;
  booker: string;
  label: string;
  amount: string;
};

/**
 * 일정 등록·수정 폼의 "종류 · 정산" 칸.
 * - 일반 벙개: 코트비 + 캔볼값 (참석자 n빵), 입금 받을 계좌
 * - 오테식 정모·벙개: 게스트비, 게스트비 입금 계좌(회비 통장), 코트 예약자(등록할 때)
 *
 * members를 주면 코트 예약 줄을 함께 입력받는다(등록). 수정할 때는 모임 화면에서 관리한다.
 * children: 종류 선택과 금액 칸 사이에 들어갈 칸(날짜·코트 등). 고른 종류를 받는다.
 */
export function GatheringFeeFields({
  idPrefix,
  defaults,
  canCreateClub,
  lockedKinds = {},
  members,
  children,
}: {
  idPrefix: string;
  defaults: FeeDefaults;
  canCreateClub: boolean;
  /** 고를 수 없는 종류와 그 이유 */
  lockedKinds?: Partial<Record<GatheringKind, string>>;
  members?: UserBrief[];
  children?: (kind: GatheringKind) => ReactNode;
}) {
  const [kind, setKind] = useState<GatheringKind>(defaults.kind);
  const [courtFee, setCourtFee] = useState(String(defaults.court_fee || ""));
  const [ballFee, setBallFee] = useState(String(defaults.ball_fee || ""));
  const [rows, setRows] = useState<BookingRow[]>([]);
  const club = isClubKind(kind);
  const total = (Number(courtFee) || 0) + (Number(ballFee) || 0);
  const account = club ? defaults.accounts.club : defaults.accounts.flash;
  const bookingTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const id = (name: string) => `${idPrefix}${name}`;

  const lockReason = (k: GatheringKind) =>
    lockedKinds[k] ??
    (isClubKind(k) && !canCreateClub ? "관리자·임원진만" : undefined);

  const updateRow = (key: number, patch: Partial<BookingRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <FieldGroup title="모임 종류">
        <div className="kind-options" role="radiogroup" aria-label="모임 종류">
          {KIND_ORDER.map((k) => {
            const locked = k !== kind ? lockReason(k) : undefined;
            return (
              <label
                key={k}
                className={`kind-option kind-option-${k} ${
                  k === kind ? "is-selected" : ""
                } ${locked ? "is-locked" : ""}`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={k === kind}
                  disabled={Boolean(locked)}
                  onChange={() => setKind(k)}
                  className="sr-only"
                />
                <i aria-hidden="true" className={KIND_DOT[k]} />
                <strong>{KIND_LABEL[k]}</strong>
                {locked ? (
                  <small>
                    <Lock size={10} />
                    {locked}
                  </small>
                ) : null}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {KIND_HINT[kind]}
        </p>
      </FieldGroup>

      {children?.(kind)}

      {club ? (
        <FieldGroup title="회비 지출 · 게스트비">
          <p className="rounded-2xl bg-house-green/20 px-4 py-3 text-[13px] font-medium leading-relaxed">
            회비에서 지출해요. 임원진·정회원은 따로 낼 돈이 없고,{" "}
            <strong>게스트만 게스트비</strong>를 내요.
          </p>
          <div>
            <label className="label" htmlFor={id("guest_fee")}>
              게스트비 (원)
            </label>
            <input
              id={id("guest_fee")}
              name="guest_fee"
              type="number"
              min="0"
              step="100"
              className="input"
              defaultValue={defaults.guest_fee}
            />
          </div>
        </FieldGroup>
      ) : (
        <FieldGroup title="참가비 (n빵)">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={id("court_fee")}>
                코트비 (원)
              </label>
              <input
                id={id("court_fee")}
                name="court_fee"
                type="number"
                min="0"
                step="100"
                className="input"
                placeholder="0"
                value={courtFee}
                onChange={(e) => setCourtFee(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={id("ball_fee")}>
                캔볼값 (원)
              </label>
              <input
                id={id("ball_fee")}
                name="ball_fee"
                type="number"
                min="0"
                step="100"
                className="input"
                placeholder="0"
                value={ballFee}
                onChange={(e) => setBallFee(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {total > 0 ? (
              <>
                총{" "}
                <strong className="text-ink dark:text-white">
                  {won(total)}
                </strong>
                을 참석 인원으로 나눠요 (100원 단위 올림).
              </>
            ) : (
              "0원이면 무료 모임이에요."
            )}
          </p>
        </FieldGroup>
      )}

      {/* 종류를 바꾸면 그 종류의 기본 계좌로 다시 채운다 */}
      <FieldGroup
        key={club ? "club" : "flash"}
        title={club ? "게스트비 입금 계좌 (회비 통장)" : "입금 받을 계좌"}
      >
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor={id("bank")}>
              은행
            </label>
            <input
              id={id("bank")}
              name="bank"
              className="input"
              placeholder="국민"
              defaultValue={account.bank ?? ""}
            />
          </div>
          <div className="col-span-3">
            <label className="label" htmlFor={id("account_number")}>
              계좌번호
            </label>
            <input
              id={id("account_number")}
              name="account_number"
              className="input"
              placeholder="123-456-7890"
              defaultValue={account.account_number ?? ""}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor={id("account_holder")}>
            예금주
          </label>
          <input
            id={id("account_holder")}
            name="account_holder"
            className="input"
            placeholder="홍길동"
            defaultValue={account.account_holder ?? ""}
          />
        </div>
        {club ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            비워 두면 클럽 관리에서 정한 모임 통장이 들어가요.
          </p>
        ) : null}
      </FieldGroup>

      {club ? (
        <FieldGroup title="코트요정 · 코트비">
          {members ? (
            <>
              {rows.map((r, i) => (
                <div key={r.key} className="booking-row">
                  <select
                    name="booking_booker"
                    className="input col-span-2 col-start-1 row-start-1 sm:col-span-1"
                    aria-label={`${i + 1}번째 코트요정`}
                    value={r.booker}
                    onChange={(e) =>
                      updateRow(r.key, { booker: e.target.value })
                    }
                    required
                  >
                    <option value="">코트요정</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="booking_label"
                    className="input row-start-2 sm:row-start-1"
                    placeholder="코트 (예: 3번)"
                    aria-label={`${i + 1}번째 코트`}
                    value={r.label}
                    onChange={(e) =>
                      updateRow(r.key, { label: e.target.value })
                    }
                  />
                  <input
                    name="booking_amount"
                    type="number"
                    min="100"
                    step="100"
                    className="input row-start-2 sm:row-start-1"
                    placeholder="코트비"
                    aria-label={`${i + 1}번째 코트비`}
                    value={r.amount}
                    onChange={(e) =>
                      updateRow(r.key, { amount: e.target.value })
                    }
                    required
                  />
                  <button
                    type="button"
                    className="icon-btn col-start-3 row-start-1 self-center sm:col-start-4"
                    aria-label={`${i + 1}번째 코트요정 빼기`}
                    onClick={() =>
                      setRows((rs) => rs.filter((x) => x.key !== r.key))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm w-full"
                onClick={() =>
                  setRows((rs) => [
                    ...rs,
                    { key: Date.now(), booker: "", label: "", amount: "" },
                  ])
                }
              >
                <Plus size={14} />
                코트요정 추가
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {rows.length
                  ? `회비 지출 코트비 총 ${won(bookingTotal)} · `
                  : ""}
                코트를 잡고 코트비를 낸 회원이에요. 정산 탭에 올라가 총무가
                회비에서 코트비를 보내요. 모임 화면에서도 추가할 수 있어요.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              코트요정은 모임 화면의 ‘회비 지출’ 카드에서 추가·지급 처리해요.
            </p>
          )}
        </FieldGroup>
      ) : null}
    </>
  );
}
