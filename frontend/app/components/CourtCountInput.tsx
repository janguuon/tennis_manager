import { useEffect, useState } from "react";

import { courtLabels } from "~/lib/courts";

/**
 * 코트 면수 칸. 코트 번호를 적으면 그 개수로 정해지므로(서버도 같다) 번호 수를 보여 주고 잠근다.
 * 코트 번호 칸(numbersId)을 비우면 직접 적는다. "1~4"처럼 범위로 적어도 4면.
 * onCountChange: 지금 면수(번호로 정해진 수 또는 직접 적은 수, 비면 0)를 알려 준다.
 */
export function CourtCountInput({
  id,
  numbersId,
  defaultValue = 1,
  onCountChange,
}: {
  id: string;
  numbersId: string;
  defaultValue?: number;
  onCountChange?: (count: number) => void;
}) {
  const [fromNumbers, setFromNumbers] = useState(0);
  const [manual, setManual] = useState(defaultValue);
  useEffect(() => {
    const el = document.getElementById(numbersId) as HTMLInputElement | null;
    if (!el) return;
    const sync = () => setFromNumbers(courtLabels(el.value).length);
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, [numbersId]);

  const count = fromNumbers || manual;
  useEffect(() => onCountChange?.(count), [count, onCountChange]);

  return (
    <>
      <input
        // 번호로 정해질 때와 직접 적을 때를 바꾸면 칸을 새로 그린다 (controlled ↔ uncontrolled)
        key={fromNumbers ? "auto" : "manual"}
        id={id}
        name="court_count"
        type="number"
        inputMode="numeric"
        min="1"
        className={`input ${fromNumbers ? "bg-slate-100 dark:bg-slate-800" : ""}`}
        {...(fromNumbers
          ? { value: fromNumbers, readOnly: true, "aria-describedby": `${id}_hint` }
          : {
              // 번호를 지워 직접 적기로 돌아오면 마지막으로 적은 면수
              defaultValue: manual || "",
              onChange: (e) => setManual(Number(e.target.value) || 0),
            })}
      />
      {fromNumbers ? (
        <p id={`${id}_hint`} className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          코트 번호 {fromNumbers}개로 정해져요.
        </p>
      ) : null}
    </>
  );
}
