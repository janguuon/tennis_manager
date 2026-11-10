import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  isRouteErrorResponse,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "@remix-run/react";
import {
  CalendarDays,
  Check,
  ClipboardCopy,
  Handshake,
  MapPin,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MemberAvatar } from "~/components/Club";
import { ExchangeResultBanner, ExchangeScoreboard } from "~/components/ExchangeBoard";
import { Modal } from "~/components/Modal";
import { BackLink, PageBody, PageHeader } from "~/components/Page";
import { ApiError, api } from "~/lib/api.server";
import { genderShort } from "~/lib/club";
import { courtName, exchangeStatus, OURS_LABEL, opponentLabel, resultLabel } from "~/lib/exchange";
import { formatDate } from "~/lib/format";
import { requireMember } from "~/lib/guard.server";
import { requireToken } from "~/lib/session.server";
import {
  MATCH_TYPE_LABEL,
  type ExchangeDetail,
  type ExchangeMatch,
  type ExchangeOpponent,
  type ExchangeResult,
  type Gender,
} from "~/lib/types";

/**
 * 교류전 화면 (/app/exchanges/:id, id 는 교류전 일정 id).
 * 우리 팀(일정 참석자) · 상대 선수(이름·성별) → 코트 수 × 라운드 수로 대진 → 점수 → 마치기(결과 팝업).
 * 꾸리는 건 운영진, 점수는 운영진과 그 경기에 뛴 우리 선수가 적는다 (서버 routers/exchanges.py 와 같다).
 */
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.x.title ?? "교류전"} · 오테식 매니저` },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token } = await requireMember(request);
  try {
    const x = await api<ExchangeDetail>(`/exchanges/${params.id}`, { token });
    return json({ x });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      throw new Response(err.message, { status: err.status });
    }
    throw err;
  }
}

const ids = (values: FormDataEntryValue[]) => values.map(String).filter(Boolean).map(Number);
const num = (v: FormDataEntryValue | null) => Number(v || 0);

export async function action({ request, params }: ActionFunctionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const base = `/exchanges/${params.id}`;
  const match = formData.get("match_id");
  const opponent = formData.get("opponent_id");
  try {
    switch (intent) {
      case "opponent_name":
        await api(base, { method: "PATCH", token, body: { opponent_name: String(formData.get("opponent_name") ?? "") } });
        break;
      case "add_opponents":
        await api(`${base}/opponents`, { method: "POST", token, body: { text: String(formData.get("text") ?? "") } });
        break;
      case "opponent_gender":
        await api(`${base}/opponents/${opponent}`, {
          method: "PATCH",
          token,
          body: { gender: String(formData.get("gender") ?? "") || null },
        });
        break;
      case "remove_opponent":
        await api(`${base}/opponents/${opponent}`, { method: "DELETE", token });
        break;
      case "draw_all":
        await api(`${base}/draw`, {
          method: "POST",
          token,
          body: {
            court_count: num(formData.get("court_count")),
            rounds: num(formData.get("rounds")),
            mode: formData.get("mode") === "empty" ? "empty" : "auto",
          },
        });
        break;
      case "add_round":
        await api(`${base}/rounds`, {
          method: "POST",
          token,
          body: { mode: formData.get("mode") === "auto" ? "auto" : "empty" },
        });
        break;
      case "delete_round":
        await api(`${base}/rounds/${formData.get("round")}`, { method: "DELETE", token });
        break;
      case "draw_round":
        await api(`${base}/rounds/${formData.get("round")}/draw`, { method: "POST", token });
        break;
      case "lineup":
        await api(`${base}/matches/${match}`, {
          method: "PUT",
          token,
          body:
            formData.get("clear") === "1"
              ? { ours_ids: [], theirs_ids: [] }
              : { ours_ids: ids(formData.getAll("ours_id")), theirs_ids: ids(formData.getAll("theirs_id")) },
        });
        break;
      case "result":
        await api(`${base}/matches/${match}/result`, {
          method: "PUT",
          token,
          body: { ours_score: num(formData.get("ours_score")), theirs_score: num(formData.get("theirs_score")) },
        });
        break;
      case "delete_result":
        await api(`${base}/matches/${match}/result`, { method: "DELETE", token });
        break;
      case "cancel_match":
      case "restore_match":
        // 못 친 경기 취소·되돌리기 (점수판·남은 경기에서 빠진다)
        await api(`${base}/matches/${match}/cancel`, { method: intent === "cancel_match" ? "POST" : "DELETE", token });
        break;
      case "finish":
        await api(`${base}/finish`, {
          method: "POST",
          token,
          body: {
            winner: String(formData.get("winner") ?? "") || null,
            announce: formData.get("announce") === "1",
          },
        });
        break;
      case "reopen":
        await api(`${base}/finish`, { method: "DELETE", token });
        break;
      case "reset":
        await api(base, { method: "DELETE", token });
        break;
    }
    return json({ ok: true, error: null as string | null, at: Date.now() });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "처리하지 못했어요.";
    return json({ ok: false, error: message, at: Date.now() }, { status: 400 });
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <PageBody narrow>
      <PageHeader
        back={<BackLink to="/app/exchanges">교류전 목록</BackLink>}
        title="교류전을 열 수 없어요"
        sub={isRouteErrorResponse(error) ? String(error.data) : "잠시 뒤 다시 시도해 주세요."}
      />
    </PageBody>
  );
}

export default function ExchangePage() {
  const { x } = useLoaderData<typeof loader>();
  const opponent = opponentLabel(x);
  const status = exchangeStatus(x);
  const hasRecord = x.opponents.length > 0 || x.matches.length > 0 || !!x.winner;
  return (
    <PageBody>
      <PageHeader
        back={<BackLink to="/app/exchanges">교류전 목록</BackLink>}
        eyebrow="CLUB MATCH"
        title={x.title}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="badge-blue">
              {OURS_LABEL} vs {opponent}
            </span>
            <span className={status.badge}>{status.label}</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} /> {formatDate(x.event_date)}
              {x.start_time ? ` ${x.start_time.slice(0, 5)}` : ""}
              {x.end_time ? `~${x.end_time.slice(0, 5)}` : ""}
            </span>
            {x.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} /> {x.location}
              </span>
            ) : null}
            <Link to={`/app/gatherings/${x.gathering_id}`} className="font-bold underline underline-offset-2">
              일정 보기
            </Link>
          </span>
        }
        actions={
          x.can_manage && hasRecord ? (
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("교류전 기록(상대 명단·대진·점수·결과)을 모두 지울까요? 일정은 그대로예요.")) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="reset" />
              <button className="btn-ghost btn-sm">
                <Trash2 size={14} /> 기록 지우기
              </button>
            </Form>
          ) : null
        }
      />

      {x.canceled ? (
        <p className="alert-error">취소된 교류전이에요{x.cancel_reason ? ` (${x.cancel_reason})` : ""}. 대진과 점수는 볼 수만 있어요.</p>
      ) : null}
      <ExchangeResultBanner x={x} />
      {x.total || x.winner ? <ExchangeScoreboard x={x} /> : null}
      {x.can_manage && !x.canceled && (x.total > 0 || x.winner) ? <FinishPanel x={x} /> : null}

      <section className="grid gap-4 md:grid-cols-2">
        <OursCard x={x} />
        <TheirsCard x={x} />
      </section>

      <DrawSection x={x} />
      <ActionToast />
    </PageBody>
  );
}

/** 처리하지 못했을 때 화면 아래에 잠깐 띄운다 */
function ActionToast() {
  const actionData = useActionData<typeof action>();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!actionData?.error) return;
    setShown(actionData.error);
    const timer = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(timer);
  }, [actionData]);
  if (!shown) return null;
  return (
    <p
      role="alert"
      className="alert-error fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+92px)] z-30 mx-auto max-w-md shadow-pop md:bottom-8"
      onClick={() => setShown(null)}
    >
      {shown}
    </p>
  );
}

/** 이 폼을 보내는 중인지 (intent 와 대상 id 로) */
function useBusy(intent: string, key?: { name: string; value: number }) {
  const navigation = useNavigation();
  return (
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === intent &&
    (!key || navigation.formData?.get(key.name) === String(key.value))
  );
}

/** 보내기가 끝나면(성공) 한 번 부른다: 입력칸 비우기·창 닫기 */
function useAfterSubmit(intent: string, done: () => void) {
  const busy = useBusy(intent);
  const actionData = useActionData<typeof action>();
  const was = useRef(false);
  useEffect(() => {
    if (busy) was.current = true;
    else if (was.current) {
      was.current = false;
      if (actionData?.ok) done();
    }
  }, [busy, actionData, done]);
  return busy;
}

const record = (games: number, wins: number) => (games ? `${games}전 ${wins}승` : "");

// ---------------------------------------------------------------------------
// 마치기
// ---------------------------------------------------------------------------
function FinishPanel({ x }: { x: ExchangeDetail }) {
  const opponent = opponentLabel(x);
  const [changing, setChanging] = useState(false);
  const [pick, setPick] = useState<ExchangeResult | "">("");
  const [announce, setAnnounce] = useState(true);
  const busy = useAfterSubmit("finish", () => setChanging(false));
  const reopenBusy = useBusy("reopen");
  const left = x.total - x.played;
  const choices: [ExchangeResult | "", string][] = [
    ["", x.suggested_winner ? `점수대로 (${resultLabel(x.suggested_winner, opponent)})` : "점수대로"],
    ["ours", `${OURS_LABEL} 승`],
    ["theirs", `${opponent} 승`],
    ["draw", "무승부"],
  ];

  if (x.winner && !changing) {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title">교류전을 마쳤어요</h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            결과 ‘{resultLabel(x.winner, opponent)}’.{" "}
            {x.announced ? "회원이 앱에 들어오면 결과 팝업이 떠요 (2주)." : "결과 팝업은 띄우지 않았어요."} 마친 교류전은
            점수와 대진을 바꿀 수 없어요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setChanging(true)}>
            결과 바꾸기
          </button>
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm(`마치기를 취소할까요? 결과${x.announced ? "와 올린 결과 팝업" : ""}이 지워지고 점수를 다시 고칠 수 있어요.`))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="reopen" />
            <button className="btn-ghost btn-sm" disabled={reopenBusy}>
              마치기 취소
            </button>
          </Form>
        </div>
      </section>
    );
  }

  return (
    <Form
      method="post"
      className="card space-y-3"
      onSubmit={(e) => {
        const result = pick ? resultLabel(pick, opponent) : x.suggested_winner ? resultLabel(x.suggested_winner, opponent) : null;
        if (!result) {
          e.preventDefault();
          alert("점수가 들어간 경기가 없어요. 결과를 직접 골라 주세요.");
          return;
        }
        const ask = [
          `교류전을 '${result}'로 마칠까요?`,
          left > 0 && !x.winner ? `아직 점수가 없는 경기가 ${left}개 있어요.` : "",
          announce ? "회원이 앱에 들어오면 결과 팝업이 떠요." : "",
        ]
          .filter(Boolean)
          .join("\n");
        if (!confirm(ask)) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="finish" />
      <input type="hidden" name="winner" value={pick} />
      <input type="hidden" name="announce" value={announce ? "1" : ""} />
      <div>
        <h2 className="section-title">{x.winner ? "결과 바꾸기" : "교류전 마치기"}</h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          이긴 경기 수로 정하고, 같으면 딴 게임 수 합계, 그것도 같으면 무승부예요. 직접 고를 수도 있어요.
          {left > 0 ? ` 남은 경기 ${left}개.` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="결과">
        {choices.map(([value, label]) => (
          <button
            key={value || "auto"}
            type="button"
            role="radio"
            aria-checked={pick === value}
            className={pick === value ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setPick(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
        <input
          type="checkbox"
          className="h-4 w-4 accent-ink"
          checked={announce}
          onChange={(e) => setAnnounce(e.currentTarget.checked)}
        />
        회원들에게 결과 팝업 띄우기 (오테식 승·무승부는 축하, 지면 수고 인사)
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={busy}>
          {busy ? "저장 중…" : x.winner ? "결과 저장" : "교류전 마치기"}
        </button>
        {x.winner ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setChanging(false)}>
            취소
          </button>
        ) : null}
      </div>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// 팀 명단
// ---------------------------------------------------------------------------
function OursCard({ x }: { x: ExchangeDetail }) {
  return (
    <section className="tile-blue space-y-2">
      <div>
        <h2 className="tile-title !text-xl">
          {OURS_LABEL} {x.ours.length}명
        </h2>
        <p className="tile-sub">일정에 참석한 회원·초대 게스트예요. 명단은 일정 화면의 참석으로 바뀌어요.</p>
      </div>
      {x.ours.length === 0 ? (
        <p className="text-sm font-semibold">아직 참석한 사람이 없어요.</p>
      ) : (
        <ul>
          {x.ours.map(({ user, games, wins }) => (
            <li key={user.id} className="team-row">
              <MemberAvatar user={user} className="!h-8 !w-8 shrink-0 !text-xs" />
              <span className="min-w-0 truncate">{user.name}</span>
              {genderShort(user.gender) ? <span className="text-[12px] font-bold opacity-70">{genderShort(user.gender)}</span> : null}
              <span className="ml-auto shrink-0 text-[12px] font-bold opacity-80">{record(games, wins)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TheirsCard({ x }: { x: ExchangeDetail }) {
  const opponent = opponentLabel(x);
  const manage = x.can_manage && !x.canceled && !x.winner;
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState("");
  const renameBusy = useAfterSubmit("opponent_name", () => setRenaming(false));
  const addBusy = useAfterSubmit("add_opponents", () => setText(""));
  return (
    <section className="team-card-white space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="tile-title !text-xl">
            {opponent} {x.opponents.length}명
          </h2>
          <p className="tile-sub">상대 선수는 이름·성별만 적어요. 회비·참가비·출석과는 상관없어요.</p>
        </div>
        {manage && !renaming ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setRenaming(true)}>
            <Pencil size={13} /> 클럽 이름
          </button>
        ) : null}
      </div>
      {renaming ? (
        <Form method="post" className="flex gap-2">
          <input type="hidden" name="intent" value="opponent_name" />
          <input
            name="opponent_name"
            className="input !h-10"
            maxLength={50}
            defaultValue={x.opponent_name ?? ""}
            placeholder="상대 클럽 이름"
            aria-label="상대 클럽 이름"
            autoFocus
          />
          <button className="btn-primary btn-sm shrink-0" disabled={renameBusy}>
            저장
          </button>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setRenaming(false)}>
            취소
          </button>
        </Form>
      ) : null}
      {x.opponents.length ? (
        <ul>
          {x.opponents.map((o) => (
            <OpponentRow key={o.id} o={o} manage={manage} />
          ))}
        </ul>
      ) : (
        <p className="text-sm font-semibold text-slate-500">아직 상대 선수가 없어요.</p>
      )}
      {manage ? (
        <Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="add_opponents" />
          <label className="label" htmlFor="opponents_text">
            상대 선수 넣기
          </label>
          <textarea
            id="opponents_text"
            name="text"
            rows={3}
            required
            className="input"
            placeholder={"홍길동 남, 김영희 여\n박철수 남"}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <p className="text-xs font-medium text-slate-500">
            쉼표나 줄바꿈으로 여러 명을 한 번에 넣어요. 이름 뒤에 ‘남’·‘여’를 띄어 쓰면 성별로 읽어요.
          </p>
          <button className="btn-primary btn-sm" disabled={addBusy}>
            <UserPlus size={14} /> {addBusy ? "넣는 중…" : "넣기"}
          </button>
        </Form>
      ) : null}
    </section>
  );
}

function OpponentRow({ o, manage }: { o: ExchangeOpponent; manage: boolean }) {
  const busy = useBusy("opponent_gender", { name: "opponent_id", value: o.id });
  const gender = (value: Gender) => (
    <Form method="post">
      <input type="hidden" name="intent" value="opponent_gender" />
      <input type="hidden" name="opponent_id" value={o.id} />
      <input type="hidden" name="gender" value={o.gender === value ? "" : value} />
      <button
        className={`h-7 w-7 rounded-full text-[12px] font-bold ${
          o.gender === value ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-slate-300 text-slate-500"
        }`}
        aria-pressed={o.gender === value}
        aria-label={`${o.name} ${value === "male" ? "남성" : "여성"}`}
        disabled={busy}
      >
        {genderShort(value)}
      </button>
    </Form>
  );
  return (
    <li className="team-row !border-slate-200 dark:!border-slate-700">
      <span className="min-w-0 truncate">{o.name}</span>
      {manage ? (
        <span className="flex shrink-0 items-center gap-1">
          {gender("male")}
          {gender("female")}
        </span>
      ) : genderShort(o.gender) ? (
        <span className="text-[12px] font-bold text-slate-500">{genderShort(o.gender)}</span>
      ) : null}
      <span className="ml-auto shrink-0 text-[12px] font-bold text-slate-500">{record(o.games, o.wins)}</span>
      {manage ? (
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm(`${o.name} 님을 상대 명단에서 뺄까요? 점수 전 대진의 그 자리는 비워져요.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="remove_opponent" />
          <input type="hidden" name="opponent_id" value={o.id} />
          <button className="px-1 text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">빼기</button>
        </Form>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 대진
