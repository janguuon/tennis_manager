import { Link, useOutletContext } from "@remix-run/react";
import { ArrowUpRight, Lock, Users } from "lucide-react";

import { MemberAvatar } from "~/components/Club";
import { MyVotePill } from "~/components/MyVote";
import { KIND_BADGE, KIND_DOT, KIND_LABEL, isClubKind } from "~/lib/club";
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
      : g.fee > 0 && g.per_person > 0
        ? `1인 ${won(g.per_person)}`
        : g.fee > 0
          ? `총 ${won(g.fee)}`
          : "",
    `코트 ${g.court_numbers ? g.court_numbers : `${g.court_count}면`}`,
  ].filter(Boolean);

  return (
    <Link
      to={to}
      className="group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white dark:hover:bg-slate-800/60 sm:px-6"
    >
      {/* 종류 색 띠: 오테식 정모 초록 · 오테식 벙개 보라 · 일반 벙개 주황 */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${KIND_DOT[g.kind]} ${muted ? "opacity-40" : ""}`}
      />
      <div className="w-12 shrink-0">
        <div
          className={`font-display text-[17px] font-extrabold tracking-[-0.03em] ${
            muted ? "text-slate-400" : "text-ink dark:text-white"
          }`}
        >
          {start ?? "미정"}
        </div>
        {end ? <div className="text-xs font-semibold text-slate-400">{end}</div> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[15px] font-bold ${
              g.status === "canceled" ? "text-slate-400 line-through" : "text-ink dark:text-white"
            }`}
          >
            {g.title}
          </span>
          <span className={`${KIND_BADGE[g.kind]} shrink-0`}>{KIND_LABEL[g.kind]}</span>
          {g.status !== "planned" ? (
            <span className={GATHERING_STATUS_BADGE[g.status]}>{GATHERING_STATUS_LABEL[g.status]}</span>
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
        {g.status !== "canceled" ? (
          <AttendeeLine people={g.attendees ?? []} waiting={g.attendance?.waiting ?? 0} muted={muted} />
        ) : null}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <MyVotePill g={g} />
        <span className="badge-line">
          <Users size={12} />
          {g.attendance?.attending ?? 0}
          {g.max_participants ? `/${g.max_participants}` : ""}
        </span>
      </span>
      <ArrowUpRight size={16} className="hidden shrink-0 text-slate-400 transition-colors group-hover:text-ink dark:group-hover:text-white sm:block" />
    </Link>
  );
}

/** 참석자 이름을 몇 명까지 적을지 (나머지는 "외 N명"): 작은 휴대폰 2명, 400px부터 3명, 넓은 화면 6명 */
const NAME_TIERS = [
  { n: 2, show: "min-[400px]:hidden" },
  { n: 3, show: "hidden min-[400px]:inline sm:hidden" },
  { n: 6, show: "hidden sm:inline" },
] as const;

/**
 * 참석자 한 줄: 겹친 프로필 3개 + "김민준 · 박서연 · 이도윤 외 6명 · 대기 2".
 * 늘 한 줄이다. 이름이 길면 말줄임, "외 N명"과 대기는 잘리지 않게 따로 둔다. 내 이름은 진하게.
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
  if (people.length === 0 && waiting === 0) return null;
  const names = (n: number) =>
    people.slice(0, n).map((p, i) => (
      <span key={p.id}>
        {i > 0 ? " · " : ""}
        <span className={p.id === user.id ? "font-bold text-ink dark:text-white" : ""}>{p.name}</span>
      </span>
    ));
  const rest = (n: number) => (people.length > n ? ` 외 ${people.length - n}명` : "");
  return (
    <div
      className={`mt-1.5 flex min-w-0 items-center gap-2 text-[12px] font-medium text-slate-500 dark:text-slate-400 ${
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
      <span aria-hidden="true" className="flex min-w-0 items-center">
        {NAME_TIERS.map(({ n, show }) => (
          <span key={n} className={`${show} min-w-0 truncate`}>
            {names(n)}
          </span>
        ))}
        {/* 이름이 길어 잘려도 "외 N명"은 남도록 따로 둔다 */}
        {NAME_TIERS.map(({ n, show }) =>
          people.length > n ? (
            <span key={n} className={`${show} shrink-0 whitespace-pre`}>
              {rest(n)}
            </span>
          ) : null
        )}
        {waiting ? (
          <span className="shrink-0 whitespace-pre text-slate-400">
            {people.length ? " · " : ""}대기 {waiting}
          </span>
        ) : null}
      </span>
    </div>
  );
}
