import { Star } from "lucide-react";
import type { ReactNode } from "react";
import { BallBasket } from "~/components/BallBasket";

const COLORS = [
  "bg-house-lav",
  "bg-house-yellow",
  "bg-house-blue",
  "bg-house-green",
  "bg-house-orange",
];
export function memberColor(id: number) {
  return COLORS[Math.abs(id) % COLORS.length];
}
/** 대회 입상 별 개수 (관리자가 정한다) */
export type AwardCounts = {
  award_gold?: number;
  award_silver?: number;
  award_bronze?: number;
  award_note?: string | null;
};

/** "우승 2 · 준우승 1 · 입상 1" (없으면 빈 글자) */
export function awardText(u: AwardCounts) {
  return [
    u.award_gold ? `우승 ${u.award_gold}` : "",
    u.award_silver ? `준우승 ${u.award_silver}` : "",
    u.award_bronze ? `입상 ${u.award_bronze}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// 별 색 (클래스 이름을 그대로 써야 빌드에 남는다)
const STAR_CLASS = ["award-gold", "award-silver", "award-bronze"] as const;
// 동그라미 크기 대비: 별 중심까지 거리(%)와 별 사이 각도(도)
const STAR_RADIUS = 60;
const STAR_STEP = 24;

/**
 * 축구 엠블럼 위 별처럼 동그라미 위쪽에 별을 둥글게 둘러 놓는다.
 * 12시를 가운데로 좌우 대칭이 되게 펼치고, 가운데부터 금 → 은 → 동 순서로 채운다.
 */
function crestStars(u: AwardCounts) {
  const stars = [
    ...Array<string>(u.award_gold ?? 0).fill(STAR_CLASS[0]),
    ...Array<string>(u.award_silver ?? 0).fill(STAR_CLASS[1]),
    ...Array<string>(u.award_bronze ?? 0).fill(STAR_CLASS[2]),
  ];
  const n = stars.length;
  // 가운데에 가까운 자리부터 (같으면 오른쪽 먼저)
  const angles = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * STAR_STEP).sort(
    (a, b) => Math.abs(a) - Math.abs(b) || b - a
  );
  return stars.map((cls, k) => {
    const rad = (angles[k] * Math.PI) / 180;
    return {
      cls,
      left: `${50 + STAR_RADIUS * Math.sin(rad)}%`,
      top: `${50 - STAR_RADIUS * Math.cos(rad)}%`,
    };
  });
}

/**
 * 회원 동그라미: 프로필 사진이 있으면 사진, 없으면 이름 첫 글자.
 * 대회 입상 별(관리자가 정함)이 있으면 동그라미 위쪽에 금·은·동 별을 둥글게 둘러 놓는다.
 * 별이 동그라미 밖으로 나오도록 동그라미는 자르지 않고 사진만 둥글게 자른다.
 */
export function MemberAvatar({
  user,
  className = "",
}: {
  user: { id: number; name: string; avatar_url?: string | null } & AwardCounts;
  className?: string;
}) {
  const stars = crestStars(user);
  const award = stars.length
    ? `${awardText(user)}${user.award_note ? ` · ${user.award_note}` : ""}`
    : null;
  // 위치를 이미 정해 준 곳(absolute 등)은 그대로, 아니면 별 자리를 위해 relative
  const positioned = /(^|\s)!?(absolute|relative|fixed|sticky)(\s|$)/.test(className);
  return (
    <span
      className={`avatar h-10 w-10 text-sm text-ink ${award && !positioned ? "relative" : ""} ${memberColor(
        user.id
      )} ${className}`}
      title={award ? `${user.name} · ${award}` : user.name}
    >
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={user.name}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        user.name.charAt(0)
      )}
      {award ? (
        <span role="img" aria-label={award} className="contents">
          {stars.map((s, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`award-star ${s.cls}`}
              style={{ left: s.left, top: s.top }}
            >
              <Star fill="currentColor" />
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}
export function ClubIllustration() {
  return (
    <div className="club-illustration" aria-hidden="true">
      <span className="club-orbit" />
      <BallBasket />
      <span className="club-sticker">
        SEE YOU
        <br />
        ON COURT!
      </span>
    </div>
  );
}
export function TennisCourt({ label }: { label: string }) {
  return (
    <div
      className="tennis-court"
      aria-label={label ? `${label}번 코트` : "테니스 코트"}
    >
      <div className="court-lines" />
      <i className="court-net" />
      <i className="court-service" />
      <span>{label}</span>
      <i className="court-ball" />
    </div>
  );
}
export function SectionHeading({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {sub && (
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {sub}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
