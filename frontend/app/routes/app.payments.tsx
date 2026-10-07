import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Undo2,
  Wallet,
} from "lucide-react";

import { CopyButton } from "~/components/CopyButton";
import { Eyebrow, SectionHeading } from "~/components/Club";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { api } from "~/lib/api.server";
import { won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import type {
  MonthlyPaymentSummary,
  MyPaymentDue,
  PaymentLine,
} from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "회비 정산 · 오테식 매니저" },
];

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
const shortDate = (d: string) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 받을 돈/돌려줄 돈 목록. perPerson과 다르면(차액) 또는 perPerson을 안 주면 금액을 함께 적는다. */
function lineNames(lines: PaymentLine[], perPerson?: number): string {
  return lines
    .map((l) =>
      l.amount === perPerson ? l.user.name : `${l.user.name}(${won(l.amount)})`
    )
    .join(", ");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || currentMonth();
  const [summary, myDues] = await Promise.all([
    api<MonthlyPaymentSummary>(`/gatherings/payments/summary?month=${month}`, {
      token,
    }),
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
  // 낼 돈의 입금 계좌가 모두 같으면 한 번만 보여준다
  const sharedAccount =
    myDues.length > 0 &&
    myDues.every(
      (d) =>
        d.account_number &&
        d.account_number === myDues[0].account_number &&
        d.bank === myDues[0].bank
    )
      ? myDues[0]
      : null;

  return (
    <PageBody>
      <PageHeader
        eyebrow="A LITTLE EACH, A LOT TOGETHER."
        title="깔끔하게, 나눠 내요"
        sub="우리 모임의 참가비를 한눈에 확인하세요."
        actions={
          <div className="flex items-center gap-1">
            <button
              className="icon-btn"
              aria-label="이전 달"
              onClick={() => goMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={22} />
            </button>
            <span className="min-w-[6.5rem] text-center font-display text-[17px] font-extrabold tracking-[-0.03em]">
              {yy}년 {Number(mm)}월
            </span>
            <button
              className="icon-btn"
              aria-label="다음 달"
              onClick={() => goMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={22} />
            </button>
            {month !== currentMonth() ? (
              <button
                className="btn-ghost btn-sm ml-1"
                onClick={() => goMonth(currentMonth())}
              >
                이번 달
              </button>
            ) : null}
          </div>
        }
      />

      <div className="payment-overview">
        {/* 내가 낼 참가비 (달과 상관없이 전체) */}
        {myDues.length > 0 ? (
          <section className="tile-yellow">
            <Eyebrow>MY CLUB DUES</Eyebrow>
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="tile-title">내가 낼 참가비</h2>
                <p className="tile-sub">{myDues.length}건 입금 전</p>
              </div>
              <p className="font-display text-[34px] font-extrabold leading-none tracking-[-0.05em] sm:text-[44px]">
                {won(myTotal)}
              </p>
            </div>
            <ul className="tile-rows mt-3">
              {myDues.map((d) => (
                <li key={d.gathering_id} className="!block">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/app/gatherings/${d.gathering_id}?from=${d.event_date}`}
                      className="min-w-0 truncate font-bold hover:underline"
                    >
                      <span className="mr-2 font-extrabold">
                        {shortDate(d.event_date)}
                      </span>
                      {d.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1.5 font-extrabold">
                      {d.partial ? (
                        <span className="chip-white">추가 입금</span>
                      ) : null}
                      {won(d.amount)}
                    </span>
                  </div>
                  {/* 계좌가 모임마다 다르면 줄마다 보여준다 */}
                  {!sharedAccount && d.account_number ? (
                    <AccountBox due={d} className="mt-2" />
                  ) : null}
                </li>
              ))}
            </ul>
            {sharedAccount ? (
              <AccountBox due={sharedAccount} className="mt-4" />
            ) : null}
          </section>
        ) : null}

        <section className={`card ${myDues.length ? "" : "lg:col-span-2"}`}>
          <SectionHeading
            title={`${Number(mm)}월 정산 현황`}
            sub={`참가비가 있는 모임 ${summary.gatherings.length}건 기준`}
          />
          <div
            className={
              myDues.length ? "mt-2" : "mt-4 grid gap-x-8 sm:grid-cols-3"
            }
          >
            <StatTile label="걷힌 돈" value={won(summary.total_collected)} />
            <StatTile label="받을 돈" value={won(summary.total_outstanding)} />
            <StatTile
              label="정산 예정 합계"
              value={won(summary.total_expected)}
            />
          </div>
        </section>
      </div>
      {summary.total_refund > 0 ? (
        <p className="flex items-center gap-2 rounded-2xl bg-house-blue/15 px-4 py-3 text-sm font-semibold text-[#2447B8] dark:text-blue-300">
          <Undo2 size={16} className="shrink-0" />
          돌려줄 참가비 {won(summary.total_refund)}이 있어요. 아래 모임에서
          확인하세요.
        </p>
      ) : null}

      {/* 모임별 정산 */}
      {summary.gatherings.length === 0 ? (
        <EmptyCard icon={<Wallet size={28} />}>
          이 달에 참가비가 있는 모임이 없어요.
        </EmptyCard>
      ) : (
        <div className="space-y-4">
          {summary.gatherings.map((g) => {
            const pct =
              g.expected > 0
                ? Math.min(100, (g.collected / g.expected) * 100)
                : 0;
            return (
              <section key={g.id} className="card space-y-3.5">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link
                      to={`/app/gatherings/${g.id}?from=${g.event_date}`}
                      className="flex min-w-0 items-center gap-2 font-display text-[19px] font-extrabold tracking-[-0.03em] hover:underline"
                    >
                      <span className="truncate">{g.title}</span>
                      {g.status === "canceled" ? (
                        <span className="badge-red">취소</span>
                      ) : null}
                    </Link>
                    <p className="shrink-0 font-display text-[17px] font-extrabold tracking-[-0.03em]">
                      {won(g.collected)}
                      <span className="font-sans text-[13px] font-semibold text-slate-400">
                        {" "}
                        / {won(g.expected)}
                      </span>
                    </p>
                  </div>
                  <p className="mt-0.5 text-[13px] font-medium text-slate-500">
                    {shortDate(g.event_date)} · 총 {won(g.fee)} · 1인{" "}
                    {won(g.per_person)} · 입금 {g.paid_count}/{g.attending}명
                  </p>
                </div>
                {g.attending > 0 && g.attending <= 20 ? (
                  <div className="seg">
                    {Array.from({ length: g.attending }, (_, i) => (
                      <i key={i} className={i < g.paid_count ? "on" : ""} />
                    ))}
                  </div>
                ) : (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full bg-house-green"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {g.dues.length > 0 ? (
                  <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                    <span className="font-extrabold text-[#B4461B] dark:text-orange-300">
                      미입금 {g.dues.length}명 · {won(g.outstanding)}
                    </span>
                    <span className="mx-1.5 text-slate-300">|</span>
                    {lineNames(g.dues, g.per_person)}
                  </p>
                ) : g.attending > 0 ? (
                  <span className="badge-ink">
                    <CircleCheck size={13} />
                    전원 입금 완료
                  </span>
                ) : null}
                {g.refunds.length > 0 ? (
                  <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                    <span className="font-extrabold text-[#2447B8] dark:text-blue-300">
                      돌려줄 돈
                    </span>
                    <span className="mx-1.5 text-slate-300">|</span>
                    {lineNames(g.refunds)}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs font-semibold text-slate-400">
        입금·환불 처리는 각 모임 상세의 ‘참가비 정산’에서 할 수 있어요.
      </p>
    </PageBody>
  );
}

function AccountBox({
  due,
  className = "",
}: {
  due: MyPaymentDue;
  className?: string;
}) {
  if (!due.account_number) return null;
  return (
    <div className={`club-account ${className}`}>
      <span className="min-w-0 text-[13px]">
        <span className="block text-xs font-bold">
          {[due.bank, due.account_holder].filter(Boolean).join(" · ") ||
            "입금 계좌"}
        </span>
        <span className="break-all font-extrabold tabular-nums">
          {due.account_number}
        </span>
      </span>
      <CopyButton
        text={due.account_number}
        label="계좌 복사"
        tone="ink"
        className="!h-7"
      />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="payment-stat">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
