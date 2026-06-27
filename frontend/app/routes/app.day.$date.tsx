import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { Gathering, GatheringStatus } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "일정 · 테니스 매니저" }];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STATUS_LABEL: Record<GatheringStatus, string> = {
  planned: "예정",
  ongoing: "진행중",
  completed: "완료",
  canceled: "취소",
};
const STATUS_DOT: Record<GatheringStatus, string> = {
  planned: "bg-blue-500",
  ongoing: "bg-court-500",
  completed: "bg-slate-400",
  canceled: "bg-red-400",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const date = params.date as string;
  const gatherings = await api<Gathering[]>(
    `/gatherings?date_from=${date}&date_to=${date}`,
    { token },
  );
  // 시작 시간 순으로 정렬 (시간 미정은 뒤로)
  gatherings.sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  return json({ date, gatherings });
}

export default function DayPage() {
  const { date, gatherings } = useLoaderData<typeof loader>();
  const month = date.slice(0, 7);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {m}월 {d}일 <span className="text-base font-normal text-slate-400">({weekday})</span>
        </h1>
        <Link to={`/app/calendar?month=${month}`} className="btn-ghost px-3 py-1.5 text-sm">
          ← 캘린더
        </Link>
      </div>

      {gatherings.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          이 날 등록된 일정이 없어요.
        </div>
      ) : (
        <div className="space-y-2">
          {gatherings.map((g) => (
            <Link
              key={g.id}
              to={`/app/gatherings/${g.id}?from=${date}`}
              className="card flex items-center justify-between gap-3 transition hover:border-court-300 hover:bg-court-50 dark:hover:bg-slate-700/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[g.status]}`} />
                  <span className="truncate font-semibold">{g.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{STATUS_LABEL[g.status]}</span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-500">
                  {g.start_time ? g.start_time.slice(0, 5) : "시간 미정"}
                  {g.end_time ? `~${g.end_time.slice(0, 5)}` : ""}
                  {g.location ? ` · ${g.location}` : ""}
                  {` · 코트 ${g.court_count}면`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-sm">
                {g.attendance ? (
                  <span className="font-semibold text-court-700 dark:text-court-300">
                    {g.attendance.attending}
                    {g.max_participants ? `/${g.max_participants}` : ""}명
                  </span>
                ) : null}
                <span className="text-slate-300">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
