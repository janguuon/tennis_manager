import { Link } from "@remix-run/react";
import { ArrowUpRight, Users } from "lucide-react";

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
    g.location ?? "장소 미정",
    g.fee > 0 && g.per_person > 0 ? `1인 ${won(g.per_person)}` : g.fee > 0 ? `총 ${won(g.fee)}` : "",
    `코트 ${g.court_numbers ? g.court_numbers : `${g.court_count}면`}`,
  ].filter(Boolean);

  return (
    <Link
      to={to}
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white dark:hover:bg-slate-800/60 sm:px-6"
    >
      <div className="w-12 shrink-0">
        <div
          className={`font-display text-[17px] font-extrabold tracking-[-0.03em] ${
            muted ? "text-slate-400" : "text-ink dark:text-white"
          }`}
        >
          {start ?? "미정"}
        </div>
        {end ? <div className="text-xs font-semibold text-slate-400">{end}</div> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[15px] font-bold ${
              g.status === "canceled" ? "text-slate-400 line-through" : "text-ink dark:text-white"
            }`}
          >
            {g.title}
          </span>
          {g.status !== "planned" ? (
            <span className={GATHERING_STATUS_BADGE[g.status]}>{GATHERING_STATUS_LABEL[g.status]}</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[13px] font-medium text-slate-500 dark:text-slate-400">{meta.join(" · ")}</p>
      </div>
      <span className="badge-line shrink-0">
        <Users size={12} />
        {g.attendance?.attending ?? 0}
        {g.max_participants ? `/${g.max_participants}` : ""}
      </span>
      <ArrowUpRight size={16} className="hidden shrink-0 text-slate-400 transition-colors group-hover:text-ink dark:group-hover:text-white sm:block" />
    </Link>
  );
}
