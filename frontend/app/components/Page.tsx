import type { ReactNode } from "react";
import { Link } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

export function PageBody({
  children,
  narrow = false,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className={`page-body ${narrow ? "page-body-narrow" : ""}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="page-heading">
      <div className="min-w-0">
        {back && <div className="mb-4">{back}</div>}
        {eyebrow && (
          <p className="eyebrow mb-2.5 text-slate-500 dark:text-slate-400">
            {eyebrow}
          </p>
        )}
        <h1 className="page-title">
          {title}
          <span className="text-house-blue">.</span>
        </h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-ink dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft size={15} />
      {children}
    </Link>
  );
}

export function EmptyCard({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-4 py-14 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {icon}
      </span>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {children}
      </p>
      {action}
    </div>
  );
}
