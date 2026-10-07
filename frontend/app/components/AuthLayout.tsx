import type { ReactNode } from "react";
import { ClubIllustration, Eyebrow } from "~/components/Club";
import { Wordmark } from "~/components/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <section className="auth-intro">
        <Wordmark size="lg" className="!text-ink" />
        <ClubIllustration />
        <div className="relative z-10 mt-auto max-w-[70%] pt-14 md:max-w-full md:pt-80">
          <Eyebrow>GOOD GAMES. BETTER TOGETHER.</Eyebrow>
          <p className="mt-4 font-display text-[28px] font-bold leading-tight tracking-[-0.05em] md:text-[38px]">
            같이 치면,
            <br />더 즐거우니까.
          </p>
          <p className="mt-4 text-xs leading-relaxed opacity-75 md:text-sm">
            우리의 일정, 전적, 회비를 한곳에서.
          </p>
        </div>
      </section>
      <div className="auth-form">
        {children}
        <p className="mt-8 text-center text-[10px] tracking-[0.12em] text-slate-500 dark:text-slate-400">
          OUR LITTLE TENNIS CLUBHOUSE
        </p>
      </div>
    </div>
  );
}
