import type { ReactNode } from "react";

/**
 * 페이지 상단의 차콜 띠. 제목·요약·주요 버튼을 흰 글씨로 올린다.
 * 바로 아래 <PageBody>의 첫 카드가 띠 위로 겹쳐 올라온다(그래서 첫 요소는 카드여야 한다).
 */
export function PageHero({ children }: { children: ReactNode }) {
  return (
    <section className="bg-slate-900 text-white dark:border-b dark:border-slate-800">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">{children}</div>
    </section>
  );
}

/** 히어로 아래 본문. 위로 살짝 끌어올려 첫 카드가 차콜 띠에 걸치게 한다. */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`relative mx-auto -mt-10 space-y-5 px-4 sm:px-6 ${narrow ? "max-w-2xl" : "max-w-5xl"}`}>
      {children}
    </div>
  );
}

/** 히어로 제목 + 부제 + 오른쪽 버튼 영역 */
export function HeroHeader({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="hero-title">{title}</h1>
        {sub ? <p className="hero-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
