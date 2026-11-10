import { Link } from "@remix-run/react";
import { ChevronRight, Handshake, Trophy } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { EmblemBadge } from "~/components/Logo";
import { courtName, OURS_LABEL, opponentLabel, resultLabel } from "~/lib/exchange";
import type { ExchangeDetail } from "~/lib/types";

/** 큰 점수판: 오테식 승수 : 상대 승수 (게임 수 합, 무승부, 남은 경기) */
export function ExchangeScoreboard({ x, compact = false }: { x: ExchangeDetail; compact?: boolean }) {
  const opponent = opponentLabel(x);
  const left = x.total - x.played;
  const side = (label: string, wins: number, games: number, won: boolean, tile: string) => (
    <div className={`${tile} flex flex-col items-center justify-center text-center ${compact ? "!p-3" : "!py-5"}`}>
      {won ? (
        <span className="chip-ink mb-1">
          <Trophy size={12} /> 승리
        </span>
      ) : null}
      <span className="max-w-full truncate text-[13px] font-bold">{label}</span>
      <strong className={`font-display font-extrabold ${compact ? "text-4xl" : "text-5xl"}`}>{wins}</strong>
      <span className="text-xs font-semibold opacity-75">게임 {games}</span>
    </div>
  );
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-3" aria-label="교류전 점수">
      {side(OURS_LABEL, x.score.ours_wins, x.score.ours_games, x.winner === "ours", "team-card-blue")}
      <div className="flex flex-col items-center justify-center gap-0.5 text-center text-xs font-semibold text-slate-500">
        <span className="font-display text-2xl text-slate-400">:</span>
        {x.score.draws ? <span>무 {x.score.draws}</span> : null}
        {x.total && !x.winner ? <span>{left ? `남은 ${left}` : "모두 끝"}</span> : null}
      </div>
      {side(opponent, x.score.theirs_wins, x.score.theirs_games, x.winner === "theirs", "team-card-white")}
    </section>
  );
}

/** 마친 교류전 결과 띠: 오테식 승·무승부는 축하(꽃가루 한 번), 상대 승은 수고 인사 */
export function ExchangeResultBanner({ x }: { x: ExchangeDetail }) {
  if (!x.winner) return null;
  const opponent = opponentLabel(x);
  const win = x.winner === "ours";
  return (
    <section className={`${x.winner === "theirs" ? "tile-blue" : "tile-yellow"} space-y-3`}>
      {x.winner !== "theirs" ? <Confetti storageKey={`exchange-confetti-${x.gathering_id}-${x.finished_at}`} /> : null}
      <div className="flex items-center gap-4">
        <EmblemBadge className="h-14 w-14 !rounded-2xl !ring-ink/15" />
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1">
            <Trophy size={12} /> FINAL
          </p>
          <p className="tile-title">
            {win ? "🎉 " : ""}
            {resultLabel(x.winner, opponent)}
            {x.winner === "theirs" ? "" : "!"}
          </p>
          <p className="tile-sub">
            {win
              ? `${OURS_LABEL} 여러분, 축하해요! 모두 수고 많으셨어요.`
              : x.winner === "draw"
              ? "두 클럽 모두 멋진 경기였어요. 수고 많으셨어요!"
              : `아쉽지만 모두 수고 많으셨어요! ${opponent}의 승리도 축하해요.`}
          </p>
        </div>
      </div>
      <p className="text-[13px] font-semibold">
        {OURS_LABEL} {x.score.ours_wins}승 · {opponent} {x.score.theirs_wins}승
        {x.score.draws ? ` · 무승부 ${x.score.draws}` : ""} (게임 {x.score.ours_games}:{x.score.theirs_games})
      </p>
      {x.mvp.length ? (
        <p className="text-[13px] font-semibold">
          오늘의 MVP <strong className="font-extrabold">{x.mvp.map((u) => u.name).join(", ")}</strong>
        </p>
      ) : null}
    </section>
  );
}

