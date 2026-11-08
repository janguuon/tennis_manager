import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { BackLink, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { KIND_BADGE, KIND_DOT, KIND_ORDER, kindGroup } from "~/lib/club";
import { todayKST } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import { MEMBER_TYPE_LABEL, WEEKDAYS } from "~/lib/status";
import type {
  AttendanceReport,
  AttendanceReportGathering,
  AttendanceReportRow,
  GatheringKind,
} from "~/lib/types";

/**
 * 참석 현황 (/app/admin/attendance, 관리자): 회원마다 그 달(?month=YYYY-MM) 또는 그 해(?year=YYYY)에
 * 참석한 모임 수와 어떤 모임에 갔는지. 연간은 회원마다 1~12월 횟수를 한 줄로 보여 준다.
 * 취소된 모임과 대기·불참은 세지 않는다. 오늘 뒤 모임은 '예정'으로 따로 보여 준다.
 */
export const meta: MetaFunction = () => [{ title: "참석 현황 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const params = new URL(request.url).searchParams;
  const thisMonth = todayKST().slice(0, 7);
  const year = params.get("year") ?? "";
  const month = params.get("month") ?? "";
  const query = /^\d{4}$/.test(year)
    ? `year=${year}`
    : `month=${/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : thisMonth}`;
  try {
    const data = await api<AttendanceReport>(`/admin/attendance?${query}`, { token });
    return json({ data, thisMonth });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw redirect("/app");
    throw err;
  }
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "11/1(일) 10:00" */
function when(g: AttendanceReportGathering) {
  const [y, m, d] = g.event_date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})${g.start_time ? ` ${g.start_time.slice(0, 5)}` : ""}`;
}

type Filter = "all" | GatheringKind;

/** 여기선 일반 벙개와 오테식 벙개를 헷갈리지 않게 줄이지 않는다 */
const KIND_NAME: Record<GatheringKind, string> = {
  club_regular: "정모",
  club_flash: "오테식 벙개",
  exchange: "교류전",
  exchange_split: "교류전",
  flash: "일반 벙개",
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 모임들을 1~12월로 나눈 수 */
function perMonth(gatherings: AttendanceReportGathering[]) {
  const counts = MONTHS.map(() => 0);
  for (const g of gatherings) counts[Number(g.event_date.slice(5, 7)) - 1] += 1;
  return counts;
}

export default function AttendancePage() {
  const { data, thisMonth } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const yearly = data.unit === "year";
  const y = Number(data.period.slice(0, 4));
  const m = yearly ? null : Number(data.period.slice(5, 7));
  const thisYear = thisMonth.slice(0, 4);
  const current = yearly ? data.period === thisYear : data.period === thisMonth;
  const prev = yearly ? `?year=${y - 1}` : `?month=${shiftMonth(data.period, -1)}`;
  const next = yearly ? `?year=${y + 1}` : `?month=${shiftMonth(data.period, 1)}`;
  // 월별 ↔ 연간: 같은 해를 그대로 (올해면 이번 달로)
  const monthlyHref = `?month=${yearly ? (data.period === thisYear ? thisMonth : `${y}-01`) : data.period}`;
  const span = yearly ? "한 해" : "이 달";

  const byId = new Map(data.gatherings.map((g) => [g.id, g]));
  // 교류전은 회비·참가비를 함께 센다
  const shown = data.gatherings.filter((g) => filter === "all" || kindGroup(g.kind) === filter);
  const kindCount = (kind: GatheringKind) => data.gatherings.filter((g) => kindGroup(g.kind) === kind).length;

  // 고른 종류의 모임만 세어 다시 줄 세운다. 횟수는 오늘까지 지난 모임만 (많이 온 사람부터, 같으면 예정·이름순)
  const rows = data.rows
    .map((r) => {
      const gatherings = r.gathering_ids
        .map((id) => byId.get(id)!)
        .filter((g) => g && (filter === "all" || kindGroup(g.kind) === filter));
      const done = gatherings.filter((g) => g.event_date <= data.today).length;
      return { row: r, gatherings, done, upcoming: gatherings.length - done };
    })
    .sort(
      (a, b) =>
        b.done - a.done || b.upcoming - a.upcoming || a.row.user.name.localeCompare(b.row.user.name, "ko")
    );
  const q = query.trim();
  const visible = q
    ? rows.filter(({ row }) => `${row.user.name}${row.user.nickname ?? ""}`.includes(q))
    : rows;
  const came = rows.filter((r) => r.done > 0).length;

  return (
    <PageBody>
      <PageHeader
        back={<BackLink to="/app/admin">클럽 관리</BackLink>}
        eyebrow="ATTENDANCE"
        title="참석 현황"
        sub="회원마다 그 달·그 해에 참석한 모임 수와 어떤 모임에 갔는지 봐요. 횟수는 오늘까지 지난 모임만 세고, 앞으로 갈 모임은 '예정'으로 따로 보여요. 취소된 모임과 대기·불참은 세지 않아요. 관리자만 볼 수 있어요."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={prev} className="circle-link" aria-label={yearly ? "이전 해" : "이전 달"}>
            <ChevronLeft size={18} />
          </Link>
          <h2 className="min-w-[8.5rem] text-center font-display text-xl font-extrabold tracking-tight">
            {y}년{m ? ` ${m}월` : ""}
          </h2>
          <Link to={next} className="circle-link" aria-label={yearly ? "다음 해" : "다음 달"}>
            <ChevronRight size={18} />
          </Link>
          {!current ? (
            <Link to={yearly ? `?year=${thisYear}` : `?month=${thisMonth}`} className="btn-ghost btn-sm ml-1">
              {yearly ? "올해" : "이번 달"}
            </Link>
          ) : null}
        </div>
        <div className="segmented">
          <Link to={monthlyHref} className={`segmented-item ${yearly ? "" : "segmented-item-active"}`}>
            월별
          </Link>
          <Link to={`?year=${y}`} className={`segmented-item ${yearly ? "segmented-item-active" : ""}`}>
            연간
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <div className="tile-yellow !p-4 sm:!p-5">
          <p className="text-[12px] font-bold">{span} 모임</p>
          <p className="font-display text-3xl font-extrabold">{data.gatherings.length}</p>
          <p className="mt-1 text-[11px] font-semibold leading-snug opacity-80">
            {/* 교류전은 드물어 없는 달엔 빼고 보인다 */}
            {KIND_ORDER.filter((k) => k !== "exchange" || kindCount(k) > 0)
              .map((k) => `${KIND_NAME[k]} ${kindCount(k)}`)
              .join(" · ")}
          </p>
        </div>
        <div className="tile-green !p-4 sm:!p-5">
          <p className="text-[12px] font-bold">참석한 회원</p>
          <p className="font-display text-3xl font-extrabold">{came}</p>
          <p className="mt-1 text-[11px] font-semibold opacity-80">전체 {rows.length}명</p>
        </div>
        <div className="tile-lav !p-4 sm:!p-5">
          <p className="text-[12px] font-bold">0회</p>
          <p className="font-display text-3xl font-extrabold">{rows.length - came}</p>
          <p className="mt-1 text-[11px] font-semibold opacity-80">
            {filter === "all" ? `${span} 동안 한 번도 안 온 회원` : `${KIND_NAME[filter]}에 안 온 회원`}
          </p>
        </div>
      </section>

      {yearly ? (
        <section className="card space-y-3">
          <h2 className="section-title">달마다 모임</h2>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {perMonth(shown).map((n, i) => (
              <Link
                key={i}
                to={`?month=${y}-${String(i + 1).padStart(2, "0")}`}
                className="flex flex-col items-center rounded-xl border border-slate-200 py-2 transition-colors hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
                title={`${i + 1}월 보기`}
              >
                <span className="text-[11px] font-bold text-slate-500">{i + 1}월</span>
                <span className={`font-display text-lg font-extrabold ${n ? "" : "text-slate-300 dark:text-slate-600"}`}>
                  {n}
                </span>
              </Link>
            ))}
          </div>
          <p className="text-[12px] font-medium text-slate-500">달을 누르면 그 달 참석 현황으로 가요.</p>
        </section>
      ) : null}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="segmented max-w-full overflow-x-auto">
            {(["all", ...KIND_ORDER] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`segmented-item shrink-0 ${filter === f ? "segmented-item-active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "전체" : KIND_NAME[f]}
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-56">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input !h-10 !py-0 !pl-9"
              placeholder="이름으로 찾기"
              aria-label="이름으로 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {data.gatherings.length === 0 ? (
          <p className="text-sm font-medium text-slate-500">{yearly ? "이 해에는" : "이 달에는"} 모임이 없어요.</p>
        ) : (
          <>
            {yearly ? (
              <div className="ml-12 grid max-w-[300px] grid-cols-12 gap-[3px] text-center text-[10px] font-bold text-slate-400" aria-hidden="true">
                {MONTHS.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            ) : null}
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {visible.map(({ row, gatherings }) => (
                <MemberAttendance
                  key={row.user.id}
                  row={row}
                  gatherings={gatherings}
                  today={data.today}
                  yearly={yearly}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {shown.length ? (
        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <h2 className="section-title">
              모임별 참석 인원 {shown.length}
            </h2>
            <ChevronDown size={18} className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
            {shown.map((g) => (
              <li key={g.id}>
                <GatheringLine g={g} today={data.today} right={`${g.attending}명`} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </PageBody>
  );
}

function MemberAttendance({
  row,
  gatherings,
  today,
  yearly,
}: {
  row: AttendanceReportRow;
  /** 참석한 모임 (오늘 뒤 예정 포함, 날짜 순) */
  gatherings: AttendanceReportGathering[];
  today: string;
  /** 연간: 이름 아래 1~12월 칸 */
  yearly: boolean;
}) {
  const u = row.user;
  // 횟수는 오늘까지 지난 모임만, 앞으로 갈 모임은 예정으로 따로
  const done = gatherings.filter((g) => g.event_date <= today);
  const planned = gatherings.filter((g) => g.event_date > today);
  const kinds = KIND_ORDER.map((k) => [k, done.filter((g) => kindGroup(g.kind) === k).length] as const).filter(
    ([, n]) => n > 0
  );
  const head = (
    <>
      <MemberAvatar user={u} className="!h-9 !w-9 shrink-0 !text-xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate text-[14px]">{u.name}</strong>
          {u.member_type !== "member" ? (
            <span className="badge-gray !h-5 !px-2 !text-[10px]">{MEMBER_TYPE_LABEL[u.member_type]}</span>
          ) : null}
        </span>
        {kinds.length ? (
          <span className="mt-0.5 block truncate text-[12px] font-medium text-slate-500 dark:text-slate-400">
            {kinds.map(([k, n]) => `${KIND_NAME[k]} ${n}`).join(" · ")}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <strong className={`font-display text-xl ${done.length ? "" : "text-slate-400"}`}>
          {done.length}회
        </strong>
        {planned.length ? (
          <span className="block text-[11px] font-semibold text-slate-500">+예정 {planned.length}</span>
        ) : null}
      </span>
    </>
  );
  // 연간: 이름 아래 1~12월 칸 (위의 달 머리와 같은 자리·너비). 지난 참석은 초록, 예정만 있는 달은 노랑
  const months = yearly ? perMonth(done) : null;
  const plannedMonths = perMonth(planned);
  const strip = months ? (
    <div className="ml-12 mt-1.5 grid max-w-[300px] grid-cols-12 gap-[3px]">
      {months.map((n, i) => {
        const later = plannedMonths[i];
        return (
          <span
            key={i}
            title={`${i + 1}월 ${n}회${later ? ` · 예정 ${later}` : ""}`}
            className={`flex h-5 items-center justify-center rounded text-[10px] font-bold tabular-nums ${
              n
                ? "bg-house-green text-ink"
                : later
                ? "bg-house-yellow/50 text-ink/70"
                : "bg-slate-200/70 dark:bg-slate-700/60"
            }`}
          >
            {n || later || ""}
          </span>
        );
      })}
    </div>
  ) : null;
  if (!gatherings.length) {
    return (
      <li className="py-3 opacity-70">
        <div className="flex items-center gap-3">
          {head}
          <span className="w-[18px]" />
        </div>
        {strip}
      </li>
    );
  }
  return (
    <li>
      <details className="group">
        <summary className="block cursor-pointer list-none py-3">
          <div className="flex items-center gap-3">
            {head}
            <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
          </div>
          {strip}
        </summary>
        <ul className="mb-3 rounded-2xl bg-slate-100 px-3 dark:bg-slate-800 sm:ml-12">
          {gatherings.map((g) => (
            <li key={g.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
              <GatheringLine g={g} today={today} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function GatheringLine({
  g,
  today,
  right,
}: {
  g: AttendanceReportGathering;
  today: string;
  right?: string;
}) {
  return (
    <Link
      to={`/app/gatherings/${g.id}`}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 py-2.5 text-[13px] font-semibold hover:underline"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[g.kind]}`} aria-hidden="true" />
      <span className="shrink-0 tabular-nums">{when(g)}</span>
      <span className={`${KIND_BADGE[g.kind]} !h-5 !px-2 !text-[10px]`}>{KIND_NAME[g.kind]}</span>
      {/* 좁으면 모임 이름은 다음 줄로 */}
      <span className="min-w-[10rem] flex-1 truncate">
        {g.title}
        {g.location ? <span className="font-medium text-slate-500"> · {g.location}</span> : null}
      </span>
      {g.event_date > today ? <span className="badge-yellow !h-5 !px-2 !text-[10px]">예정</span> : null}
      {right ? <span className="shrink-0 text-slate-500">{right}</span> : null}
    </Link>
  );
}
