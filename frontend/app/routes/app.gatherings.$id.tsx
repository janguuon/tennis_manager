import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useOutletContext, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import {
  MATCH_TYPE_LABEL,
  type AttendanceStatus,
  type Draw,
  type DrawMatch,
  type GatheringDetail,
  type GatheringStatus,
  type User,
  type UserBrief,
} from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "모임 상세 · 테니스 매니저" }];

// 정시(00분) 단위 시간 옵션, 06시~22시
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);

const STATUS_LABEL: Record<GatheringStatus, string> = {
  planned: "예정",
  ongoing: "진행중",
  completed: "완료",
  canceled: "취소",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const [gathering, draws] = await Promise.all([
    api<GatheringDetail>(`/gatherings/${id}`, { token }),
    api<Draw[]>(`/gatherings/${id}/draws`, { token }),
  ]);
  return json({ gathering, draws });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  try {
    if (intent === "vote") {
      await api(`/gatherings/${id}/attendance`, {
        method: "PUT",
        token,
        body: { status: formData.get("status") },
      });
    } else if (intent === "generate") {
      await api(`/gatherings/${id}/draws/generate`, {
        method: "POST",
        token,
        body: {
          match_type: formData.get("match_type"),
          method: formData.get("method"),
        },
      });
    } else if (intent === "delete_draw") {
      await api(`/draws/${formData.get("draw_id")}`, { method: "DELETE", token });
    } else if (intent === "result") {
      await api(`/draw-matches/${formData.get("draw_match_id")}/result`, {
        method: "POST",
        token,
        body: {
          team1_score: Number(formData.get("team1_score") || 0),
          team2_score: Number(formData.get("team2_score") || 0),
        },
      });
    } else if (intent === "update_gathering") {
      const get = (k: string) => {
        const v = formData.get(k);
        return v ? String(v) : undefined;
      };
      const courtNumbers = get("court_numbers");
      const maxParticipants = get("max_participants");
      await api(`/gatherings/${id}`, {
        method: "PATCH",
        token,
        body: {
          title: get("title"),
          event_date: get("event_date"),
          start_time: get("start_time") || null,
          end_time: get("end_time") || null,
          location: get("location") || null,
          court_numbers: courtNumbers || null,
          court_count: courtNumbers
            ? courtNumbers.split(",").filter((s) => s.trim()).length || 1
            : Number(get("court_count") || 1),
          max_participants: maxParticipants ? Number(maxParticipants) : null,
          description: get("description") || null,
          status: get("status"),
        },
      });
    } else if (intent === "delete_gathering") {
      await api(`/gatherings/${id}`, { method: "DELETE", token });
      const from = String(formData.get("from") || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return redirect(`/app/day/${from}`);
      return redirect(from ? `/app/calendar?month=${from}` : "/app/calendar");
    }
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ ok: false, error: message }, { status: 400 });
  }
}

const VOTE_LABEL: Record<AttendanceStatus, string> = {
  attending: "참석",
  absent: "불참",
  maybe: "미정",
};

function names(players: UserBrief[]): string {
  return players.map((p) => p.name).join(", ") || "—";
}

