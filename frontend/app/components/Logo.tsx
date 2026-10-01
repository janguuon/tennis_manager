/**
 * 브랜드 로고 마크: 라임(테니스공) 사각형 안에 차콜 공 무늬.
 * 차콜 띠 위·흰 바탕 위 모두 같은 모양으로 쓴다.
 */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-ball-400" />
      <circle cx="16" cy="16" r="8.5" fill="none" className="stroke-slate-900" strokeWidth="2" />
      <path
        d="M10 10C13.6 13.2 13.6 18.8 10 22M22 10C18.4 13.2 18.4 18.8 22 22"
        fill="none"
        className="stroke-slate-900"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 파비콘용 같은 마크 (data URI) */
export const LOGO_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#D4F53C"/>' +
      '<circle cx="16" cy="16" r="8.5" fill="none" stroke="#191F28" stroke-width="2"/>' +
      '<path d="M10 10C13.6 13.2 13.6 18.8 10 22M22 10C18.4 13.2 18.4 18.8 22 22" fill="none" stroke="#191F28" stroke-width="2" stroke-linecap="round"/></svg>',
  );