// ---------------------------------------------------------------------------
function DrawSection({ x }: { x: ExchangeDetail }) {
  const manage = x.can_manage && !x.canceled && !x.winner;
  const rounds = [...new Set(x.matches.map((m) => m.round_number))].sort((a, b) => a - b);
  const busy = useBusy("draw_all");
  const navigation = useNavigation();
  const busyMode = busy ? navigation.formData?.get("mode") : null;
  const [copied, setCopied] = useState(false);
  const anyRecorded = x.matches.some((m) => m.recorded);
  return (
    <section className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-1.5">
            <Handshake size={18} /> 대진표
          </h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            {x.matches.length
              ? `${rounds.length}라운드 · 코트 ${Math.max(...x.matches.map((m) => m.court))}면. 이긴 경기마다 그 팀이 1승이에요. 점수는 운영진과 그 경기에 뛴 선수가 적어요.`
              : manage
              ? "코트 수와 라운드 수를 정하고 ‘자동으로 짜기’(덜 뛴 사람부터, 남복·여복·혼복끼리) 또는 ‘직접 짜기’(빈 표를 만들고 칸마다 선수를 넣어요)를 골라요."
              : "아직 대진이 없어요."}
          </p>
        </div>
        {x.matches.length ? (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(boardText(x));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                alert("복사하지 못했어요.");
              }
            }}
          >
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? "복사했어요" : "단톡방용 복사"}
          </button>
        ) : null}
      </div>

      {manage ? (
        <Form
          method="post"
          className="flex flex-wrap items-end gap-3 rounded-2xl bg-slate-100 p-4 dark:bg-slate-800"
          onSubmit={(e) => {
            const empty = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "empty";
            const ask = empty ? "지금 대진을 지우고 빈 대진표로 새로 만들까요?" : "지금 대진을 지우고 자동으로 새로 짤까요?";
            if (x.matches.length && !confirm(ask)) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="draw_all" />
          <div>
            <label className="label" htmlFor="court_count">
              코트 수
            </label>
            <input id="court_count" name="court_count" type="number" min="1" max="30" inputMode="numeric" required className="input !w-24" defaultValue={x.court_count} />
          </div>
          <div>
            <label className="label" htmlFor="rounds">
              라운드 수
            </label>
            <input id="rounds" name="rounds" type="number" min="1" max="12" inputMode="numeric" required className="input !w-24" defaultValue={x.rounds} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              name="mode"
              value="auto"
              className="btn-primary"
              disabled={busy || anyRecorded}
              title={anyRecorded ? "점수가 들어간 경기가 있어요" : undefined}
            >
              <Shuffle size={15} /> {busyMode === "auto" ? "짜는 중…" : x.matches.length ? "전체 자동으로 다시" : "자동으로 짜기"}
            </button>
            <button
              name="mode"
              value="empty"
              className="btn-ghost"
              disabled={busy || anyRecorded}
              title={anyRecorded ? "점수가 들어간 경기가 있어요" : undefined}
            >
              <Pencil size={15} /> {busyMode === "empty" ? "만드는 중…" : x.matches.length ? "빈 표로 다시" : "직접 짜기"}
            </button>
          </div>
          {anyRecorded ? (
            <p className="w-full text-xs font-medium text-slate-500">
              점수가 들어간 경기가 있어 전체는 다시 만들 수 없어요. 라운드별로 고치거나 라운드를 더해요.
            </p>
          ) : null}
        </Form>
      ) : null}

      {rounds.map((r) => (
        <Round key={r} x={x} round={r} manage={manage} />
      ))}

      {manage && rounds.length ? <AddRound rounds={rounds.length} /> : null}
    </section>
  );
}

