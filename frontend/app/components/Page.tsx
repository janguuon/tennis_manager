import { Link } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** 페이지 본문 폭 + 카드 간격 (머리말도 이 안에 둔다) */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`mx-auto w-full space-y-3.5 ${narrow ? "max-w-2xl" : "max-w-[1120px]"}`}>{children}</div>
  );
}

/** 큰 제목 + 부제 + 오른쪽 버튼 영역 */
export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1 pb-1.5 pt-1 md:pt-2">
      <div className="min-w-0">
        {back ? <div className="mb-3">{back}</div> : null}
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** 뒤로 가기: 검정 알약 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="btn-primary btn-sm">
      <ArrowLeft size={15} />
      {children}
    </Link>
  );
}

/** 빈 상태 카드 */
export function EmptyCard({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-14 text-center">
      <span className="text-slate-300 dark:text-slate-600">{icon}</span>
      <p className="text-sm font-medium text-slate-500">{children}</p>
      {action}
    </div>
  );
}