const CONFETTI_COLORS = ["#F5CD52", "#5276DB", "#F18A58", "#9ABB88", "#C1ACE0", "#252722"];

/** 꽃가루: 이 기기에서 처음 볼 때 한 번만 (움직임 줄이기 설정이면 띄우지 않는다) */
export function Confetti({ storageKey }: { storageKey: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (localStorage.getItem(storageKey)) return;
      localStorage.setItem(storageKey, "1");
    } catch {
      // 저장소를 못 쓰면 매번 보여도 괜찮다
    }
    setShow(true);
    const timer = setTimeout(() => setShow(false), 4500);
    return () => clearTimeout(timer);
  }, [storageKey]);
  if (!show) return null;
  // 화면 전체에 뿌린다 (부모의 transform·overflow 에 갇히지 않게 body 로)
  return createPortal(
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => {
        // 조각마다 정해진 값 (매번 같은 모양이어도 괜찮다)
        const r = (n: number) => ((i * 9301 + n * 49297) % 233280) / 233280;
        return (
          <span
            key={i}
            style={
              {
                left: `${r(1) * 100}%`,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${r(2) * 0.9}s`,
                animationDuration: `${2.4 + r(3) * 1.6}s`,
                "--dx": `${(r(4) - 0.5) * 160}px`,
                "--rot": `${r(5) * 720 - 360}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * 일정 화면의 교류전 카드 (교류전 일정의 '오늘의 매치업' 자리).
 * 점수판과 라운드별 대진을 보여 주고, 회원에게는 교류전 화면으로 가는 버튼 (게스트는 보기만).
 */
export function ExchangeCard({ x, member }: { x: ExchangeDetail; member: boolean }) {
  const opponent = opponentLabel(x);
  const rounds = [...new Set(x.matches.map((m) => m.round_number))];
  return (
    <section className="card detail-draws space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-1.5">
            <Handshake size={18} /> 교류전 · {OURS_LABEL} 대 {opponent}
          </h2>
          <p className="tile-sub">
            {x.winner
              ? resultLabel(x.winner, opponent)
              : x.total
              ? `경기 ${x.total} · 점수 ${x.played}`
              : x.can_manage
              ? "교류전 화면에서 상대 선수를 넣고 대진을 짜요"
              : "아직 대진이 없어요"}
          </p>
        </div>
        {member ? (
          <Link to={`/app/exchanges/${x.gathering_id}`} className="btn-primary btn-sm">
            {x.can_manage ? "대진·점수 꾸리기" : "교류전 화면"} <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
      <ExchangeResultBanner x={x} />
      {x.total ? <ExchangeScoreboard x={x} compact /> : null}
      {rounds.length ? (
        <ol className="space-y-3">
          {rounds.map((r) => (
            <li key={r}>
              <p className="mb-1.5 text-[12px] font-extrabold text-slate-500">{r}라운드</p>
              <ul className="space-y-1.5">
                {x.matches
                  .filter((m) => m.round_number === r && m.ours.length)
                  .map((m) => (
                    <li
                      key={m.id}
                      className={`grid grid-cols-[64px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[13px] font-semibold dark:bg-slate-800 ${
                        m.canceled ? "text-slate-400 line-through" : ""
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-500">{courtName(x.court_numbers, m.court)}</span>
                      <span className={`truncate ${m.winner === 1 ? "font-extrabold" : ""}`}>
                        {m.ours.map((p) => p.name).join("·")}
                      </span>
                      <span className="font-display text-xs text-slate-500">
                        {m.canceled ? "취소" : m.recorded ? `${m.ours_score}:${m.theirs_score}` : "vs"}
                      </span>
                      <span className={`truncate text-right ${m.winner === 2 ? "font-extrabold" : ""}`}>
                        {m.theirs.map((p) => p.name).join("·")}
                      </span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