/** 맨 뒤에 라운드 하나 더: 빈 칸(직접 넣기) 또는 자동으로 */
function AddRound({ rounds }: { rounds: number }) {
  const busy = useBusy("add_round");
  if (rounds >= 12) return null;
  return (
    <Form method="post" className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5 dark:border-slate-700">
      <input type="hidden" name="intent" value="add_round" />
      <span className="mr-1 text-[13px] font-bold">{rounds + 1}라운드 더하기</span>
      <button name="mode" value="empty" className="btn-ghost btn-sm" disabled={busy}>
        <Plus size={14} /> 빈 라운드
      </button>
      <button name="mode" value="auto" className="btn-ghost btn-sm" disabled={busy}>
        <Shuffle size={14} /> 자동 라운드
      </button>
    </Form>
  );
}

function boardText(x: ExchangeDetail) {
  const opponent = opponentLabel(x);
  const lines = [
    `🎾 ${x.title} 대진표 (${formatDate(x.event_date)}${x.start_time ? ` ${x.start_time.slice(0, 5)}` : ""})`,
    `${OURS_LABEL} vs ${opponent}`,
  ];
  for (const r of [...new Set(x.matches.map((m) => m.round_number))].sort((a, b) => a - b)) {
    lines.push("", `[${r}라운드]`);
    for (const m of x.matches.filter((m) => m.round_number === r && m.ours.length)) {
      const mid = m.canceled ? " (경기 취소) " : m.recorded ? ` ${m.ours_score}:${m.theirs_score} ` : " vs ";
      lines.push(
        `${courtName(x.court_numbers, m.court)}: ${m.ours.map((p) => p.name).join("·")}${mid}${m.theirs.map((p) => p.name).join("·")}`,
      );
    }
  }
  if (x.played) {
    lines.push("", `점수 ${OURS_LABEL} ${x.score.ours_wins} : ${x.score.theirs_wins} ${opponent}`);
  }
  return lines.join("\n");
}

