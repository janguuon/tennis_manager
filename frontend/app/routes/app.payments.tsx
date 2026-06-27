import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { MonthlyPaymentSummary } from "~/lib/types";

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

const won = (n: number) => `${n.toLocaleString()}원`;

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  const summary = await api<MonthlyPaymentSummary>(
    `/gatherings/payments/summary?month=${month}`,
    { token },
  );
  return json({ month, summary });
}

export default function PaymentsPage() {
  const { month, summary } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const goMonth = (m: string) => setSearchParams({ month: m });
  const [yy, mm] = month.split("-");

  return (
    <div className="space-y-4">
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
      <div className="card grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold sm:text-xl">{won(summary.total_collected)}</div>
          <div className="text-xs text-slate-500">걷힘</div>
        </div>
        <div>
          <div className="text-lg font-bold text-amber-600 sm:text-xl dark:text-amber-400">
            {won(summary.total_unpaid)}
          </div>
          <div className="text-xs text-slate-500">미납</div>
        </div>
        <div>
          <div className="text-lg font-bold sm:text-xl">{won(summary.total_expected)}</div>
          <div className="text-xs text-slate-500">합계</div>
        </div>
      </div>

      {/* 모임별 정산 */}
      {summary.gatherings.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">이 달에 등록된 모임이 없어요.</div>
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
                  </Link>
                  <p className="text-xs text-slate-500">
                    {g.event_date.slice(5).replace("-", "/")} · 참가비 {won(g.fee)} · 참석 {g.attending}명
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <span className="font-semibold text-court-700 dark:text-court-300">
                    {won(g.collected)}
                  </span>
                  <span className="text-slate-400"> / {won(g.expected)}</span>
                  <div className="text-xs text-slate-500">
                    납부 {g.paid_count}/{g.attending}
                  </div>
                </div>
              </div>

              {g.unpaid_members.length > 0 ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
                  <span className="font-medium text-amber-700 dark:text-amber-300">미납 {g.unpaid_count}명:</span>{" "}
                  <span className="text-amber-700 dark:text-amber-300">
                    {g.unpaid_members.map((m) => m.name).join(", ")}
                  </span>
                </div>
              ) : g.attending > 0 ? (
                <p className="text-xs text-court-600 dark:text-court-400">✓ 전원 납부 완료</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        납부 처리는 각 모임 상세의 ‘참가비 정산’에서 할 수 있어요.
      </p>
    </div>
  );
}
