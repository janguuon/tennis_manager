import { useEffect, useState } from "react";

import { CourtCountInput } from "~/components/CourtCountInput";
import { isExchangeKind, isOtesikKind } from "~/lib/club";
import { SEATS_PER_COURT } from "~/lib/courts";
import type { GatheringKind } from "~/lib/types";

/**
 * 코트 면수 + 정원 칸.
 * - 정원은 면수 × 6명으로 채워 두고, 면수를 바꾸면 따라 바뀐다 (2면 → 12명, 4면 → 24명).
 * - 정원을 직접 고치거나 지우면(제한 없음) 그 뒤로는 따라가지 않는다. 다시 맞추기 버튼으로 돌아간다.
 * - 고치는 화면: 정원이 면수 × 6명 그대로였던 모임만 따라간다 (직접 정한 정원·제한 없음·교류전은 그대로).
 * - 교류전은 상대 클럽과 정한 인원이라 채우지 않는다 (비우면 제한 없음, 서버 엑셀 업로드도 같다).
 * 서버는 화면에서 비워 보낸 정원을 제한 없음으로 둔다.
 */
export function CourtCapacityFields({
  kind,
  numbersId,
  countId,
  capacityId,
  defaultCount = 1,
  defaultCapacity,
}: {
  kind: GatheringKind;
  numbersId: string;
  countId: string;
  capacityId: string;
  defaultCount?: number;
  /** 고치는 화면의 지금 정원 (null = 제한 없음). 새 모임은 비워 둔다. */
  defaultCapacity?: number | null;
}) {
  const isNew = defaultCapacity === undefined;
  const exchange = isExchangeKind(kind);
  const [count, setCount] = useState(defaultCount);
  const [follow, setFollow] = useState(
    isNew || (!exchange && defaultCapacity === defaultCount * SEATS_PER_COURT),
  );
  const [value, setValue] = useState(() => {
    if (!isNew) return defaultCapacity == null ? "" : String(defaultCapacity);
    return exchange ? "" : String(defaultCount * SEATS_PER_COURT);
  });

  const suggested = count >= 1 ? String(count * SEATS_PER_COURT) : "";
  useEffect(() => {
    if (!follow) return;
    // 새 모임에서 교류전을 고르면 비운다 (고치는 화면은 이미 정한 정원을 그대로 둔다)
    if (exchange) {
      if (isNew) setValue("");
    } else if (suggested) setValue(suggested);
  }, [follow, exchange, suggested, isNew]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={countId}>
            코트 면수
          </label>
          <CourtCountInput
            id={countId}
            numbersId={numbersId}
            defaultValue={defaultCount}
            onCountChange={setCount}
          />
        </div>
        <div>
          <label className="label" htmlFor={capacityId}>
            정원
          </label>
          <input
            id={capacityId}
            name="max_participants"
            type="number"
            inputMode="numeric"
            min="1"
            className="input"
            placeholder="제한 없음"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setFollow(false);
            }}
          />
        </div>
      </div>
      <p className="-mt-1 text-xs text-slate-500 dark:text-slate-400">
        {exchange ? (
          "교류전은 상대 클럽과 정한 인원을 적어요. 비우면 제한 없음이에요. "
        ) : (
          <>
            {isOtesikKind(kind) ? "회칙상 코트 1면에 6명이에요. " : "코트 1면에 6명이 기본이에요. "}
            {follow ? (
              "면수를 바꾸면 정원도 따라 바뀌고, 지우면 제한 없음이에요. "
            ) : suggested && value !== suggested ? (
              <>
                <button
                  type="button"
                  className="font-bold text-ink underline underline-offset-2 dark:text-white"
                  onClick={() => setFollow(true)}
                >
                  {suggested}명으로 맞추기
                </button>{" "}
              </>
            ) : null}
          </>
        )}
        정원이 차면 다음 신청은 대기로 받아요.
      </p>
    </>
  );
}
