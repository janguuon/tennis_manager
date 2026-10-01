import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { ChevronLeft, ChevronRight, CircleCheck, Undo2, Wallet } from "lucide-react";

import { CopyButton } from "~/components/CopyButton";
import { HeroHeader, PageBody, PageHero } from "~/components/Page";
import { api } from "~/lib/api.server";
import { won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import type { MonthlyPaymentSummary, MyPaymentDue, PaymentLine } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회비 정산 · 오테식 매니저" }];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07-04" → "7/4" */
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 받을 돈/돌려줄 돈 목록. perPerson과 다르면(차액) 또는 perPerson을 안 주면 금액을 함께 적는다. */
function lineNames(lines: PaymentLine[], perPerson?: number): string {
  return lines.map((l) => (l.amount === perPerson ? l.user.name : `${l.user.name}(${won(l.amount)})`)).join(", ");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  const [summary, myDues] = await Promise.all([
    api<MonthlyPaymentSummary>(`/gatherings/payments/summary?month=${month}`, { token }),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
  ]);
  return json({ month, summary, myDues });
}

export default function PaymentsPage() {
  const { month, summary, myDues } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const goMonth = (m: string) => setSearchParams({ month: m });
  const [yy, mm] = month.split("-");
  const myTotal = myDues.reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <PageHero>
        <HeroHeader
          title="회비 정산"
          sub={`걷힌 돈 ${won(summary.total_collected)} · 미입금 ${won(summary.total_outstanding)}`}
          actions={
            <div className="flex items-center">
              <button className="icon-btn-hero" aria-label="이전 달" onClick={() => goMonth(shiftMonth(month, -1))}>
                <ChevronLeft size={20} />
              </button>
              <span className="w-24 text-center text-[15px] font-semibold">
                {yy}년 {Number(mm)}월
              </span>
              <button className="icon-btn-hero" aria-label="다음 달" onClick={() => goMonth(shiftMonth(month, 1))}>
                <ChevronRight size={20} />
              </button>
              {month !== currentMonth() ? (
                <button className="btn-hero btn-sm ml-1" onClick={() => goMonth(currentMonth())}>
                  이번 달
                </button>
              ) : null}
            </div>
          }
        />
      </PageHero>

      <PageBody>
        {/* 내가 낼 참가비 (달과 상관없이 전체) */}
        {myDues.length > 0 ? (
          <section className="card border-amber-200/80 dark:border-amber-500/30">
            <div className="flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <Wallet size={17} className="text-amber-600" />
                내가 낼 참가비
              </h2>
              <span className="text-xl font-bold text-slate-900 dark:text-white">{won(myTotal)}</span>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {myDues.map((d) => {
                return (
                  <li key={d.gathering_id} className="space-y-2 py-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        to={`/app/gatherings/${d.gathering_id}?from=${d.event_date}`}
                        className="min-w-0 truncate font-medium text-slate-800 hover:underline dark:text-slate-100"
                      >
                        <span className="mr-2 text-slate-400">{shortDate(d.event_date)}</span>
                        {d.title}
                      </Link>
                      <span className="shrink-0 font-semibold">
                        {d.partial ? <span className="badge-amber mr-1.5">추가 입금</span> : null}
                        {won(d.amount)}
                      </span>
                    </div>
                    {d.account_number ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                        <span className="min-w-0 text-[13px]">
                          <span className="block text-xs text-slate-400">
                            {[d.bank, d.account_holder].filter(Boolean).join(" · ") || "입금 계좌"}
                          </span>
                          <span className="break-all font-medium tabular-nums text-slate-700 dark:text-slate-200">
                            {d.account_number}
                          </span>
                        </span>
                        <CopyButton text={d.account_number} label="계좌 복사" className="!h-7" />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">입금 계좌가 아직 등록되지 않았어요.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* 월 합계 */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="걷힌 돈" value={won(summary.total_collected)} tone="text-ball-800 dark:text-ball-300" />
          <Stat label="미입금" value={won(summary.total_outstanding)} tone="text-amber-600 dark:text-amber-400" />
          <Stat label="합계" value={won(summary.total_expected)} tone="text-slate-900 dark:text-white" />
        </div>
        {summary.total_refund > 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
            <Undo2 size={16} className="shrink-0" />
            돌려줄 참가비 {won(summary.total_refund)}이 있어요. 아래 모임에서 확인하세요.
          </p>
        ) : null}

        {/* 모임별 정산 */}
        {summary.gatherings.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-14 text-center">
            <Wallet size={28} className="text-slate-300" />
            <p className="text-sm text-slate-500">이 달에 참가비가 있는 모임이 없어요.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {summary.gatherings.map((g) => {
              const pct = g.expected > 0 ? Math.min(100, (g.collected / g.expected) * 100) : 0;
              return (
                <section key={g.id} className="card space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                        className="flex min-w-0 items-center gap-2 font-semibold text-slate-900 hover:underline dark:text-white"
                      >
                        <span className="truncate">{g.title}</span>
                        {g.status === "canceled" ? <span className="badge-red">취소</span> : null}
                      </Link>
                      <p className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">
                        {won(g.collected)}
                        <span className="font-normal text-slate-400"> / {won(g.expected)}</span>
                      </p>
                    </div>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {shortDate(g.event_date)} · 총 {won(g.fee)} · 1인 {won(g.per_person)} · 입금 {g.paid_count}/{g.attending}명
                    </p>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-ball-500 dark:bg-ball-400" style={{ width: `${pct}%` }} />
                  </div>

                  {g.dues.length > 0 ? (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        미입금 {g.dues.length}명 · {won(g.outstanding)}
                      </span>
                      <span className="mx-1.5 text-slate-300">|</span>
                      {lineNames(g.dues, g.per_person)}
                    </p>
                  ) : g.attending > 0 ? (
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-ball-800 dark:text-ball-300">
                      <CircleCheck size={15} />
                      전원 입금 완료
                    </p>
                  ) : null}
                  {g.refunds.length > 0 ? (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-sky-700 dark:text-sky-300">돌려줄 돈</span>
                      <span className="mx-1.5 text-slate-300">|</span>
                      {lineNames(g.refunds)}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-slate-400">입금·환불 처리는 각 모임 상세의 ‘참가비’에서 할 수 있어요.</p>
      </PageBody>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="card !p-3.5 sm:!p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-base font-bold sm:text-xl ${tone}`}>{value}</p>
    </div>
  );
}
