import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowLeft, CalendarDays } from "lucide-react";

import { GatheringRow } from "~/components/GatheringRow";
import { HeroHeader, PageBody, PageHero } from "~/components/Page";
import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import { WEEKDAYS } from "~/lib/status";
import type { Gathering } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "일정 · 오테식 매니저" }];

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
    <>
      <PageHero>
        <Link to={`/app/calendar?month=${month}`} className="back-link-hero">
          <ArrowLeft size={16} />
          캘린더
        </Link>
        <HeroHeader
          title={
            <>
              {m}월 {d}일 <span className="font-medium text-white/60">{weekday}요일</span>
            </>
          }
          sub={gatherings.length > 0 ? `일정 ${gatherings.length}개` : "등록된 일정이 없어요"}
        />
      </PageHero>

      <PageBody>
        {gatherings.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-14 text-center">
            <CalendarDays size={28} className="text-slate-300" />
            <p className="text-sm text-slate-500">이 날 등록된 일정이 없어요.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-slate-100 overflow-hidden !p-0 dark:divide-slate-800">
            {gatherings.map((g) => (
              <li key={g.id}>
                <GatheringRow g={g} to={`/app/gatherings/${g.id}?from=${date}`} />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
