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
    } else if (intent === "toggle_payment") {
      await api(`/gatherings/${id}/participants/${formData.get("user_id")}/payment`, {
        method: "PUT",
        token,
        body: { paid: formData.get("paid") === "true" },
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
          fee: get("fee") ? Number(get("fee")) : 0,
          bank: get("bank") || null,
          account_number: get("account_number") || null,
          account_holder: get("account_holder") || null,
          description: get("description") || null,
          status: get("status"),
        },
      });
    } else if (intent === "delete_gathering") {
      await api(`/gatherings/${id}`, { method: "DELETE", token });
      const from = String(formData.get("from") || "");
      if (from.startsWith("list:")) return redirect(`/app/calendar?view=list&month=${from.slice(5)}`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) return redirect(`/app/day/${from}`);
      return redirect(from ? `/app/calendar?month=${from}` : "/app/calendar");
    }
    return json({ ok: true, error: null as string | null });
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

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 접근이 불가하면 무시 (HTTPS/localhost에서만 동작)
        }
      }}
      className={`shrink-0 rounded-md bg-court-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-court-700 ${className}`}
    >
      {copied ? "복사됨 ✓" : "계좌 복사"}
    </button>
  );
}

function KakaoShareButton({
  base,
  attendees,
  path,
}: {
  base: string;
  attendees: string[];
  path: string;
}) {
  const onClick = () => {
    const w = window as unknown as { Kakao?: any; ENV?: { KAKAO_JS_KEY?: string } };
    const Kakao = w.Kakao;
    const key = w.ENV?.KAKAO_JS_KEY;
    if (!Kakao || !key) {
      alert("카카오 공유가 아직 설정되지 않았어요. (KAKAO_JS_KEY 필요)");
      return;
    }
    if (!Kakao.isInitialized()) Kakao.init(key);

    const url = `${window.location.origin}${path}`;
    const suffix = `\n\n👉 모임 보기: ${url}`;
    const LIMIT = 200; // 카카오 텍스트 메시지 길이 제한

    // 참석자 줄: 200자를 넘으면 이름을 앞에서부터 채우고 "외 N명"으로 축약
    let line = attendees.length ? `\n👥 참석 ${attendees.length}명: ${attendees.join(", ")}` : "";
    if ((base + line + suffix).length > LIMIT && attendees.length) {
      const header = `\n👥 참석 ${attendees.length}명: `;
      const budget = LIMIT - base.length - suffix.length - header.length - 6;
      const shown: string[] = [];
      let used = 0;
      for (const n of attendees) {
        if (used + n.length + 2 > budget) break;
        shown.push(n);
        used += n.length + 2;
      }
      const rest = attendees.length - shown.length;
      line = shown.length
        ? header + shown.join(", ") + (rest > 0 ? ` 외 ${rest}명` : "")
        : `\n👥 참석 ${attendees.length}명`;
    }

    Kakao.Share.sendDefault({
      objectType: "text",
      text: base + line + suffix,
      link: { mobileWebUrl: url, webUrl: url },
    });
  };
  return (
    <button type="button" onClick={onClick} className="btn-ghost px-3 py-1.5 text-sm">
      💬 공유
    </button>
  );
}

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

  // 돌아갈 위치를 ?from 으로 판별:
  //  - "list:YYYY-MM" → 캘린더 리스트 모드(월 전체)
  //  - "YYYY-MM-DD"   → 그 날의 일정 목록 페이지
  //  - "YYYY-MM"      → 캘린더(달력 모드)
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") || "";
  let backHref: string;
  let backLabel: string;
  if (from.startsWith("list:")) {
    backHref = `/app/calendar?view=list&month=${from.slice(5)}`;
    backLabel = "← 목록";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    backHref = `/app/day/${from}`;
    backLabel = "← 목록";
  } else {
    backHref = `/app/calendar?month=${from || gathering.event_date.slice(0, 7)}`;
    backLabel = "← 캘린더";
  }

  // 수정 성공 시 모달 닫기
  useEffect(() => {
    if (actionData?.ok) setEditing(false);
  }, [actionData]);

  // 참가비 정산: 총액을 참석자 수로 1/n
  const feeAttendees = gathering.participants.filter((p) => p.status === "attending");
  const feePaidCount = feeAttendees.filter((p) => p.paid).length;
  const feePerPerson = feeAttendees.length ? Math.round(gathering.fee / feeAttendees.length) : 0;

  // 카카오 공유 메시지 (오픈톡방에 보낼 모임 요약)
  const shareAttendees = gathering.participants
    .filter((p) => p.status === "attending")
    .map((p) => p.user.name);
  const shareBase = [
    `🎾 ${gathering.title}`,
    `📅 ${gathering.event_date}${gathering.start_time ? ` ${gathering.start_time.slice(0, 5)}` : ""}${gathering.end_time ? `~${gathering.end_time.slice(0, 5)}` : ""}`,
    gathering.location ? `📍 ${gathering.location}` : "",
    `🟩 코트 ${gathering.court_numbers ? `${gathering.court_numbers} (${gathering.court_count}면)` : `${gathering.court_count}면`}`,
    gathering.fee > 0 ? `💰 참가비 총 ${gathering.fee.toLocaleString()}원 (1인 ${feePerPerson.toLocaleString()}원)` : "",
    gathering.account_number
      ? `🏦 ${gathering.bank ? `${gathering.bank} ` : ""}${gathering.account_number}${gathering.account_holder ? ` (${gathering.account_holder})` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

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
            {gathering.fee > 0 ? ` · 참가비 총 ${gathering.fee.toLocaleString()}원 (1인 ${feePerPerson.toLocaleString()}원)` : ""}
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
          <KakaoShareButton base={shareBase} attendees={shareAttendees} path={`/app/gatherings/${gathering.id}`} />
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
                <label className="label" htmlFor="e_fee">총 참가비 (원)</label>
                <input id="e_fee" name="fee" type="number" min="0" step="1000" className="input" placeholder="참석자 수로 1/n, 무료면 0" defaultValue={gathering.fee ?? 0} />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label" htmlFor="e_bank">은행</label>
                  <input id="e_bank" name="bank" className="input" placeholder="국민" defaultValue={gathering.bank ?? ""} />
                </div>
                <div className="col-span-2">
                  <label className="label" htmlFor="e_account">계좌번호</label>
                  <input id="e_account" name="account_number" className="input" placeholder="123-456-7890" defaultValue={gathering.account_number ?? ""} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="e_holder">예금주</label>
                <input id="e_holder" name="account_holder" className="input" placeholder="홍길동" defaultValue={gathering.account_holder ?? ""} />
              </div>

              <div>
                <label className="label" htmlFor="e_desc">설명</label>
                <textarea id="e_desc" name="description" rows={2} className="input" defaultValue={gathering.description ?? ""} />
              </div>

              {actionData?.error ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{actionData.error}</p>
              ) : null}

              <button type="submit" className="btn-primary w-full" disabled={navigation.state === "submitting"}>
                {navigation.state === "submitting" ? "저장 중…" : "저장"}
              </button>
            </Form>
          </div>
        </div>
      ) : null}

      {/* 참석 투표 — 관리자에겐 표시하지 않음 */}
      {!user.is_admin ? (
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
        {/* 관리자는 참석 투표가 필요 없어 버튼을 숨긴다(현황·명단은 계속 표시) */}
        {!user.is_admin ? (
          <>
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
                ⚠️ 모임 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 변경할 수 없습니다. 변경이 필요하면 관리자에게 문의하세요.
              </p>
            ) : null}
          </>
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
      ) : null}

      {/* 참가비 정산 */}
      {gathering.fee > 0 ? (
        <div className="card">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="font-semibold">💰 참가비 정산</h2>
            <span className="text-sm text-slate-500">
              <span className="font-semibold text-court-700 dark:text-court-300">
                {(feePerPerson * feePaidCount).toLocaleString()}
              </span>
              {" / "}
              {(feePerPerson * feeAttendees.length).toLocaleString()}원
              <span className="ml-1 text-xs">({feePaidCount}/{feeAttendees.length}명)</span>
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            총 {gathering.fee.toLocaleString()}원 ÷ 참석 {feeAttendees.length}명 = <span className="font-semibold text-slate-500">1인 {feePerPerson.toLocaleString()}원</span>
          </p>

          {/* 입금 계좌 (참가자 공개) */}
          {gathering.account_number ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-court-50 px-3 py-2 dark:bg-court-900/30">
              <div className="min-w-0 text-sm">
                <span className="text-slate-500">입금 </span>
                <span className="font-semibold text-court-800 dark:text-court-200">
                  {gathering.bank ? `${gathering.bank} ` : ""}
                  {gathering.account_number}
                </span>
                {gathering.account_holder ? (
                  <span className="text-slate-500"> · {gathering.account_holder}</span>
                ) : null}
              </div>
              <CopyButton text={gathering.account_number} className="ml-auto" />
            </div>
          ) : null}
          {feeAttendees.length === 0 ? (
            <p className="text-sm text-slate-500">참석자가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {feeAttendees.map((p) => {
                const badge = `rounded-full px-3 py-1 text-xs font-medium ${
                  p.paid
                    ? "bg-court-100 text-court-700 dark:bg-court-900/40 dark:text-court-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                }`;
                return (
                  <li key={p.user.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{p.user.name}</span>
                    {isOrganizer ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle_payment" />
                        <input type="hidden" name="user_id" value={p.user.id} />
                        <input type="hidden" name="paid" value={p.paid ? "false" : "true"} />
                        <button className={badge}>{p.paid ? "납부함" : "미납"}</button>
                      </Form>
                    ) : (
                      <span className={badge}>{p.paid ? "납부함" : "미납"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {isOrganizer ? (
            <p className="mt-2 text-xs text-slate-400">상태를 누르면 납부/미납이 전환됩니다.</p>
          ) : null}
        </div>
      ) : null}

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