export default function GatheringDetailPage() {
  const { gathering, draws } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { user } = useOutletContext<{ user: User }>();
  const isOrganizer = gathering.created_by === user.id || user.is_admin;
  const [editing, setEditing] = useState(false);
  // 등록된 실제 코트 번호 ("3, 5" → ["3","5"]). 대진의 코트 순번을 실제 번호로 변환하는 데 사용.
  const courtLabels = gathering.court_numbers
    ? gathering.court_numbers.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // 참석 변경 마감: 모임 3일 전부터는 일반 회원이 불참/미정으로 못 바꿈(관리자만 가능)
  const ATTENDANCE_LOCK_DAYS = 3;
  const daysUntilEvent = Math.round(
    (new Date(gathering.event_date + "T00:00:00").getTime() -
      new Date(new Date().toDateString()).getTime()) /
      86400000,
  );
  const attendanceLocked = daysUntilEvent <= ATTENDANCE_LOCK_DAYS;
  const canSetAbsence = user.is_admin || !attendanceLocked;

  // 돌아갈 위치: ?from 이 전체 날짜(YYYY-MM-DD)면 그 날의 일정 목록, 달(YYYY-MM)이면 캘린더로.
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") || "";
  const backToDay = /^\d{4}-\d{2}-\d{2}$/.test(from);
  const backHref = backToDay
    ? `/app/day/${from}`
    : `/app/calendar?month=${from || gathering.event_date.slice(0, 7)}`;
  const backLabel = backToDay ? "← 목록" : "← 캘린더";

  // 수정 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setEditing(false);
  }, [actionData]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">
            {gathering.title}
            <span className="ml-2 align-middle text-xs font-normal text-slate-400">
              {STATUS_LABEL[gathering.status]}
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {gathering.event_date}
            {gathering.start_time ? ` ${gathering.start_time.slice(0, 5)}` : ""}
            {gathering.end_time ? `~${gathering.end_time.slice(0, 5)}` : ""}
            {gathering.location ? ` · ${gathering.location}` : ""}
            {" · "}
            {gathering.court_numbers
              ? `코트 ${gathering.court_numbers} (${gathering.court_count}면)`
              : `코트 ${gathering.court_count}면`}
            {gathering.max_participants ? ` · 정원 ${gathering.max_participants}명` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isOrganizer ? (
            <>
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setEditing(true)}>
                수정
              </button>
              <Form method="post">
                <input type="hidden" name="intent" value="delete_gathering" />
                <input type="hidden" name="from" value={from} />
                <button
                  className="btn-ghost px-3 py-1.5 text-sm text-red-500"
                  onClick={(e) => {
                    if (!confirm("이 모임을 삭제할까요? 관련 참석/대진 정보도 함께 삭제됩니다.")) {
                      e.preventDefault();
                    }
                  }}
                >
                  삭제
                </button>
              </Form>
            </>
          ) : null}
          <Link to={backHref} className="btn-ghost px-3 py-1.5 text-sm">{backLabel}</Link>
        </div>
      </div>

      {/* 수정 모달 */}
      {editing ? (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEditing(false)}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Form method="post" className="card space-y-3">
              <input type="hidden" name="intent" value="update_gathering" />
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">모임 수정</h2>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setEditing(false)}>
                  ✕
                </button>
              </div>

              <div>
                <label className="label" htmlFor="e_title">제목 *</label>
                <input id="e_title" name="title" className="input" required defaultValue={gathering.title} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="e_date">날짜 *</label>
                  <input id="e_date" name="event_date" type="date" className="input" required defaultValue={gathering.event_date} />
                </div>
                <div>
                  <label className="label" htmlFor="e_status">상태</label>
                  <select id="e_status" name="status" className="input" defaultValue={gathering.status}>
                    {Object.entries(STATUS_LABEL).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="e_start">시작 시간</label>
                  <select id="e_start" name="start_time" className="input" defaultValue={gathering.start_time?.slice(0, 5) ?? ""}>
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="e_end">종료 시간</label>
                  <select id="e_end" name="end_time" className="input" defaultValue={gathering.end_time?.slice(0, 5) ?? ""}>
                    <option value="">선택 안 함</option>
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="e_location">장소</label>
                <input id="e_location" name="location" className="input" defaultValue={gathering.location ?? ""} />
              </div>

              <div>
                <label className="label" htmlFor="e_courts">코트 번호 (쉼표로 구분)</label>
                <input id="e_courts" name="court_numbers" className="input" placeholder="예: 3, 5" defaultValue={gathering.court_numbers ?? ""} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="e_count">코트 면수</label>
                  <input id="e_count" name="court_count" type="number" min="1" className="input" defaultValue={gathering.court_count} />
                  <p className="mt-1 text-xs text-slate-400">코트 번호 미입력 시 사용</p>
                </div>
                <div>
                  <label className="label" htmlFor="e_max">최대 참석 인원</label>
                  <input id="e_max" name="max_participants" type="number" min="1" className="input" placeholder="제한 없음" defaultValue={gathering.max_participants ?? ""} />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="e_desc">설명</label>
                <textarea id="e_desc" name="description" rows={2} className="input" defaultValue={gathering.description ?? ""} />
              </div>

              {actionData && "error" in actionData && actionData.error ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
              ) : null}

              <button type="submit" className="btn-primary w-full" disabled={navigation.state === "submitting"}>
                {navigation.state === "submitting" ? "저장 중…" : "저장"}
              </button>
            </Form>
          </div>
        </div>
      ) : null}

      {/* 참석 투표 */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">참석 투표</h2>
          {gathering.attendance ? (
            <span className="text-sm text-slate-500">
              참석 {gathering.attendance.attending} · 불참 {gathering.attendance.absent} · 미정{" "}
              {gathering.attendance.maybe}
            </span>
          ) : null}
        </div>
        <Form method="post" className="flex gap-2">
          <input type="hidden" name="intent" value="vote" />
          {(["attending", "absent", "maybe"] as AttendanceStatus[]).map((s) => {
            const blocked = s !== "attending" && !canSetAbsence;
            return (
              <button
                key={s}
                name="status"
                value={s}
                disabled={blocked}
                title={blocked ? `모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정 변경 불가 (관리자 문의)` : undefined}
                className="btn-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {VOTE_LABEL[s]}
              </button>
            );
          })}
        </Form>
        {attendanceLocked ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {user.is_admin
              ? `⚠️ 마감 기간(모임 ${ATTENDANCE_LOCK_DAYS}일 전)입니다. 관리자 권한으로 변경할 수 있습니다.`
              : `⚠️ 모임 ${ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 변경할 수 없습니다. 변경이 필요하면 관리자에게 문의하세요.`}
          </p>
        ) : null}

        {/* 참여자 명단 */}
        <ul className="mt-4 flex flex-wrap gap-2">
          {gathering.participants.map((p) => (
            <li
              key={p.user.id}
              className={`rounded-full px-3 py-1 text-xs ${
                p.status === "attending"
                  ? "bg-court-100 text-court-700 dark:bg-court-900/40 dark:text-court-300"
                  : p.status === "absent"
                    ? "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
              }`}
            >
              {p.user.name} · {VOTE_LABEL[p.status]}
            </li>
          ))}
        </ul>
      </div>

      {/* 대진 생성 (주최자/관리자) */}
      {isOrganizer ? (
        <div className="card">
          <h2 className="mb-3 font-semibold">대진 생성</h2>
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="generate" />
            <div>
              <label className="label" htmlFor="match_type">유형</label>
              <select id="match_type" name="match_type" className="input" defaultValue="mens_doubles">
                {Object.entries(MATCH_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <button name="method" value="random" className="btn-ghost">🎲 랜덤 생성</button>
            <button name="method" value="skill" className="btn-primary">⚖️ 실력 기반 생성</button>
          </Form>
        </div>
      ) : null}

      {/* 대진표 목록 */}
      {draws.map((draw) => (
        <div key={draw.id} className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              대진표 #{draw.id}
              <span className="ml-2 text-xs text-slate-400">
                {draw.generation_method === "skill"
                  ? "실력기반"
                  : draw.generation_method === "random"
                    ? "랜덤"
                    : "수동"}
              </span>
            </h2>
            {isOrganizer ? (
              <Form method="post">
                <input type="hidden" name="intent" value="delete_draw" />
                <input type="hidden" name="draw_id" value={draw.id} />
                <button className="text-xs text-red-500 hover:underline">삭제</button>
              </Form>
            ) : null}
          </div>

          <div className="space-y-2">
            {draw.matches.map((m) => (
              <DrawMatchRow key={m.id} match={m} canRecord={isOrganizer} courtLabels={courtLabels} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DrawMatchRow({
  match,
  canRecord,
  courtLabels,
}: {
  match: DrawMatch;
  canRecord: boolean;
  courtLabels: string[];
}) {
  const recorded = match.result_match_id !== null;
  // 대진의 코트 순번(1-based)을 등록된 실제 코트 번호로 변환
  const courtLabel =
    match.court_number != null && courtLabels[match.court_number - 1]
      ? courtLabels[match.court_number - 1]
      : (match.court_number ?? "-");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-700/40">
      <div className="flex items-center gap-2">
        <span className="rounded bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600">
          코트 {courtLabel} · {match.round_number ?? 1}R
        </span>
        <span className="font-medium">{names(match.team1)}</span>
        <span className="text-slate-400">vs</span>
        <span className="font-medium">{names(match.team2)}</span>
      </div>

      {recorded ? (
        <span className="rounded-full bg-court-100 px-2 py-0.5 text-xs text-court-700">결과 입력됨</span>
      ) : canRecord ? (
        <Form method="post" className="flex items-center gap-1">
          <input type="hidden" name="intent" value="result" />
          <input type="hidden" name="draw_match_id" value={match.id} />
          <input
            name="team1_score"
            type="number"
            min="0"
            className="w-14 rounded border border-slate-300 px-2 py-1 text-center dark:border-slate-600 dark:bg-slate-800"
            placeholder="0"
          />
          <span className="text-slate-400">:</span>
          <input
            name="team2_score"
            type="number"
            min="0"
            className="w-14 rounded border border-slate-300 px-2 py-1 text-center dark:border-slate-600 dark:bg-slate-800"
            placeholder="0"
          />
          <button className="btn-primary px-3 py-1 text-xs">기록</button>
        </Form>
      ) : null}
    </div>
  );
}
