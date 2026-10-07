/**
 * 워드마크 "otesik." + 작은 태그라인 (Units의 "units." 로고 재해석).
 */
export function Wordmark({
  size = "md",
  tagline = true,
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  tagline?: boolean;
  className?: string;
}) {
  const word = size === "lg" ? "text-[64px]" : size === "sm" ? "text-[30px]" : "text-[36px]";
  const tag = size === "lg" ? "mt-2 text-[13px]" : "mt-1 text-[9px]";
  return (
    <span className={`block leading-none text-ink dark:text-white ${className}`}>
      <span className={`font-display font-extrabold tracking-[-0.06em] ${word}`}>otesik.</span>
      {tagline ? <span className={`block font-bold tracking-[0.02em] ${tag}`}>오순도순 테니스 식구</span> : null}
    </span>
  );
}

/** 파비콘: 검정 사각형 안의 노란 테니스공 (data URI) */
export const LOGO_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#121212"/>' +
      '<circle cx="16" cy="16" r="9.5" fill="#F7C32E"/>' +
      '<path d="M10 9.5c3.6 3.4 3.6 9.6 0 13M22 9.5c-3.6 3.4-3.6 9.6 0 13" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  );
