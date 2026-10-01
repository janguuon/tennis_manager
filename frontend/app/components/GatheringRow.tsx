import { Link } from "@remix-run/react";
import { ChevronRight, MapPin, Users } from "lucide-react";

import { won } from "~/lib/format";
import { GATHERING_STATUS_BADGE, GATHERING_STATUS_LABEL } from "~/lib/status";
import type { Gathering } from "~/lib/types";

/** 일정 목록의 한 줄 (캘린더 리스트 보기, 일자별 목록에서 공용). 카드 안에 divide-y로 쌓아 쓴다. */
export function GatheringRow({ g, to }: { g: Gathering; to: string }) {
  const start = g.start_time?.slice(0, 5);
  const end = g.end_time?.slice(0, 5);
  const muted = g.status === "completed" || g.status === "canceled";
  // 좁은 화면에서 잘리므로 회원에게 중요한 금액을 코트보다 앞에 둔다
  const meta = [
    g.fee > 0 && g.per_person > 0 ? `1인 ${won(g.per_person)}` : g.fee > 0 ? `총 ${won(g.fee)}` : "",
    `코트 ${g.court_numbers ? g.court_numbers : `${g.court_count}면`}`,
  ].filter(Boolean);

  return (
    <Link
      to={to}
      className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-5"
    >
      <div className="w-11 shrink-0 text-center">
        <div className={`text-[15px] font-bold ${muted ? "text-slate-400" : "text-slate-900 dark:text-white"}`}>
          {start ?? "미정"}
        </div>
        {end ? <div className="text-xs text-slate-400">{end}</div> : null}
      </div>
      <div className="min-w-0 flex-1 border-l border-slate-100 pl-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span
            className={`truncate font-semibold ${
              g.status === "canceled" ? "text-slate-400 line-through" : "text-slate-900 dark:text-white"
            }`}
          >
            {g.title}
          </span>
          {g.status !== "planned" ? (
            <span className={GATHERING_STATUS_BADGE[g.status]}>{GATHERING_STATUS_LABEL[g.status]}</span>
          ) : null}
        </div>
        <p className="mt-1 flex items-center gap-1 truncate text-[13px] text-slate-500 dark:text-slate-400">
          <MapPin size={13} className="shrink-0" />
          <span className="truncate">
            {g.location ?? "장소 미정"}
            {meta.map((m) => ` · ${m}`).join("")}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
        <Users size={14} />
        {g.attendance?.attending ?? 0}
        {g.max_participants ? `/${g.max_participants}` : ""}
        <ChevronRight size={16} className="ml-1 text-slate-300 dark:text-slate-600" />
      </div>
    </Link>
  );
}