function Round({ x, round, manage }: { x: ExchangeDetail; round: number; manage: boolean }) {
  const matches = x.matches.filter((m) => m.round_number === round);
  const busy = useBusy("draw_round", { name: "round", value: round });
  // 취소한 경기의 선수는 그 라운드에 쉬는 사람으로 본다
  const live = matches.filter((m) => !m.canceled);
  const playing = new Set(live.flatMap((m) => m.ours.map((p) => p.id)));
  const playingT = new Set(live.flatMap((m) => m.theirs.map((p) => p.id)));
  const resting = [
    ...x.ours.filter((p) => !playing.has(p.user.id)).map((p) => p.user.name),
    ...x.opponents.filter((o) => !playingT.has(o.id)).map((o) => `${o.name}(상대)`),
  ];
  const recorded = matches.some((m) => m.recorded);
  return (
    <div className="exchange-round">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-extrabold">{round}라운드</h3>
        {manage && !recorded ? (
          <span className="flex items-center gap-1">
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(`${round}라운드를 자동으로 다시 짤까요?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="draw_round" />
              <input type="hidden" name="round" value={round} />
              <button className="btn-ghost btn-sm" disabled={busy}>
                <Shuffle size={13} /> {busy ? "짜는 중…" : "자동으로 다시"}
              </button>
            </Form>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(`${round}라운드를 지울까요? 뒤 라운드 번호는 하나씩 당겨져요.`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete_round" />
              <input type="hidden" name="round" value={round} />
              <button className="px-1 text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">
                라운드 지우기
              </button>
            </Form>
          </span>
        ) : null}
      </div>
      <div className="exchange-courts">
        {matches.map((m) => (
          <MatchCard key={m.id} x={x} m={m} manage={manage} />
        ))}
      </div>
      {resting.length ? (
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">쉬는 사람: {resting.join(", ")}</p>
      ) : null}
    </div>
  );
}

function MatchCard({ x, m, manage }: { x: ExchangeDetail; m: ExchangeMatch; manage: boolean }) {
  const [editing, setEditing] = useState(false);
  const opponent = opponentLabel(x);
  const empty = !m.ours.length;
  const cancelBusy = useBusy(m.canceled ? "restore_match" : "cancel_match", { name: "match_id", value: m.id });
  const side = (label: string, chip: string, names: { id: number; name: string; absent?: boolean }[], won: boolean) => (
    <div className={`exchange-side ${!won && m.winner !== null ? "opacity-60" : ""} ${m.canceled ? "opacity-50" : ""}`}>
      <span className={`${chip} max-w-full truncate`}>
        {label}
        {won ? " 승" : ""}
      </span>
      {names.map((p) => (
        <span key={p.id} className="exchange-name">
          <span className="truncate">{p.name}</span>
          {p.absent ? <span className="badge-orange-soft shrink-0">불참</span> : null}
        </span>
      ))}
    </div>
  );
  return (
    <div className={`exchange-match ${empty || m.canceled ? "is-empty" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="badge-gray">
            {courtName(x.court_numbers, m.court)}
            {empty ? "" : ` · ${MATCH_TYPE_LABEL[m.match_type]}`}
          </span>
          {m.canceled ? <span className="badge-orange-soft shrink-0">경기 취소</span> : null}
        </span>
        {manage && !m.recorded && !empty && !m.canceled ? (
          <button type="button" className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
            선수 바꾸기
          </button>
        ) : null}
      </div>
      {empty ? (
        manage ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-4 text-[13px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setEditing(true)}
          >
            <UserPlus size={15} /> 선수 넣기
          </button>
        ) : (
          <p className="py-3 text-center text-[13px] font-medium text-slate-500">빈 코트</p>
        )
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            {side(
              OURS_LABEL,
              "team-chip-blue",
              m.ours.map((p) => ({ id: p.id, name: p.name, absent: m.absent_ids.includes(p.id) })),
              m.winner === 1,
            )}
            <span className="text-center font-display text-sm font-extrabold text-slate-400">
              {m.recorded ? `${m.ours_score}:${m.theirs_score}` : "VS"}
            </span>
            {side(opponent, "team-chip-white", m.theirs, m.winner === 2)}
          </div>
          {m.canceled ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">못 친 경기로 취소했어요. 점수판에 들어가지 않아요.</p>
              {manage ? (
                <Form method="post" className="ml-auto">
                  <input type="hidden" name="intent" value="restore_match" />
                  <input type="hidden" name="match_id" value={m.id} />
                  <button className="btn-ghost btn-sm" disabled={cancelBusy}>
                    취소 되돌리기
                  </button>
                </Form>
              ) : null}
            </div>
          ) : (
            <>
              <ScoreBox m={m} opponent={opponent} />
              {manage && !m.recorded ? (
                <Form
                  method="post"
                  className="-mt-1 flex justify-end"
                  onSubmit={(e) => {
                    if (!confirm("이 경기를 취소할까요? 못 친 경기로 남고 점수판·남은 경기에서 빠져요. 나중에 되돌릴 수 있어요."))
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="cancel_match" />
                  <input type="hidden" name="match_id" value={m.id} />
                  <button className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline" disabled={cancelBusy}>
                    경기 취소
                  </button>
                </Form>
              ) : null}
            </>
          )}
        </>
      )}
      {editing ? <LineupModal x={x} m={m} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** 점수 적기·고치기·지우기 (운영진과 그 경기에 뛴 우리 선수) */
function ScoreBox({ m, opponent }: { m: ExchangeMatch; opponent: string }) {
  const busy = useBusy("result", { name: "match_id", value: m.id });
  const [fixing, setFixing] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    if (busy) was.current = true;
    else if (was.current) {
      was.current = false;
      setFixing(false);
    }
  }, [busy]);
  if (!m.can_score) {
    return m.recorded ? null : <p className="text-center text-xs text-slate-500 dark:text-slate-400">경기 예정</p>;
  }
  if (m.recorded && !fixing) {
    return (
      <div className="flex items-center justify-end gap-1 border-t border-slate-200 pt-3 dark:border-slate-700">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setFixing(true)}>
          <Pencil size={13} /> 점수 고치기
        </button>
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("이 경기 점수를 지울까요?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete_result" />
          <input type="hidden" name="match_id" value={m.id} />
          <button className="px-1 text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline">지우기</button>
        </Form>
      </div>
    );
  }
  return (
    <Form method="post" className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <input type="hidden" name="intent" value="result" />
      <input type="hidden" name="match_id" value={m.id} />
      {(
        [
          ["ours_score", OURS_LABEL],
          ["theirs_score", opponent],
        ] as const
      ).map(([name, label], i) => (
        <span key={name} className="contents">
          {i === 1 ? <span className="text-slate-400">:</span> : null}
          <input
            name={name}
            type="number"
            min="0"
            max="99"
            required
            inputMode="numeric"
            className="input !w-14 !px-2 !py-1.5 text-center"
            placeholder="0"
            aria-label={`${label} 게임 수`}
            defaultValue={m.recorded ? m[name] ?? undefined : undefined}
          />
        </span>
      ))}
      {fixing ? (
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setFixing(false)}>
          취소
        </button>
      ) : null}
      <button className={`btn-primary btn-sm ${fixing ? "" : "ml-auto"}`} disabled={busy}>
        {busy ? "저장 중…" : fixing ? "저장" : "점수 적기"}
      </button>
    </Form>
  );
}

/** 대진 한 칸 선수 바꾸기: 우리 팀(참석자)·상대 선수에서 고른다. 같은 라운드에 이미 뛰는 사람은 표시 */
function LineupModal({ x, m, onClose }: { x: ExchangeDetail; m: ExchangeMatch; onClose: () => void }) {
  const [doubles, setDoubles] = useState(m.ours.length !== 1);
  const [ours, setOurs] = useState<string[]>([0, 1].map((i) => String(m.ours[i]?.id ?? "")));
  const [theirs, setTheirs] = useState<string[]>([0, 1].map((i) => String(m.theirs[i]?.id ?? "")));
  const busy = useAfterSubmit("lineup", onClose);
  const seats = doubles ? [0, 1] : [0];
  const same = x.matches.filter((o) => o.round_number === m.round_number && o.id !== m.id && !o.canceled);
  const busyOurs = new Set(same.flatMap((o) => o.ours.map((p) => p.id)));
  const busyTheirs = new Set(same.flatMap((o) => o.theirs.map((p) => p.id)));
  // 이 칸을 뺀 대진표 전체에서 넣은 경기 수 (고르게 넣도록 참고)
  const games = (side: "ours" | "theirs", id: number) =>
    x.matches.filter((o) => o.id !== m.id && !o.canceled && o[side].some((p) => p.id === id)).length;
  const picker = (
    name: "ours_id" | "theirs_id",
    values: string[],
    set: (v: string[]) => void,
    options: { id: number; label: string; busy: boolean }[],
    i: number,
    label: string,
  ): ReactNode => {
    const others = new Set(values.filter((v, j) => j !== i && j < seats.length && v));
    return (
      <select
        key={`${name}${i}`}
        name={name}
        required
        value={values[i]}
        onChange={(e) => {
          const value = e.currentTarget.value;
          set(values.map((v, j) => (j === i ? value : v)));
        }}
        className="input !h-10 !py-0 text-[13px] font-semibold"
        aria-label={`${label} ${i + 1}번`}
      >
        <option value="">{label} 선수</option>
        {options
          .filter((o) => !others.has(String(o.id)))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.busy ? " · 이 라운드 다른 코트에 있음" : ""}
            </option>
          ))}
      </select>
    );
  };
  const oursOptions = x.ours.map((p) => ({
    id: p.user.id,
    label: `${p.user.name}${genderShort(p.user.gender) ? ` (${genderShort(p.user.gender)})` : ""} · ${games("ours", p.user.id)}경기`,
    busy: busyOurs.has(p.user.id),
  }));
  const theirsOptions = x.opponents.map((o) => ({
    id: o.id,
    label: `${o.name}${genderShort(o.gender) ? ` (${genderShort(o.gender)})` : ""} · ${games("theirs", o.id)}경기`,
    busy: busyTheirs.has(o.id),
  }));
  return (
    <Modal title={`${m.round_number}라운드 · ${courtName(x.court_numbers, m.court)}`} onClose={onClose}>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="lineup" />
        <input type="hidden" name="match_id" value={m.id} />
        <div className="segmented">
          {[true, false].map((d) => (
            <button
              key={String(d)}
              type="button"
              className={`segmented-item ${doubles === d ? "segmented-item-active" : ""}`}
              onClick={() => setDoubles(d)}
            >
              {d ? "복식" : "단식"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-2">
          <div className="space-y-2">{seats.map((i) => picker("ours_id", ours, setOurs, oursOptions, i, OURS_LABEL))}</div>
          <span className="text-center font-display text-xs text-slate-400">VS</span>
          <div className="space-y-2">{seats.map((i) => picker("theirs_id", theirs, setTheirs, theirsOptions, i, "상대"))}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </button>
          {m.ours.length ? (
            <button
              name="clear"
              value="1"
              formNoValidate
              className="btn-ghost"
              disabled={busy}
            >
              빈 코트로
            </button>
          ) : null}
        </div>
      </Form>
    </Modal>
  );
}
