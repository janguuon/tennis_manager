import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { CopyButton } from "~/components/CopyButton";
import { api } from "~/lib/api.server";
import { accountText, won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import type { MonthlyPaymentSummary, MyPaymentDue, PaymentLine } from "~/lib/types";

export const meta: MetaFunction = () => [{ title: "회비 정산 · 테니스 매니저" }];

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
    <div className="space-y-4">
      {/* 내가 낼 참가비 (달과 상관없이 전체) */}
      {myDues.length > 0 ? (
        <section className="card space-y-2 ring-2 ring-amber-200 dark:ring-amber-800">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">💳 내가 낼 참가비</h2>
            <span className="text-lg font-extrabold text-amber-700 dark:text-amber-300">{won(myTotal)}</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {myDues.map((d) => {
              const account = accountText(d);
              return (
                <li key={d.gathering_id} className="space-y-1 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/app/gatherings/${d.gathering_id}?from=${d.event_date}`}
                      className="min-w-0 truncate font-medium hover:text-court-600"
                    >
                      {shortDate(d.event_date)} {d.title}
                    </Link>
                    <span className="shrink-0 font-semibold">
                      {won(d.amount)}
                      {d.partial ? <span className="ml-1 text-xs font-normal text-amber-600">추가 입금</span> : null}
                    </span>
                  </div>
                  {d.account_number ? (
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="min-w-0 truncate">{account}</span>
                      <CopyButton text={d.account_number} label="계좌 복사" />
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

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold sm:text-xl">
          💰 {yy}년 {Number(mm)}월 회비 정산
        </h1>
        <div className="flex gap-1">
          <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => goMonth(shiftMonth(month, -1))}>←</button>
          <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => goMonth(currentMonth())}>이번 달</button>
          <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => goMonth(shiftMonth(month, 1))}>→</button>
        </div>
      </div>

      {/* 월 합계 */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-3xl bg-gradient-to-br from-court-500 to-emerald-600 p-3 text-center text-white shadow-lg shadow-court-500/30 sm:p-4">
          <div className="text-base font-extrabold sm:text-xl">{won(summary.total_collected)}</div>
          <div className="text-xs font-semibold text-white/80">걷힘</div>
        </div>
        <div className="rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 p-3 text-center text-white shadow-lg shadow-amber-500/30 sm:p-4">
          <div className="text-base font-extrabold sm:text-xl">{won(summary.total_outstanding)}</div>
          <div className="text-xs font-semibold text-white/80">미입금</div>
        </div>
        <div className="rounded-3xl bg-white p-3 text-center shadow-soft ring-1 ring-slate-100 sm:p-4 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="text-base font-extrabold sm:text-xl">{won(summary.total_expected)}</div>
          <div className="text-xs font-semibold text-slate-400">합계</div>
        </div>
      </div>
      {summary.total_refund > 0 ? (
        <p className="rounded-xl bg-sky-50 px-4 py-2 text-sm text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
          ↩️ 돌려줄 참가비 {won(summary.total_refund)}이 있어요. 아래 모임에서 확인하세요.
        </p>
      ) : null}

      {/* 모임별 정산 */}
      {summary.gatherings.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">이 달에 참가비가 있는 모임이 없어요.</div>
      ) : (
        <div className="space-y-2">
          {summary.gatherings.map((g) => (
            <div key={g.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                    className="truncate font-semibold hover:text-court-600"
                  >
                    {g.title}
                    {g.status === "canceled" ? <span className="ml-1 text-xs font-normal text-red-500">취소</span> : null}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {shortDate(g.event_date)} · 총 {won(g.fee)} · 1인 {won(g.per_person)} · 참석 {g.attending}명
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <span className="font-semibold text-court-700 dark:text-court-300">{won(g.collected)}</span>
                  <span className="text-slate-400"> / {won(g.expected)}</span>
                  <div className="text-xs text-slate-500">
                    입금 {g.paid_count}/{g.attending}
                  </div>
                </div>
              </div>

              {g.dues.length > 0 ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="font-medium">미입금 {g.dues.length}명 · {won(g.outstanding)}:</span>{" "}
                  {lineNames(g.dues, g.per_person)}
                </div>
              ) : g.attending > 0 ? (
                <p className="text-xs text-court-600 dark:text-court-400">✓ 전원 입금 완료</p>
              ) : null}
              {g.refunds.length > 0 ? (
                <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                  <span className="font-medium">↩️ 돌려줄 돈:</span> {lineNames(g.refunds)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        입금·환불 처리는 각 모임 상세의 ‘참가비 정산’에서 할 수 있어요.
      </p>
    </div>
  );
}
