import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { BackLink, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { KIND_BADGE, KIND_DOT, KIND_ORDER } from "~/lib/club";
import { todayKST } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import { MEMBER_TYPE_LABEL, WEEKDAYS } from "~/lib/status";
import type {
  GatheringKind,
  MonthlyAttendance,
  MonthlyAttendanceGathering,
  MonthlyAttendanceRow,
} from "~/lib/types";

/**
 * 월별 참석 (/app/admin/attendance, 관리자): 회원마다 그 달에 참석한 모임 수와 어떤 모임에 갔는지.
 * 취소된 모임과 대기·불참은 세지 않는다. 오늘 뒤 모임은 '예정'으로 따로 보여 준다.
 */
export const meta: MetaFunction = () => [{ title: "월별 참석 · 오테식 매니저" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const param = new URL(request.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : todayKST().slice(0, 7);
  try {
    const data = await api<MonthlyAttendance>(`/admin/attendance?month=${month}`, { token });
    return json({ data, thisMonth: todayKST().slice(0, 7) });
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
function when(g: MonthlyAttendanceGathering) {
  const [y, m, d] = g.event_date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})${g.start_time ? ` ${g.start_time.slice(0, 5)}` : ""}`;
}

type Filter = "all" | GatheringKind;

/** 여기선 일반 벙개와 오테식 벙개를 헷갈리지 않게 줄이지 않는다 */
const KIND_NAME: Record<GatheringKind, string> = {
  club_regular: "정모",
  club_flash: "오테식 벙개",
  flash: "일반 벙개",
};

export default function AttendancePage() {
  const { data, thisMonth } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [y, m] = data.month.split("-").map(Number);
  const byId = new Map(data.gatherings.map((g) => [g.id, g]));
  const shown = data.gatherings.filter((g) => filter === "all" || g.kind === filter);
  const kindCount = (kind: GatheringKind) => data.gatherings.filter((g) => g.kind === kind).length;

  // 고른 종류의 모임만 세어 다시 줄 세운다 (많이 온 사람부터, 같으면 이름순)
  const rows = data.rows
    .map((r) => {
      const ids = r.gathering_ids.filter((id) => filter === "all" || byId.get(id)?.kind === filter);
      return {
        row: r,
        ids,
        upcoming: ids.filter((id) => (byId.get(id)?.event_date ?? "") > data.today).length,
      };
    })
    .sort((a, b) => b.ids.length - a.ids.length || a.row.user.name.localeCompare(b.row.user.name, "ko"));
  const q = query.trim();
  const visible = q
    ? rows.filter(({ row }) => `${row.user.name}${row.user.nickname ?? ""}`.includes(q))
    : rows;
  const came = rows.filter((r) => r.ids.length > 0).length;

  return (
    <PageBody>
      <PageHeader
        back={<BackLink to="/app/admin">클럽 관리</BackLink>}
        eyebrow="ATTENDANCE"
        title="월별 참석"
        sub="회원마다 이 달에 참석한 모임 수와 어떤 모임에 갔는지 봐요. 취소된 모임과 대기·불참은 세지 않아요. 관리자만 볼 수 있어요."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link to={`?month=${shiftMonth(data.month, -1)}`} className="circle-link" aria-label="이전 달">
          <ChevronLeft size={18} />
        </Link>
        <h2 className="min-w-[8.5rem] text-center font-display text-xl font-extrabold tracking-tight">
          {y}년 {m}월
        </h2>
        <Link to={`?month=${shiftMonth(data.month, 1)}`} className="circle-link" aria-label="다음 달">
          <ChevronRight size={18} />
        </Link>
        {data.month !== thisMonth ? (
          <Link to={`?month=${thisMonth}`} className="btn-ghost btn-sm ml-1">
            이번 달
          </Link>
        ) : null}
      </div>

      <section className="grid grid-cols-3 gap-3">
        <div className="tile-yellow !p-4 sm:!p-5">
          <p className="text-[12px] font-bold">이 달 모임</p>
          <p className="font-display text-3xl font-extrabold">{data.gatherings.length}</p>
          <p className="mt-1 text-[11px] font-semibold leading-snug opacity-80">
            {KIND_ORDER.map((k) => `${KIND_NAME[k]} ${kindCount(k)}`).join(" · ")}
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
            {filter === "all" ? "이 달에 한 번도 안 온 회원" : `${KIND_NAME[filter]}에 안 온 회원`}
          </p>
        </div>
      </section>

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
          <p className="text-sm font-medium text-slate-500">이 달에는 모임이 없어요.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {visible.map(({ row, ids, upcoming }) => (
              <MemberAttendance
                key={row.user.id}
                row={row}
                gatherings={ids.map((id) => byId.get(id)!)}
                upcoming={upcoming}
                today={data.today}
              />
            ))}
          </ul>
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
  upcoming,
  today,
}: {
  row: MonthlyAttendanceRow;
  gatherings: MonthlyAttendanceGathering[];
  upcoming: number;
  today: string;
}) {
  const u = row.user;
  const kinds = KIND_ORDER.map((k) => [k, gatherings.filter((g) => g.kind === k).length] as const).filter(
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
        <strong className={`font-display text-xl ${gatherings.length ? "" : "text-slate-400"}`}>
          {gatherings.length}회
        </strong>
        {upcoming ? (
          <span className="block text-[11px] font-semibold text-slate-500">예정 {upcoming}</span>
        ) : null}
      </span>
    </>
  );
  if (!gatherings.length) {
    return <li className="flex items-center gap-3 py-3 opacity-70">{head}<span className="w-[18px]" /></li>;
  }
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 py-3">
          {head}
          <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
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
  g: MonthlyAttendanceGathering;
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
