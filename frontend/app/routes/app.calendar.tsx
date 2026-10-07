import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, List, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { GatheringRow } from "~/components/GatheringRow";
import { FieldGroup, Modal } from "~/components/Modal";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import { GATHERING_STATUS_CHIP, GATHERING_STATUS_DOT, WEEKDAYS } from "~/lib/status";
import type { Gathering } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "캘린더 · 오테식 매니저" }];

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
  // 보기 방식: URL(?view) 우선, 없으면 쿠키(cal_view)로 마지막 선택 기억, 기본 달력
  const urlView = url.searchParams.get("view");
  const savedList = /(?:^|;\s*)cal_view=list/.test(request.headers.get("Cookie") ?? "");
  const view: "calendar" | "list" =
    urlView === "list" ? "list" : urlView === "calendar" ? "calendar" : savedList ? "list" : "calendar";
  return json({ month, gatherings, view });
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
    fee: get("fee") ? Number(get("fee")) : 0,
    bank: get("bank") || null,
    account_number: get("account_number") || null,
    account_holder: get("account_holder") || null,
    description: get("description") || null,
  };

  try {
    await api("/gatherings", { method: "POST", token, body });
    return json({ ok: true, error: null as string | null });
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

export default function CalendarPage() {
  const { month, gatherings, view } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFetcher = useFetcher<{
    ok: boolean;
    created?: number;
    failed?: number;
    errors?: { row: number; error: string }[];
    error?: string;
  }>();
  // 시간 제어 상태: 시작 선택 시 종료를 +2h 자동 설정하되, 사용자가 종료를 직접 바꾸면 자동 변경 중단
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endEdited, setEndEdited] = useState(false);

  // 모임 생성 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setShowCreate(false);
  }, [actionData]);

  // 모달이 열릴 때마다 시간 입력 초기화
  useEffect(() => {
    if (showCreate) {
      setStartTime("");
      setEndTime("");
      setEndEdited(false);
    }
  }, [showCreate]);

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

  // month/view 둘 다 보존하며 URL 갱신
  const updateParams = (next: { month?: string; view?: "calendar" | "list" }) => {
    const p = new URLSearchParams(searchParams);
    if (next.month !== undefined) p.set("month", next.month);
    if (next.view !== undefined) {
      if (next.view === "calendar") p.delete("view");
      else p.set("view", next.view);
      // 마지막 보기 방식을 쿠키에 기억 (1년)
      document.cookie = `cal_view=${next.view}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }
    setSearchParams(p);
  };
  const goMonth = (m: string) => updateParams({ month: m });
  const [yy, mm] = month.split("-");

  // 리스트 뷰: 일정이 있는 날짜만 오름차순으로
  const listDates = [...byDate.keys()].sort();
  const cellBase =
    "min-h-[3.75rem] border-b border-r border-slate-200/70 p-1.5 text-center dark:border-slate-800 [&:nth-child(7n)]:border-r-0 sm:min-h-[6.5rem] sm:p-2 sm:text-left";

  return (
    <>
      <PageBody>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-1">
              {yy}년 {Number(mm)}월
              <button className="icon-btn ml-1" aria-label="이전 달" onClick={() => goMonth(shiftMonth(month, -1))}>
                <ChevronLeft size={24} />
              </button>
              <button className="icon-btn" aria-label="다음 달" onClick={() => goMonth(shiftMonth(month, 1))}>
                <ChevronRight size={24} />
              </button>
            </span>
          }
          sub={
            <>
              {gatherings.length > 0 ? `이 달 일정 ${gatherings.length}개` : "이 달 일정이 아직 없어요"}
              {month !== currentMonth() ? (
                <button className="badge-yellow ml-2 align-middle" onClick={() => goMonth(currentMonth())}>
                  오늘로
                </button>
              ) : null}
            </>
          }
          actions={
            <>
              <div className="segmented">
                <button
                  className={`segmented-item ${view === "calendar" ? "segmented-item-active" : ""}`}
                  onClick={() => updateParams({ view: "calendar" })}
                >
                  <CalendarDays size={14} />
                  달력
                </button>
                <button
                  className={`segmented-item ${view === "list" ? "segmented-item-active" : ""}`}
                  onClick={() => updateParams({ view: "list" })}
                >
                  <List size={14} />
                  리스트
                </button>
              </div>
              <button className="btn-ghost btn-sm !h-10" onClick={() => setImporting(true)} title="엑셀로 여러 일정 등록">
                <Upload size={15} />
                <span className="hidden sm:inline">엑셀</span>
              </button>
              <button className="btn-accent btn-sm !h-10" onClick={() => setShowCreate(true)}>
                <Plus size={16} />
                일정 등록
              </button>
            </>
          }
        />

        {view === "calendar" ? (
          /* 달력 그리드 */
          <div className="card overflow-hidden !p-0">
            <div className="grid grid-cols-7 bg-house-yellow">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={`py-2.5 text-center text-xs font-extrabold text-ink ${i === 0 || i === 6 ? "" : "opacity-70"}`}
                >
                  {w}
                </div>
              ))}
            </div>

            {/* -mb-px: 마지막 줄의 아래 테두리를 카드 테두리 뒤로 숨김 */}
            <div className="-mb-px grid grid-cols-7">
              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={idx} className={`${cellBase} bg-slate-100/60 dark:bg-slate-950/40`} />;
                }
                const dateStr = `${month}-${String(day).padStart(2, "0")}`;
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;
                const dayGatherings = byDate.get(dateStr) ?? [];
                const weekday = idx % 7;

                return (
                  <Link
                    key={idx}
                    to={`/app/day/${dateStr}`}
                    className={`${cellBase} block transition-colors hover:bg-white dark:hover:bg-slate-800/50`}
                  >
                    <span
                      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 font-display text-[14px] font-extrabold ${
                        isToday
                          ? "bg-ink text-house-yellow dark:bg-house-yellow dark:text-ink"
                          : isPast
                            ? "text-slate-400 dark:text-slate-600"
                            : weekday === 0
                              ? "text-[#D2381F] dark:text-red-400"
                              : weekday === 6
                                ? "text-[#2F5BD3] dark:text-blue-400"
                                : "text-ink dark:text-slate-100"
                      }`}
                    >
                      {day}
                    </span>

                    {/* 모바일: 상태 점 (최대 3개) */}
                    <div className="mt-1 flex justify-center gap-1 sm:hidden">
                      {dayGatherings.slice(0, 3).map((g) => (
                        <span key={g.id} className={`h-1.5 w-1.5 rounded-full ${GATHERING_STATUS_DOT[g.status]}`} />
                      ))}
                    </div>

                    {/* 데스크톱: 일정 칩 */}
                    <div className="mt-1 hidden space-y-1 sm:block">
                      {dayGatherings.slice(0, 3).map((g) => (
                        <div
                          key={g.id}
                          className={`truncate rounded-full px-2 py-[3px] text-[11px] font-bold leading-tight ${GATHERING_STATUS_CHIP[g.status]}`}
                          title={g.title}
                        >
                          {g.start_time ? <span className="mr-1 opacity-60">{g.start_time.slice(0, 5)}</span> : null}
                          {g.title}
                        </div>
                      ))}
                      {dayGatherings.length > 3 ? (
                        <div className="px-1 text-[11px] font-bold text-slate-500">+{dayGatherings.length - 3}개</div>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : listDates.length === 0 ? (
          <EmptyCard
            icon={<CalendarDays size={28} />}
            action={
              <button className="btn-accent btn-sm" onClick={() => setShowCreate(true)}>
                <Plus size={16} />
                일정 등록
              </button>
            }
          >
            이 달에 등록된 일정이 없어요.
          </EmptyCard>
        ) : (
          /* 리스트 보기: 날짜별 소제목 + 일정 줄을 카드 한 장에 */
          <section className="card overflow-hidden !p-0">
            {listDates.map((dateStr, i) => {
              const [ly, lm, ld] = dateStr.split("-").map(Number);
              const wd = WEEKDAYS[new Date(ly, lm - 1, ld).getDay()];
              const list = [...(byDate.get(dateStr) ?? [])].sort((a, b) =>
                (a.start_time ?? "99").localeCompare(b.start_time ?? "99"),
              );
              return (
                <div key={dateStr} className={i > 0 ? "border-t-[1.5px] border-slate-200 dark:border-slate-800" : ""}>
                  <h2 className="flex items-center gap-2 px-5 pb-1 pt-4 font-display text-[17px] font-extrabold tracking-[-0.03em] sm:px-6">
                    {lm}.{ld} <span className="font-sans text-[13px] font-bold text-slate-500">{wd}요일</span>
                    {dateStr === todayStr ? <span className="badge-yellow">오늘</span> : null}
                  </h2>
                  <ul className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {list.map((g) => (
                      <li key={g.id}>
                        <GatheringRow g={g} to={`/app/gatherings/${g.id}?from=list:${month}`} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        )}
      </PageBody>

      {/* 일정 등록 */}
      {showCreate ? (
        <Modal title="새 일정" onClose={() => setShowCreate(false)}>
          <Form method="post" className="space-y-6">
            <FieldGroup title="기본 정보">
              <div>
                <label className="label" htmlFor="title">제목</label>
                <input id="title" name="title" className="input" required placeholder="정기 모임" autoFocus />
              </div>
              <div>
                <label className="label" htmlFor="event_date">날짜</label>
                <input id="event_date" name="event_date" type="date" className="input" required defaultValue={todayStr} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="start_time">시작</label>
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
                  <label className="label" htmlFor="end_time">종료</label>
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
            </FieldGroup>

            <FieldGroup title="코트 · 인원">
              <div>
                <label className="label" htmlFor="court_numbers">코트 번호</label>
                <input id="court_numbers" name="court_numbers" className="input" placeholder="예: 3, 5 (쉼표로 구분)" />
                <p className="mt-1.5 text-xs text-slate-400">입력한 코트 수만큼 동시에 경기를 진행해요.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="court_count">코트 면수</label>
                  <input id="court_count" name="court_count" type="number" min="1" defaultValue={1} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="max_participants">정원</label>
                  <input id="max_participants" name="max_participants" type="number" min="1" className="input" placeholder="제한 없음" />
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title="참가비">
              <div>
                <label className="label" htmlFor="fee">총 참가비 (원)</label>
                <input id="fee" name="fee" type="number" min="0" step="1000" className="input" placeholder="0 = 무료" />
                <p className="mt-1.5 text-xs text-slate-400">참석 인원으로 나눠 1인 금액을 계산해요 (100원 단위 올림).</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label" htmlFor="bank">은행</label>
                  <input id="bank" name="bank" className="input" placeholder="국민" />
                </div>
                <div className="col-span-2">
                  <label className="label" htmlFor="account_number">계좌번호</label>
                  <input id="account_number" name="account_number" className="input" placeholder="123-456-7890" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="account_holder">예금주</label>
                <input id="account_holder" name="account_holder" className="input" placeholder="홍길동" />
              </div>
            </FieldGroup>

            <div>
              <label className="label" htmlFor="description">메모</label>
              <textarea id="description" name="description" rows={2} className="input" />
            </div>

            {actionData?.error ? <p className="alert-error">{actionData.error}</p> : null}

            <button type="submit" className="btn-primary h-11 w-full" disabled={navigation.state === "submitting"}>
              {navigation.state === "submitting" ? "등록 중…" : "등록하기"}
            </button>
          </Form>
        </Modal>
      ) : null}

      {/* 엑셀 일괄 등록 */}
      {importing ? (
        <Modal title="엑셀로 일정 등록" onClose={() => setImporting(false)}>
          <importFetcher.Form
            method="post"
            action="/resources/gatherings-import"
            encType="multipart/form-data"
            className="space-y-4"
          >
            <p className="text-sm text-slate-500 dark:text-slate-400">
              한 행에 모임 하나씩 적어 올리면 한 번에 등록돼요.
            </p>
            <a href="/resources/gatherings-template" className="btn-secondary w-full" download>
              <Download size={16} />
              양식 내려받기
            </a>
            <div>
              <label className="label" htmlFor="file">엑셀 파일 (.xlsx)</label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx"
                className="input file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-[13px] file:font-semibold file:text-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200"
                required
              />
            </div>
            <button type="submit" className="btn-primary h-11 w-full" disabled={importFetcher.state !== "idle"}>
              {importFetcher.state !== "idle" ? "올리는 중…" : "올리기"}
            </button>

            {importFetcher.data ? (
              importFetcher.data.ok ? (
                <div className="alert-success space-y-2">
                  <p className="font-semibold">
                    {importFetcher.data.created}건 등록
                    {importFetcher.data.failed ? ` · ${importFetcher.data.failed}건 실패` : ""}
                  </p>
                  {importFetcher.data.errors && importFetcher.data.errors.length > 0 ? (
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600 dark:text-red-400">
                      {importFetcher.data.errors.map((e) => (
                        <li key={e.row}>
                          {e.row}행: {e.error}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="alert-error">{importFetcher.data.error}</p>
              )
            ) : null}
          </importFetcher.Form>
        </Modal>
      ) : null}
    </>
  );
}
