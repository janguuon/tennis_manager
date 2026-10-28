import { useState } from "react";

import { COURT_SURFACES, COURT_SURFACE_DOT, COURT_SURFACE_LABEL } from "~/lib/club";
import type { CourtSurface } from "~/lib/types";

/** 코트 바닥 고르기 (일정 등록·수정). 고르면 같은 장소의 다른 일정에도 들어간다 (서버) */
export function CourtSurfaceField({
  defaultValue,
  hint,
}: {
  defaultValue?: CourtSurface | null;
  hint: string;
}) {
  const [value, setValue] = useState<CourtSurface | "">(defaultValue ?? "");
  return (
    <fieldset>
      <legend className="label">코트 바닥</legend>
      <div className="flex flex-wrap gap-2">
        {(["", ...COURT_SURFACES] as const).map((s) => (
          <label key={s || "none"} className={`surface-option ${value === s ? "is-selected" : ""}`}>
            <input
              type="radio"
              name="court_surface"
              value={s}
              checked={value === s}
              onChange={() => setValue(s)}
              className="sr-only"
            />
            {s ? <i aria-hidden="true" className={COURT_SURFACE_DOT[s]} /> : null}
            {s ? COURT_SURFACE_LABEL[s] : "모름"}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </fieldset>
  );
}

/** 코트 바닥 표시 (색 점 + 이름). 모임 화면 머리 타일 안에 쓴다 */
export function CourtSurfaceTag({ surface }: { surface: CourtSurface }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/45 px-2 py-0.5 text-[11px] font-bold">
      <i aria-hidden="true" className={`h-2 w-2 rounded-full ${COURT_SURFACE_DOT[surface]}`} />
      {COURT_SURFACE_LABEL[surface]} 코트
    </span>
  );
}
