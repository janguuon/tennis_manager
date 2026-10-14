import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Landmark,
  Undo2,
  Wallet,
} from "lucide-react";

import { CopyButton } from "~/components/CopyButton";
import { Eyebrow, SectionHeading } from "~/components/Club";
import { EmptyCard, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { KIND_BADGE, KIND_LABEL, canSettle, isClubKind } from "~/lib/club";
import { accountText, won } from "~/lib/format";
import { requireToken } from "~/lib/session.server";
import type {
  CourtBooking,
  Me,
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
  const [summary, myDues, myBookings, me] = await Promise.all([
    api<MonthlyPaymentSummary>(`/gatherings/payments/summary?month=${month}`, {
      token,
    }),
    api<MyPaymentDue[]>("/gatherings/payments/me", { token }),
    api<CourtBooking[]>("/court-bookings/me", { token }),
    api<Me>("/users/me", { token }),
  ]);
  // 정산 담당(관리자·총무): 달과 상관없이 아직 지급하지 않은 코트비 전체
  const pendingBookings = canSettle(me)
    ? await api<CourtBooking[]>("/court-bookings", { token })
    : [];
  return json({ month, summary, myDues, myBookings, pendingBookings });
}

export async function action({ request }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  try {
    await api(`/court-bookings/${formData.get("booking_id")}/reimbursement`, {
      method: "PUT",
      token,
      body: { reimbursed: formData.get("reimbursed") === "true" },
    });
    return json({ error: null as string | null });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "처리에 실패했습니다.";
    return json({ error: message }, { status: 400 });
  }
}

export default function PaymentsPage() {
  const { month, summary, myDues, myBookings, pendingBookings } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const pendingTotal = pendingBookings.reduce((s, b) => s + b.amount, 0);
  const myBookingTotal = myBookings.reduce((s, b) => s + b.amount, 0);
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
        sub="참가비와 회비 지출(코트비)을 한눈에 확인하세요."
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

      {actionData?.error ? (
        <p className="alert-error flex items-center gap-2">
          <CircleAlert size={16} className="shrink-0" />
          {actionData.error}
        </p>
      ) : null}

      {/* 정산 담당(관리자·총무): 아직 지급하지 않은 코트비 (달과 상관없이 전체) */}
      {pendingBookings.length > 0 ? (
        <section className="tile-green space-y-3">
          <Eyebrow>COURT FEE TO SEND</Eyebrow>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="tile-title">지급할 코트비</h2>
              <p className="tile-sub">
                코트를 잡은 사람에게 회비에서 보내 주세요 ·{" "}
                {pendingBookings.length}건
              </p>
            </div>
            <p className="font-display text-[34px] font-extrabold leading-none tracking-[-0.05em] sm:text-[44px]">
              {won(pendingTotal)}
            </p>
          </div>
          <ul className="tile-rows">
            {pendingBookings.map((b) => {
              const busy =
                navigation.state !== "idle" &&
                navigation.formData?.get("booking_id") === String(b.id);
              return (
                <li key={b.id} className="!block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/app/gatherings/${b.gathering_id}?from=${b.event_date}`}
                        className="block truncate text-xs font-bold hover:underline"
                      >
                        {shortDate(b.event_date)} · {b.gathering_title}
                      </Link>
                      <p className="mt-0.5">
                        <span className="font-extrabold">{b.booker.name}</span>
                        {b.court_label ? (
                          <span className="ml-1.5 text-xs font-semibold">
                            · {b.court_label}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <strong className="shrink-0 font-display text-lg font-extrabold tracking-[-0.03em]">
                      {won(b.amount)}
                    </strong>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {b.account?.account_number ? (
                      <>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold">
                          <Landmark size={14} className="shrink-0" />
                          <span className="break-all">
                            {accountText(b.account)}
                          </span>
                        </span>
                        <CopyButton
                          text={b.account.account_number}
                          label="계좌 복사"
                          tone="ink"
                        />
                      </>
                    ) : (
                      <span className="min-w-0 flex-1 text-xs font-semibold">
                        환급 계좌 미등록 · 카톡으로 정산해 주세요
                      </span>
                    )}
                    <Form method="post">
                      <input type="hidden" name="booking_id" value={b.id} />
                      <input type="hidden" name="reimbursed" value="true" />
                      <button className="btn-ink btn-sm" disabled={busy}>
                        <Check size={14} />
                        지급 완료
                      </button>
                    </Form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 내가 코트를 잡아 돌려받을 코트비 */}
      {myBookings.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-house-green/25 px-4 py-3 text-sm font-semibold">
          <Wallet size={16} className="shrink-0" />
          <span>
            총무가 보내 줄 코트비{" "}
            <strong className="font-extrabold">{won(myBookingTotal)}</strong>
          </span>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {myBookings
              .map((b) => `${shortDate(b.event_date)} ${b.gathering_title}`)
              .join(", ")}
          </span>
          {!myBookings[0].account?.account_number ? (
            <Link to="/app/mypage" className="text-link ml-auto !min-h-0">
              환급 계좌 등록하기
            </Link>
          ) : null}
        </p>
      ) : null}

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
                      {isClubKind(d.kind) ? (
                        <span className="chip-white">게스트비</span>
                      ) : null}
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
            sub={`참가비·게스트비가 있는 모임 ${summary.gatherings.length}건 기준`}
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
                      <span className={KIND_BADGE[g.kind]}>
                        {KIND_LABEL[g.kind]}
                      </span>
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
                    {shortDate(g.event_date)} ·{" "}
                    {isClubKind(g.kind)
                      ? `게스트 1인 ${won(g.guest_fee)}`
                      : `총 ${won(g.fee)} · 1인 ${won(g.per_person)}`}{" "}
                    · 입금 {g.paid_count}/{g.payer_count}명
                  </p>
                </div>
                {g.payer_count > 0 && g.payer_count <= 20 ? (
                  <div className="seg">
                    {Array.from({ length: g.payer_count }, (_, i) => (
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
                    {lineNames(
                      g.dues,
                      isClubKind(g.kind) ? g.guest_fee : g.per_person
                    )}
                  </p>
                ) : g.payer_count > 0 ? (
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

      {/* 이 달 오테식 모임의 회비 지출 (코트비) */}
      {summary.court_bookings.length > 0 ? (
        <section className="card">
          <SectionHeading
            title={`${Number(mm)}월 회비 지출`}
            sub={`오테식 정모·벙개 코트비 · 지급 ${won(
              summary.court_reimbursed
            )} · 대기 ${won(summary.court_pending)}`}
            action={
              <strong className="shrink-0 font-display text-[22px] font-extrabold tracking-[-0.04em]">
                {won(summary.court_total)}
              </strong>
            }
          />
          <ul className="mt-3">
            {summary.court_bookings.map((b) => (
              <li key={b.id} className="court-expense-row">
                <span className="w-10 shrink-0 font-display text-sm font-extrabold">
                  {shortDate(b.event_date)}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/app/gatherings/${b.gathering_id}?from=${b.event_date}`}
                    className="block truncate text-sm font-bold hover:underline"
                  >
                    {b.gathering_title}
                  </Link>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {b.booker.name}
                    {b.court_label ? ` · ${b.court_label}` : ""}
                  </span>
                </span>
                <strong className="shrink-0 text-sm">{won(b.amount)}</strong>
                <span
                  className={`shrink-0 ${
                    b.reimbursed ? "badge-ink" : "badge-line"
                  }`}
                >
                  {b.reimbursed ? "지급" : "대기"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-center text-xs font-semibold text-slate-400">
        입금·환불은 각 모임의 ‘참가비 정산’, 코트비 지급은 오테식 모임의 ‘회비
        지출’에서도 할 수 있어요.
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
