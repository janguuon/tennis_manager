import { useOutletContext } from "@remix-run/react";
import { Check, Hourglass, X, type LucideIcon } from "lucide-react";

import { KIND_DOT, KIND_LABEL, KIND_ORDER } from "~/lib/club";
import type { Gathering, Me } from "~/lib/types";

/** 내 참석 투표: 참석 · 대기 · 불참 · 투표 전 */
export type MyVoteKind = "attending" | "waiting" | "absent" | "none";

const VOTE: Record<
  MyVoteKind,
  { label: string; Icon: LucideIcon | null; pill: string; chip: string }
> = {
  attending: {
    label: "참석",
    Icon: Check,
    pill: "badge bg-ink text-white dark:bg-white dark:text-ink",
    chip: "bg-ink text-white",
  },
  waiting: {
    label: "대기",
    Icon: Hourglass,
    pill: "badge-yellow",
    chip: "bg-white text-ink",
  },
  absent: {
    label: "불참",
    Icon: X,
    pill: "badge-gray",
    chip: "bg-white/70 text-ink/70",
  },
  none: {
    label: "투표 전",
    Icon: null,
    pill: "badge border border-dashed border-slate-400 text-slate-500 dark:border-slate-500 dark:text-slate-400",
    chip: "border-[1.5px] border-dashed border-ink/60",
  },
};

/**
 * 이 일정에 내가 무엇을 눌렀는지. 관리자(투표하지 않음)와 끝난·취소된 일정은 null.
 * 앱 화면(Outlet 안)에서만 쓴다.
 */
export function useMyVote(
  g: Pick<Gathering, "status" | "my_status">
): MyVoteKind | null {
  const { user } = useOutletContext<{ user: Me }>();
  if (user.is_admin) return null;
  if (g.status !== "planned" && g.status !== "ongoing") return null;
  const s = g.my_status;
  return s === "attending" || s === "waiting" || s === "absent" ? s : "none";
}

/** 목록 줄의 내 투표 배지 (예: ✓ 참석, 투표 전) */
export function MyVotePill({ g }: { g: Pick<Gathering, "status" | "my_status"> }) {
  const vote = useMyVote(g);
  if (!vote) return null;
  const { label, Icon, pill } = VOTE[vote];
  return (
    <span className={`${pill} shrink-0`}>
      {Icon ? <Icon size={12} strokeWidth={3} /> : null}
      {label}
    </span>
  );
}

/** 동그라미 아이콘 (캘린더 칩·범례): ✓ 참석, 모래시계 대기, ✕ 불참, 빈 점선 동그라미 투표 전 */
function VoteCircle({ vote }: { vote: MyVoteKind }) {
  const { label, Icon, chip } = VOTE[vote];
  return (
    <span
      role="img"
      aria-label={`내 투표: ${label}`}
      title={`내 투표: ${label}`}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${chip}`}
    >
      {Icon ? <Icon size={10} strokeWidth={3.5} /> : null}
    </span>
  );
}

/** 캘린더 칩(종류 색 바탕) 안의 작은 내 투표 표시 (좁은 칸이라 아이콘만) */
export function MyVoteChip({ g }: { g: Pick<Gathering, "status" | "my_status"> }) {
  const vote = useMyVote(g);
  return vote ? <VoteCircle vote={vote} /> : null;
}

/** 휴대폰 캘린더 칸의 점: 종류 색 동그라미 + 내 투표 아이콘(투표 전이면 빈 동그라미) */
export function KindVoteDot({
  g,
}: {
  g: Pick<Gathering, "kind" | "status" | "my_status" | "open_to_members">;
}) {
  const vote = useMyVote(g);
  const Icon = vote ? VOTE[vote].Icon : null;
  const done = g.status === "completed" || g.status === "canceled";
  return (
    <span
      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-ink ${
        KIND_DOT[g.kind]
      } ${vote === "none" ? "border border-dashed border-ink/70" : ""} ${
        done || !g.open_to_members ? "opacity-40" : ""
      }`}
    >
      {Icon ? <Icon size={9} strokeWidth={3.5} /> : null}
    </span>
  );
}

/** 캘린더 범례: 종류 색과 내 투표 표시 */
export function CalendarLegend() {
  const { user } = useOutletContext<{ user: Me }>();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
      {KIND_ORDER.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <i aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${KIND_DOT[k]}`} />
          {KIND_LABEL[k]}
        </span>
      ))}
      {user.is_admin ? null : (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-slate-400">내 투표</span>
          {(["attending", "waiting", "absent", "none"] as MyVoteKind[]).map((v) => (
            // 칩 위(종류 색 바탕)처럼 보이게 연한 주황 바탕에 둔다
            <span key={v} className="flex items-center gap-1">
              <span className="rounded-full bg-house-orange/50 p-0.5">
                <VoteCircle vote={v} />
              </span>
              {VOTE[v].label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
