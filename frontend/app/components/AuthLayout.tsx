import type { ReactNode } from "react";

import { BallBasket } from "~/components/BallBasket";
import { Wordmark } from "~/components/Logo";

/** 로그인·가입 신청 화면: 왼쪽(모바일은 위) 오렌지 소개 타일 + 오른쪽 폼 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen p-3 sm:p-4">
      <div className="mx-auto grid max-w-5xl gap-3.5 md:min-h-[calc(100vh-2rem)] md:grid-cols-2">
        <section className="tile-orange flex min-h-[250px] flex-col justify-between sm:p-8 md:min-h-0">
          <Wordmark size="lg" className="!text-ink" />
          <BallBasket className="pointer-events-none absolute right-5 top-5 w-24 sm:w-32 md:left-1/2 md:right-auto md:top-1/2 md:w-60 md:-translate-x-1/2 md:-translate-y-[60%]" />
          <p className="mt-10 font-display text-[28px] font-extrabold leading-[1.08] tracking-[-0.05em] md:text-[40px]">
            일정 · 전적 · 회비를
            <br />
            한곳에서.
          </p>
        </section>
        <div className="flex animate-fade-in flex-col justify-center pb-8 motion-reduce:animate-none md:px-6 md:pb-0">
          {children}
        </div>
      </div>
    </div>
  );
}
