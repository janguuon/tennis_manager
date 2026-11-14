import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const COLORS = ["#F5CD52", "#5276DB", "#F18A58", "#9ABB88", "#C1ACE0", "#E8EDA2"];
const SHOW_MS = 4800;

// 조각마다 정해진 0~1 값. 칸(n)마다 따로 흩어져야 위치·지연이 한 줄로 엮이지 않는다
const rand = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** 폭죽: 화면 위쪽 여기저기서 차례로 터진다 [가로 %, 세로 %, 지연 초] */
const BURSTS: [number, number, number][] = [
  [22, 26, 0.15],
  [76, 20, 0.6],
  [50, 38, 1.05],
  [30, 48, 1.5],
  [70, 44, 1.9],
];
const SPARKS = 18;

/**
 * 축하 효과: 꽃가루가 화면 위에서 떨어지고(confetti), fireworks 면 폭죽도 터진다. 5초쯤 뒤 사라진다.
 * - storageKey 를 주면 이 기기에서 처음 한 번만 (없으면 붙을 때마다).
 * - 움직임 줄이기 설정이면 띄우지 않는다.
 * - 화면 전체를 덮지만 누르기는 막지 않는다.
 * - inDialog: 팝업(<dialog>) 안에 넣을 때. 팝업은 화면 맨 위 층에 그려져서 body 에 붙이면 팝업 뒤로 숨는다.
 *   팝업이 올라오는 움직임(0.22초)이 끝난 뒤에 띄운다.
 */
export function Celebration({
  storageKey,
  fireworks = false,
  inDialog = false,
}: {
  storageKey?: string;
  fireworks?: boolean;
  inDialog?: boolean;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (storageKey) {
      try {
        if (localStorage.getItem(storageKey)) return;
        localStorage.setItem(storageKey, "1");
      } catch {
        // 저장소를 못 쓰면 매번 보여도 괜찮다
      }
    }
    const start = setTimeout(() => setShow(true), inDialog ? 300 : 0);
    const stop = setTimeout(() => setShow(false), (inDialog ? 300 : 0) + SHOW_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [storageKey, inDialog]);
  if (!show) return null;

  const layer = (
    <div className="celebration" aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => (
        <span
          key={`c${i}`}
          className="confetti-piece"
          style={
            {
              left: `${rand(i, 1) * 100}%`,
              background: COLORS[i % COLORS.length],
              animationDelay: `${rand(i, 2) * 0.9}s`,
              animationDuration: `${2.4 + rand(i, 3) * 1.6}s`,
              "--dx": `${(rand(i, 4) - 0.5) * 160}px`,
              "--rot": `${rand(i, 5) * 720 - 360}deg`,
            } as CSSProperties
          }
        />
      ))}
      {fireworks
        ? BURSTS.map(([x, y, delay], b) => (
            <span key={`f${b}`} className="firework" style={{ left: `${x}%`, top: `${y}%` }}>
              {Array.from({ length: SPARKS }, (_, i) => {
                const angle = (i / SPARKS) * Math.PI * 2;
                const reach = 70 + rand(i + b * SPARKS, 6) * 50;
                return (
                  <i
                    key={i}
                    style={
                      {
                        background: COLORS[(i + b) % COLORS.length],
                        animationDelay: `${delay}s`,
                        "--x": `${Math.cos(angle) * reach}px`,
                        // 끝에서 살짝 아래로 처진다
                        "--y": `${Math.sin(angle) * reach + 24}px`,
                      } as CSSProperties
                    }
                  />
                );
              })}
            </span>
          ))
        : null}
    </div>
  );
  // 팝업 안에서는 그 자리에 (fixed 라 화면 전체를 덮는다), 아니면 부모에 갇히지 않게 body 로
  return inDialog ? layer : createPortal(layer, document.body);
}
