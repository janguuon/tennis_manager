import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { GatheringRow } from "~/components/GatheringRow";
import { BackLink, EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import { WEEKDAYS } from "~/lib/status";
import { useSwipeNav } from "~/lib/swipe";
import type { Gathering } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "일정 · 오테식 매니저" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const date = params.date as string;
  const gatherings = await api<Gathering[]>(
    `/gatherings?date_from=${date}&date_to=${date}`,
    { token }
  );
  // 시작 시간 순으로 정렬 (시간 미정은 뒤로)
  gatherings.sort((a, b) =>
    (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
  );
  return json({ date, gatherings });
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DayPage() {
  const { date, gatherings } = useLoaderData<typeof loader>();
  const month = date.slice(0, 7);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  // 전날·다음 날: 화살표 버튼, 휴대폰은 좌우로 밀어서
  const prevDay = `/app/day/${shiftDay(date, -1)}`;
  const nextDay = `/app/day/${shiftDay(date, 1)}`;
  const swipeRef = useSwipeNav(prevDay, nextDay);

  return (
    <PageBody bodyRef={swipeRef}>
      <PageHeader
        eyebrow="A DAY ON COURT."
        back={<BackLink to={`/app/calendar?month=${month}`}>캘린더</BackLink>}
        title={
          <>
            {m}월 {d}일 <span className="text-slate-400">{weekday}요일</span>
          </>
        }
        sub={
          gatherings.length > 0
            ? `일정 ${gatherings.length}개`
            : "등록된 일정이 없어요"
        }
        actions={
          <>
            <Link to={prevDay} className="icon-btn" aria-label="전날">
              <ChevronLeft size={20} />
            </Link>
            <Link to={nextDay} className="icon-btn" aria-label="다음 날">
              <ChevronRight size={20} />
            </Link>
          </>
        }
      />

      {gatherings.length === 0 ? (
        <EmptyCard icon={<CalendarDays size={28} />}>
          이 날 등록된 일정이 없어요.
        </EmptyCard>
      ) : (
        <ul className="card divide-y divide-slate-200/70 overflow-hidden !p-0 dark:divide-slate-800">
          {gatherings.map((g) => (
            <li key={g.id}>
              <GatheringRow g={g} to={`/app/gatherings/${g.id}?from=${date}`} />
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}
