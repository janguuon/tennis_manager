import { Fragment } from "react";

/**
 * 흐르는 소식 띠. 같은 내용을 두 번 이어 붙여 절반만큼 흘리면 끊김 없이 반복된다.
 * 움직임 줄이기 설정이면 멈춘 채로 보인다.
 */
export function Marquee({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const run = (copy: number) =>
    items.map((text, i) => (
      <Fragment key={`${copy}-${i}`}>
        <span>{text}</span>
        <span aria-hidden="true" className="text-house-yellow">
          {i % 2 === 0 ? "⚡" : "◆"}
        </span>
      </Fragment>
    ));
  return (
    <div className="overflow-hidden rounded-full bg-house-red" role="marquee" aria-label={items.join(", ")}>
      <div
        aria-hidden="true"
        className="flex w-max animate-marquee items-center gap-6 whitespace-nowrap py-2 pl-6 font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#FFC266] motion-reduce:animate-none"
      >
        {run(0)}
        {run(1)}
      </div>
    </div>
  );
}
