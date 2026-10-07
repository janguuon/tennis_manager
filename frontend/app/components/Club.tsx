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
export function MemberAvatar({
  user,
  className = "",
}: {
  user: { id: number; name: string };
  className?: string;
}) {
  return (
    <span
      className={`avatar h-10 w-10 text-sm text-ink ${memberColor(
        user.id
      )} ${className}`}
      title={user.name}
    >
      {user.name.charAt(0)}
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
