import { useLocation, useNavigate } from "@remix-run/react";
import { useEffect, useRef } from "react";

// 이만큼(px) 밀면 넘어간다. 짧아도 빠르게 튕기면(FLICK_MS 안에 FLICK_PX 이상) 넘어간다.
const THRESHOLD = 80;
const FLICK_PX = 40;
const FLICK_MS = 250;
// 화면 가장자리에서 시작한 터치는 브라우저의 뒤로 가기 몸짓에 맡긴다
const EDGE = 24;
// 넘어가는 동안 내용이 밀려나는 거리
const OUT = 48;

/** 가로로 스크롤되는 영역·입력칸 안에서 시작한 터치는 그 영역의 몫이다 */
function ignored(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches("input, textarea, select, [contenteditable], [data-no-swipe]")) return true;
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX } = getComputedStyle(el);
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
  }
  return false;
}

/**
 * 휴대폰에서 좌우로 밀어 이전·다음으로 넘기기: 왼쪽으로 밀면 다음(next), 오른쪽으로 밀면 이전(prev).
 * 손가락을 따라 내용이 밀리고, 넘어가면 새 내용이 반대쪽에서 들어온다. 넘어갈 곳이 없으면 살짝만 밀리고 돌아온다.
 * 돌려준 ref를 밀릴 영역(div)에 단다. 세로 스크롤·가로 스크롤 영역·입력칸·글자 선택은 방해하지 않는다.
 */
export function useSwipeNav(
  prev: string | null,
  next: string | null,
  { preventScrollReset = false }: { preventScrollReset?: boolean } = {}
) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { key } = useLocation();
  const links = useRef({ prev, next, preventScrollReset });
  links.current = { prev, next, preventScrollReset };
  // 넘어가는 중인 방향과, 새 내용을 기다리며 밀려나 있는 애니메이션
  const going = useRef<"prev" | "next" | null>(null);
  const held = useRef<Animation | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let start: { x: number; y: number; t: number } | null = null;
    let dragging = false;
    let shift = 0;

    const reset = () => {
      start = null;
      dragging = false;
      if (shift) {
        el.style.transform = "";
        if (!still.matches)
          el.animate([{ transform: `translateX(${shift}px)` }, { transform: "none" }], {
            duration: 200,
            easing: "ease-out",
          });
      }
      shift = 0;
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1 || going.current) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
      if (ignored(e.target, el) || !document.getSelection()?.isCollapsed) return;
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) return reset();
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        // 세로로 더 움직였으면 스크롤이다
        if (Math.abs(dx) < Math.abs(dy) * 1.5) {
          start = null;
          return;
        }
        dragging = true;
      }
      const can = dx < 0 ? links.current.next : links.current.prev;
      shift = Math.round(dx * (can ? 0.6 : 0.15));
      if (!still.matches) el.style.transform = `translateX(${shift}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || !dragging) {
        start = null;
        return;
      }
      const dx = e.changedTouches[0].clientX - start.x;
      const flick = Math.abs(dx) > FLICK_PX && e.timeStamp - start.t < FLICK_MS;
      const dir = dx < 0 ? "next" : "prev";
      const to = links.current[dir];
      if (!to || (Math.abs(dx) < THRESHOLD && !flick)) return reset();
      start = null;
      dragging = false;
      going.current = dir;
      el.style.transform = "";
      if (!still.matches)
        held.current = el.animate(
          [
            { transform: `translateX(${shift}px)` },
            { transform: `translateX(${dir === "next" ? -OUT : OUT}px)`, opacity: 0.35 },
          ],
          { duration: 160, easing: "ease-out", fill: "forwards" }
        );
      shift = 0;
      navigate(to, { preventScrollReset: links.current.preventScrollReset });
      // 넘어가지 못했으면(오류 등) 밀려난 채로 두지 않는다
      setTimeout(() => {
        if (going.current !== dir) return;
        held.current?.cancel();
        held.current = null;
        going.current = null;
      }, 6000);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", reset);
    };
  }, [navigate]);

  // 넘어가면 새 내용이 반대쪽에서 들어온다
  useEffect(() => {
    const el = ref.current;
    const dir = going.current;
    going.current = null;
    held.current?.cancel();
    held.current = null;
    if (!el || !dir || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: `translateX(${dir === "next" ? OUT : -OUT}px)`, opacity: 0.35 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: "ease-out" }
    );
  }, [key]);

  return ref;
}
