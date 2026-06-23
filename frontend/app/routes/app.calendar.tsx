import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { Gathering } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "캘린더 · 테니스 매니저" }];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 달력 그리드용 셀 배열 (앞뒤 빈칸 포함, 7의 배수). */
function buildCells(month: string): (number | null)[] {
  const [y, m] = month.split("-").map(Number);
  const startWeekday = new Date(y, m - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  const { from, to } = monthRange(month);
  const gatherings = await api<Gathering[]>(
    `/gatherings?date_from=${from}&date_to=${to}`,
    { token },
  );
  return json({ month, gatherings });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const get = (k: string) => {
    const v = formData.get(k);
    return v ? String(v) : undefined;
  };

  const courtNumbers = get("court_numbers");
  const maxParticipants = get("max_participants");
  const body = {
    title: get("title"),
    event_date: get("event_date"),
    start_time: get("start_time") || null,
    end_time: get("end_time") || null,
    location: get("location") || null,
    court_numbers: courtNumbers || null,
    // 코트 번호를 적었으면 면수는 자동(백엔드 계산), 아니면 직접 입력값 사용
    court_count: courtNumbers
      ? courtNumbers.split(",").filter((s) => s.trim()).length || 1
      : Number(get("court_count") || 1),
    max_participants: maxParticipants ? Number(maxParticipants) : null,
    description: get("description") || null,
  };

  try {
    await api("/gatherings", { method: "POST", token, body });
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "모임 생성에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

// 정시(00분) 단위 시간 옵션, 06시~22시 ("06:00", "07:00", ... "22:00")
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);
}

/** 시작 시간 + n시간 후를 옵션 범위 내로 계산 (범위를 넘으면 마지막 옵션으로 클램프). */
function addHours(time: string, hours: number): string {
  if (!time) return "";
  const [h] = time.split(":").map(Number);
  const target = `${String(h + hours).padStart(2, "0")}:00`;
  return TIME_OPTIONS.includes(target) ? target : TIME_OPTIONS[TIME_OPTIONS.length - 1];
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STATUS_DOT: Record<string, string> = {
  planned: "bg-blue-500",
  ongoing: "bg-court-500",
  completed: "bg-slate-400",
  canceled: "bg-red-400",
};

export default function CalendarPage() {
  const { month, gatherings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 시간 제어 상태: 시작 선택 시 종료를 +2h 자동 설정하되, 사용자가 종료를 직접 바꾸면 자동 변경 중단
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endEdited, setEndEdited] = useState(false);

  // 모임 생성 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setSelectedDate(null);
  }, [actionData]);

  // 모달이 열릴 때마다 시간 입력 초기화
  useEffect(() => {
    if (selectedDate) {
      setStartTime("");
      setEndTime("");
      setEndEdited(false);
    }
  }, [selectedDate]);

  const cells = buildCells(month);
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();

  // 날짜별 모임 그룹화
  const byDate = new Map<string, Gathering[]>();
  for (const g of gatherings) {
    const list = byDate.get(g.event_date) ?? [];
    list.push(g);
    byDate.set(g.event_date, list);
  }

  const goMonth = (m: string) => setSearchParams({ month: m });
  const [yy, mm] = month.split("-");

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          📅 {yy}년 {Number(mm)}월
        </h1>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5" onClick={() => goMonth(shiftMonth(month, -1))}>←</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => goMonth(currentMonth())}>오늘</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => goMonth(shiftMonth(month, 1))}>→</button>
        </div>
      </div>

      {/* 달력 그리드 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold dark:border-slate-700 dark:bg-slate-900/40">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
            >
              {w}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={idx} className="min-h-24 border-b border-r border-slate-100 bg-slate-50/40 dark:border-slate-700/60 dark:bg-slate-900/30" />;
            }
            const dateStr = `${month}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayStr;
            const dayGatherings = byDate.get(dateStr) ?? [];
            const weekday = idx % 7;

            return (
              <button
                key={idx}
                onClick={() => setSelectedDate(dateStr)}
                className="min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top transition hover:bg-court-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40"
              >
                <div
                  className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday
                      ? "bg-court-600 text-white"
                      : weekday === 0
                        ? "text-red-500"
                        : weekday === 6
                          ? "text-blue-500"
                          : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {day}
                </div>
                <div className="space-y-1">
                  {dayGatherings.map((g) => (
                    <Link
                      key={g.id}
                      to={`/app/gatherings/${g.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate rounded bg-court-100 px-1.5 py-0.5 text-[11px] font-medium text-court-800 hover:bg-court-200 dark:bg-court-900/50 dark:text-court-200 dark:hover:bg-court-900"
                      title={`${g.title} · 코트 ${g.court_count}면`}
                    >
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${STATUS_DOT[g.status]}`} />
                      {g.start_time ? `${g.start_time.slice(0, 5)} ` : ""}
                      {g.title}
                      {g.attendance ? ` (${g.attendance.attending})` : ""}
                    </Link>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        날짜 칸을 클릭하면 그 날짜로 새 모임을 등록할 수 있어요.
      </p>

      {/* 모임 생성 모달 */}
      {selectedDate ? (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setSelectedDate(null)}
        >
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <Form method="post" className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">새 모임 등록</h2>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setSelectedDate(null)}>
                  ✕
                </button>
              </div>

              <div>
                <label className="label" htmlFor="title">제목 *</label>
                <input id="title" name="title" className="input" required placeholder="정기 모임" autoFocus />
              </div>

              <div>
                <label className="label" htmlFor="event_date">날짜 *</label>
                <input id="event_date" name="event_date" type="date" className="input" required defaultValue={selectedDate} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="start_time">시작 시간</label>
                  <select
                    id="start_time"
                    name="start_time"
                    className="input"
                    value={startTime}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStartTime(v);
                      // 종료를 아직 직접 수정하지 않았으면 +2시간으로 자동 설정
                      if (!endEdited) setEndTime(addHours(v, 2));
                    }}
                  >
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="end_time">종료 시간</label>
                  <select
                    id="end_time"
                    name="end_time"
                    className="input"
                    value={endTime}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      setEndEdited(true);
                    }}
                  >
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="location">장소</label>
                <input id="location" name="location" className="input" placeholder="시민 테니스장" />
              </div>

              <div>
                <label className="label" htmlFor="court_numbers">코트 번호 (쉼표로 구분)</label>
                <input id="court_numbers" name="court_numbers" className="input" placeholder="예: 3, 5" />
                <p className="mt-1 text-xs text-slate-400">입력한 코트 개수가 곧 동시 진행 면수가 됩니다.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="court_count">코트 면수</label>
                  <input id="court_count" name="court_count" type="number" min="1" defaultValue={1} className="input" />
                  <p className="mt-1 text-xs text-slate-400">코트 번호 미입력 시 사용</p>
                </div>
                <div>
                  <label className="label" htmlFor="max_participants">최대 참석 인원</label>
                  <input id="max_participants" name="max_participants" type="number" min="1" className="input" placeholder="제한 없음" />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="description">설명</label>
                <textarea id="description" name="description" rows={2} className="input" />
              </div>

              {actionData && "error" in actionData && actionData.error ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
              ) : null}

              <button type="submit" className="btn-primary w-full" disabled={navigation.state === "submitting"}>
                {navigation.state === "submitting" ? "등록 중…" : "모임 등록"}
              </button>
            </Form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
