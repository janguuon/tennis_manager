import { Link, useOutletContext } from "@remix-run/react";
import { ArrowUpRight, Lock, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MemberAvatar } from "~/components/Club";
import { MyVotePill } from "~/components/MyVote";
import { COURT_SURFACE_LABEL, KIND_BADGE, KIND_DOT, KIND_LABEL, isClubKind } from "~/lib/club";
import { won } from "~/lib/format";
import { GATHERING_STATUS_BADGE, GATHERING_STATUS_LABEL } from "~/lib/status";
import type { AttendeeBrief, Gathering, Me } from "~/lib/types";

/** 일정 목록의 한 줄 (캘린더 리스트 보기, 일자별 목록에서 공용). 카드 안에 divide-y로 쌓아 쓴다. */
export function GatheringRow({ g, to }: { g: Gathering; to: string }) {
  const start = g.start_time?.slice(0, 5);
  const end = g.end_time?.slice(0, 5);
  const muted = g.status === "completed" || g.status === "canceled";
  // 좁은 화면에서 잘리므로 회원에게 중요한 금액을 코트보다 앞에 둔다
  const meta = [
    g.location ?? "장소 미정",
    isClubKind(g.kind)
      ? "회비 지출"
      : g.status === "canceled"
        ? g.per_person > 0
          ? `취소 정산 1인 ${won(g.per_person)}`
          : ""
        : g.fee > 0 && g.per_person > 0
        ? `1인 ${won(g.per_person)}`
        : g.fee > 0
          ? `총 ${won(g.fee)}`
          : "",
    `${g.court_surface ? `${COURT_SURFACE_LABEL[g.court_surface]} ` : ""}코트 ${
      g.court_numbers ? g.court_numbers : `${g.court_count}면`
    }`,
  ].filter(Boolean);

  // 시간 | 제목·장소 | 인원 (| 화살표). 참석자 줄은 그 아래에서 인원 칸 밑까지 넓게 쓴다
  return (
    <Link
      to={to}
      className="group relative grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-4 transition-colors hover:bg-white dark:hover:bg-slate-800/60 sm:grid-cols-[3rem_minmax(0,1fr)_auto_auto] sm:px-6"
    >
      {/* 종류 색 띠: 오테식 정모 초록 · 오테식 벙개 보라 · 일반 벙개 주황 */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${KIND_DOT[g.kind]} ${muted ? "opacity-40" : ""}`}
      />
      <div>
        <div
          className={`font-display text-[17px] font-extrabold tracking-[-0.03em] ${
            muted ? "text-slate-400" : "text-ink dark:text-white"
          }`}
        >
          {start ?? "미정"}
        </div>
        {end ? <div className="text-xs font-semibold text-slate-400">{end}</div> : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[15px] font-bold ${
              g.status === "canceled" ? "text-slate-400 line-through" : "text-ink dark:text-white"
            }`}
          >
            {g.title}
          </span>
          {/* 휴대폰에선 제목이 잘리지 않게 종류 배지를 뺀다 (왼쪽 색 띠로 구분) */}
          <span className={`${KIND_BADGE[g.kind]} hidden shrink-0 sm:inline-flex`}>{KIND_LABEL[g.kind]}</span>
          {g.status !== "planned" ? (
            <span className={`${GATHERING_STATUS_BADGE[g.status]} shrink-0`}>{GATHERING_STATUS_LABEL[g.status]}</span>
          ) : null}
          {/* 아직 정회원에게 공개 전인 일정 (임원진·관리자, 직접 만든 사람에게만 보인다) */}
          {!g.open_to_members ? (
            <span className="badge-gray shrink-0">
              <Lock size={11} />
              공개 전
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[13px] font-medium text-slate-500 dark:text-slate-400">{meta.join(" · ")}</p>
      </div>
      <span className="flex flex-col items-end gap-1">
        <MyVotePill g={g} />
        <span className="badge-line">
          <Users size={12} />
          {g.attendance?.attending ?? 0}
          {g.max_participants ? `/${g.max_participants}` : ""}
        </span>
      </span>
      <ArrowUpRight size={16} className="hidden text-slate-400 transition-colors group-hover:text-ink dark:group-hover:text-white sm:block" />
      <div className="col-[2/-1] min-w-0">
        {g.status === "canceled" ? (
          g.cancel_reason ? (
            <p className="mt-1 truncate text-[12px] font-semibold text-[#B42318] dark:text-red-300">
              취소 · {g.cancel_reason}
            </p>
          ) : null
        ) : (
          <AttendeeLine people={g.attendees ?? []} waiting={g.attendance?.waiting ?? 0} muted={muted} />
        )}
      </div>
    </Link>
  );
}

// 서버 렌더에서는 쓰지 않는다 (재는 일은 브라우저에서만)
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 휴대폰(sm 미만)에서 참석자 이름을 몇 줄까지 보일지. 넘치면 들어가는 만큼만 적고 "외 N명". */
const PHONE_LINES = 2;

/**
 * 참석자: 겹친 프로필 3개 + "김민준 · 박서연 · 이도윤 · … · 대기 2".
 * 넓은 화면은 이름을 모두 적고 줄을 바꾼다. 휴대폰은 두 줄에 들어가는 만큼 적고 "외 N명"
 * (모두 적어 보고 두 줄을 넘으면 한 명씩 줄인다. 그리기 전에 끝나 깜빡이지 않는다). 내 이름은 진하게.
 */
function AttendeeLine({
  people,
  waiting,
  muted,
}: {
  people: AttendeeBrief[];
  waiting: number;
  muted: boolean;
}) {
  const { user } = useOutletContext<{ user: Me }>();
  const boxRef = useRef<HTMLSpanElement>(null);
  // 처음(서버 렌더)에는 모두 적고, 휴대폰은 줄일 때까지 CSS로 두 줄에서 자른다
  const [shown, setShown] = useState(people.length);
  const ids = people.map((p) => p.id).join(",");
  const width = useRef(0);

  // 명단이 바뀌거나 폭이 바뀌면 다시 모두 적어 본다
  useBrowserLayoutEffect(() => setShown(people.length), [ids, people.length]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width.current) < 1) return;
      width.current = entry.contentRect.width;
      setShown(people.length);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [ids, people.length]);

  // 휴대폰: 두 줄을 넘으면 한 명 줄인다 (줄인 뒤 다시 그려지면 또 잰다)
  useBrowserLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || shown <= 1 || window.matchMedia("(min-width: 640px)").matches) return;
    const lineHeight = parseFloat(getComputedStyle(box).lineHeight);
    if (box.scrollHeight > lineHeight * PHONE_LINES + 1) setShown(shown - 1);
  });

  if (people.length === 0 && waiting === 0) return null;
  const n = Math.min(shown, people.length);
  return (
    <div
      className={`mt-1.5 flex min-w-0 items-start gap-2 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400 ${
        muted ? "opacity-70" : ""
      }`}
    >
      <span className="sr-only">
        {[people.length ? `참석 ${people.map((p) => p.name).join(", ")}` : "", waiting ? `대기 ${waiting}명` : ""]
          .filter(Boolean)
          .join(", ")}
      </span>
      {people.length ? (
        <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
          {people.slice(0, 3).map((p) => (
            <MemberAvatar
              key={p.id}
              user={p}
              className="!h-5 !w-5 !text-[9px] ring-2 ring-paper dark:ring-slate-900"
            />
          ))}
        </span>
      ) : null}
      {/* 이름은 끊지 않고, 가운뎃점 앞은 붙는 공백이라 줄은 "·" 뒤에서만 바뀐다 */}
      <span ref={boxRef} aria-hidden="true" className="block min-w-0 flex-1 max-sm:line-clamp-2">
        {people.slice(0, n).map((p, i) => (
          <span key={p.id}>
            {i > 0 ? "\u00a0· " : ""}
            <span className={`whitespace-nowrap ${p.id === user.id ? "font-bold text-ink dark:text-white" : ""}`}>
              {p.name}
            </span>
          </span>
        ))}
        {n < people.length ? (
          <>
            {" "}
            <span className="whitespace-nowrap">외 {people.length - n}명</span>
          </>
        ) : null}
        {waiting ? (
          <span className="text-slate-400">
            {people.length ? "\u00a0· " : ""}
            <span className="whitespace-nowrap">대기 {waiting}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
