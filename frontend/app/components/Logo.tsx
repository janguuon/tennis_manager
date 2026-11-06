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

/*
 * 팀 엠블럼 (초안). 바탕이 흰색인 그림이라 흰 카드·배지에 얹어 쓴다.
 * 파일: public/emblem.png(화면), icon-192·512.png(배지·홈 화면), apple-touch-icon.png, favicon-64.png,
 * 링크 미리보기 og-image.png. 엠블럼이 바뀌면 scripts/make_emblem_assets.py 로 이 파일들을 새로 만든다.
 */
export function Emblem({ className = "" }: { className?: string }) {
  return (
    <img src="/emblem.png" alt="오테식 엠블럼" width={720} height={673} className={`block h-auto w-full ${className}`} />
  );
}

/** 머리(사이드바·휴대폰·이용 안내)의 작은 엠블럼: 흰 둥근 네모. 옆에 워드마크가 있어 그림은 읽지 않는다 */
export function EmblemBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-ink/10 dark:ring-white/15 ${className}`}
    >
      <img src="/icon-192.png" alt="" width={192} height={192} className="h-full w-full" />
    </span>
  );
}
