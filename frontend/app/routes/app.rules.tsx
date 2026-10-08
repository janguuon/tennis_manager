import type { MetaFunction } from "@remix-run/node";
import { ArrowUpRight, PencilLine, Printer } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Eyebrow, SectionHeading } from "~/components/Club";
import { CopyButton } from "~/components/CopyButton";
import { PageBody, PageHeader } from "~/components/Page";
import {
  NOTICE_ITEMS,
  RULE_CHAPTERS,
  RULE_CHECKLIST,
  RULE_TAG_LEGEND,
  RULES_BASIS,
  RULES_META,
  RULES_NEWS,
  RULES_SUPPLEMENT,
  SEAT_EXAMPLES,
  SEAT_FLOW,
  rulesPlainText,
  splitRuleText,
  type RuleArticle,
  type RuleColor,
  type RuleTagKind,
} from "~/lib/rules";

export const meta: MetaFunction = () => [{ title: "회칙 · 오테식 매니저" }];

const TAG_CLASS: Record<RuleTagKind, string> = {
  existing: "badge-green",
  current: "badge-blue",
  proposal: "badge-gray",
  review: "badge-yellow",
};

const INDEX_CLASS: Record<RuleColor, string> = {
  blue: "bg-house-blue",
  yellow: "bg-house-yellow",
  orange: "bg-house-orange",
  green: "bg-house-green",
  lav: "bg-house-lav",
  ink: "bg-ink !text-white dark:ring-1 dark:ring-inset dark:ring-white/20",
  ball: "bg-house-ball",
};

/** "회칙 복사"용 전체 본문 */
const RULES_TEXT = rulesPlainText();

/** 목차: 장 → 부칙 → 부록 */
const TOC: { id: string; index: string; label: string; color: RuleColor }[] = [
  ...RULE_CHAPTERS.map((c) => ({
    id: c.id,
    index: c.index,
    label: c.title.replace(/^제\d+장\s*/, ""),
    color: c.color,
  })),
  { id: "supplement", index: "+", label: "부칙", color: "ball" },
  { id: "allocation", index: "A", label: "자리 배정 예시", color: "green" },
  { id: "checklist", index: "B", label: "확정 전 체크리스트", color: "yellow" },
];

/** 페이지 안 이동: 부드럽게 스크롤하고 키보드 포커스도 옮긴다. */
function jumpTo(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  const id = e.currentTarget.hash.slice(1);
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", `#${id}`);
}

function RuleText({ text }: { text: string }) {
  return (
    <>
      {splitRuleText(text).map((part, i) =>
        part.kind === "strong" ? (
          <strong key={i}>{part.text}</strong>
        ) : part.kind === "pending" ? (
          <mark key={i} className="rules-pending">
            {part.text}
          </mark>
        ) : (
          part.text
        )
      )}
    </>
  );
}

function RuleTags({ article }: { article: RuleArticle }) {
  return (
    <div className="flex flex-wrap gap-1">
      {article.tags.map(([kind, label], i) => (
        <span key={i} className={TAG_CLASS[kind]}>
          {label}
        </span>
      ))}
    </div>
  );
}

function ArticleCard({ article }: { article: RuleArticle }) {
  return (
    <article
      id={article.no ? `art-${article.no}` : undefined}
      tabIndex={-1}
      className="card rules-article"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <h3 className="min-w-0 flex-1 basis-60 text-[17px] font-bold leading-snug tracking-[-0.03em]">
          {article.no ? (
            <span className="mr-2 font-display text-[13px] font-extrabold text-slate-500 dark:text-slate-400">
              제{article.no}조
            </span>
          ) : null}
          {article.title}
        </h3>
        <RuleTags article={article} />
      </div>
      <ol className="rules-clauses">
        {article.clauses.map((clause, i) => (
          <li key={i}>
            <span aria-hidden="true">{i + 1}</span>
            <p>
              <RuleText text={clause} />
            </p>
          </li>
        ))}
      </ol>
      {article.note ? (
        <div className="rules-note">
          <span>
            <PencilLine size={12} />
            검토 메모
          </span>
          <p>{article.note}</p>
        </div>
      ) : null}
    </article>
  );
}

function ChapterHead({
  id,
  index,
  eyebrow,
  title,
  sub,
  color,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  sub: string;
  color: RuleColor;
}) {
  return (
    <header className="rules-chapter-head">
      <span className={`rules-index ${INDEX_CLASS[color]}`} aria-hidden="true">
        {index}
      </span>
      <div className="min-w-0">
        <p className="eyebrow text-slate-500 dark:text-slate-400">{eyebrow}</p>
        <h2 id={`${id}-title`} className="rules-chapter-title">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {sub}
        </p>
      </div>
    </header>
  );
}

/** 자리 하나 = 점 하나: 정회원 우선 자리 → 공통 자리 순 */
function Seats({
  member,
  open,
  large = false,
}: {
  member: number;
  open: number;
  large?: boolean;
}) {
  return (
    <span
      className={`rules-seats ${large ? "rules-seats-lg" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: member }, (_, i) => (
        <i key={`m${i}`} className="rules-seat-member" />
      ))}
      {Array.from({ length: open }, (_, i) => (
        <i key={`o${i}`} className="rules-seat-open" />
      ))}
    </span>
  );
}

function MetricTile({
  tone,
  eyebrow,
  label,
  href,
  children,
  desc,
}: {
  tone: string;
  eyebrow: string;
  label: string;
  href: string;
  children: ReactNode;
  desc: ReactNode;
}) {
  return (
    <a href={href} onClick={jumpTo} className={`${tone} rules-metric`}>
      <span className="flex items-center justify-between gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <ArrowUpRight size={16} className="shrink-0 opacity-70" />
      </span>
      <span className="mt-4 block text-xs font-semibold">{label}</span>
      {children}
      <span className="mt-auto block pt-3 text-[11px] leading-relaxed opacity-80 sm:text-xs">
        {desc}
      </span>
    </a>
  );
}

export default function RulesPage() {
  const [active, setActive] = useState<string | null>(null);
  const tocRef = useRef<HTMLElement>(null);

  // 지금 읽고 있는 장을 목차에 표시
  useEffect(() => {
    const sections = TOC.map((t) => document.getElementById(t.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4;
      let current: string | null = null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 120) current = section.id;
      }
      setActive(
        atBottom && current ? sections[sections.length - 1].id : current
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // 모바일 가로 목차: 현재 장이 보이도록 옆으로 민다
  useEffect(() => {
    const nav = tocRef.current;
    const link = nav?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: link.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  // 다크 모드에서도 인쇄는 밝은 화면 기준으로
  useEffect(() => {
    const root = document.documentElement;
    let restoreDark = false;
    const before = () => {
      if (!root.classList.contains("dark")) return;
      restoreDark = true;
      root.classList.remove("dark");
    };
    const after = () => {
      if (!restoreDark) return;
      restoreDark = false;
      root.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <PageBody>
      <PageHeader
        eyebrow="PLAY FAIR, PLAY TOGETHER."
        title="오테식 기본 회칙"
        sub={`6장 · 22조와 부칙으로 정리한 검토용 초안 ${RULES_META.version}이에요. 시행일은 ${RULES_META.effective}이에요.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="badge-yellow !h-8 px-3.5">
              검토용 초안 {RULES_META.version}
            </span>
            <CopyButton text={RULES_TEXT} label="회칙 복사" />
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => window.print()}
            >
              <Printer size={14} />
              인쇄
            </button>
          </div>
        }
      />

      <div className="rules-metrics" aria-label="주요 운영 기준">
        <MetricTile
          tone="tile-ink"
          eyebrow="CAPACITY"
          label="코트 1면 · 참가 정원"
          href="#art-10"
          desc="운영진·정회원·게스트 모두 포함"
        >
          <span className="rules-metric-value text-house-yellow">
            최대 6<small>명</small>
          </span>
        </MetricTile>
        <MetricTile
          tone="tile-green"
          eyebrow="SEATS · 4 + 2"
          label="자리 배분 · 이번 운영안"
          href="#allocation"
          desc={
            <>
              <strong>정회원 우선 4 + 공통 2</strong>
              <br />
              우선 신청 마감 후 잔여 자리 개방
            </>
          }
        >
          <span className="mt-3 block">
            <Seats member={4} open={2} />
          </span>
        </MetricTile>
        <MetricTile
          tone="tile-yellow"
          eyebrow="MONTHLY DUES"
          label="정회원 월 회비"
          href="#art-15"
          desc="매월 1일 · 첫 납부 기한 별도"
        >
          <span className="rules-metric-value">
            20,000<small>원</small>
          </span>
        </MetricTile>
        <MetricTile
          tone="tile-lav"
          eyebrow="GUEST FEE"
          label="게스트 기본 참가비"
          href="#art-17"
          desc="일정 1회 기준 · 시간·예외 확인"
        >
          <span className="rules-metric-value">
            5,000<small>원</small>
          </span>
        </MetricTile>
      </div>

      <div className="rules-intro">
        <section className="tile-orange">
          <Eyebrow>WHAT&apos;S NEW · {RULES_META.version}</Eyebrow>
          <h2 className="tile-title mt-4">이번 버전에 반영했어요</h2>
          <p className="tile-sub">
            그 밖의 노란색 표시 항목은 아직 검토가 필요해요.
          </p>
          <ul className="tile-rows mt-3">
            {RULES_NEWS.map((item) => (
              <li key={item.label} className="!p-0">
                <a
                  href={item.href}
                  onClick={jumpTo}
                  className="flex w-full items-center gap-3 py-3 hover:underline hover:underline-offset-4"
                >
                  <strong className="w-[72px] shrink-0 text-[13px]">
                    {item.label}
                  </strong>
                  <span className="min-w-0 flex-1 text-[13px]">
                    {item.text}
                  </span>
                  <ArrowUpRight size={15} className="shrink-0 opacity-60" />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="card flex flex-col">
          <SectionHeading
            title="이렇게 읽어요"
            sub="조항마다 어디서 온 내용인지 표시했어요."
          />
          <ul className="mt-4">
            {RULE_TAG_LEGEND.map((tag) => (
              <li key={tag.kind} className="rules-legend-row">
                <span className={TAG_CLASS[tag.kind]}>{tag.label}</span>
                <span>{tag.desc}</span>
              </li>
            ))}
            <li className="rules-legend-row">
              <mark className="rules-pending">확정 필요</mark>
              <span>아직 정하지 않은 내용이에요</span>
            </li>
            <li className="rules-legend-row">
              <span className="flex h-6 items-center gap-1.5 text-[11px] font-bold text-[#8A6418] dark:text-house-yellow">
                <PencilLine size={12} />
                검토 메모
              </span>
              <span>작성 근거와 남은 쟁점이에요</span>
            </li>
          </ul>
          <a
            href="#checklist"
            onClick={jumpTo}
            className="btn-secondary mt-auto w-full justify-between print:hidden"
          >
            확정 전 체크리스트 {RULE_CHECKLIST.length}개
            <ArrowUpRight size={16} />
          </a>
        </section>
      </div>

      <div className="rules-layout">
        <nav ref={tocRef} aria-label="회칙 목차" className="rules-toc">
          <p className="eyebrow mb-2 hidden px-2.5 text-slate-500 dark:text-slate-400 xl:block">
            CONTENTS
          </p>
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={jumpTo}
              aria-current={active === item.id ? "location" : undefined}
              className={active === item.id ? "is-current" : ""}
            >
              <span className={`rules-toc-index ${INDEX_CLASS[item.color]}`}>
                {item.index}
              </span>
              {item.label}
            </a>
          ))}
          <p className="mt-6 hidden border-t border-slate-200 px-2.5 pt-4 text-[11px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 xl:block">
            검토 메모도 함께 읽어 주세요. 회칙을 복사하면 확정 필요 표시가 〔
            〕로 함께 남아요.
          </p>
        </nav>

        <div className="min-w-0 space-y-12">
          {RULE_CHAPTERS.map((chapter) => (
            <section
              key={chapter.id}
              id={chapter.id}
              tabIndex={-1}
              aria-labelledby={`${chapter.id}-title`}
              className="rules-section"
            >
              <ChapterHead
                id={chapter.id}
                index={chapter.index}
                eyebrow={`CHAPTER ${chapter.index}`}
                title={chapter.title}
                sub={chapter.sub}
                color={chapter.color}
              />
              <div className="space-y-3">
                {chapter.articles.map((article) => (
                  <ArticleCard key={article.no} article={article} />
                ))}
              </div>
            </section>
          ))}

          <section
            id="supplement"
            tabIndex={-1}
            aria-labelledby="supplement-title"
            className="rules-section"
          >
            <ChapterHead
              id="supplement"
              index="+"
              eyebrow="SUPPLEMENTARY PROVISIONS"
              title="부칙"
              sub="시행, 최초 납부 및 기존 회원 적용"
              color="ball"
            />
            <ArticleCard article={RULES_SUPPLEMENT} />
          </section>

          <section
            id="allocation"
            tabIndex={-1}
            aria-labelledby="allocation-title"
            className="card rules-section"
          >
            <p className="eyebrow text-slate-500 dark:text-slate-400">
              APPENDIX A · 운영안 해설
            </p>
            <h2 id="allocation-title" className="rules-appendix-title">
              4 + 2, 이렇게 배정합니다.
            </h2>
            <p className="rules-appendix-sub">
              공통 2자리는 게스트 전용이 아닙니다. 정회원은 최대 6명까지 참가할
              수 있고, 우선 자리의 잔여분을 개방하면 게스트도 2명보다 많이
              참가할 수 있습니다.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="tile-green">
                <strong className="text-base">정회원 우선 · 4자리</strong>
                <span className="mt-3 block">
                  <Seats member={4} open={0} large />
                </span>
                <p className="mt-3 text-xs leading-relaxed">
                  운영진도 정회원과 같은 기준으로 신청
                  <br />
                  운영진 전용 또는 별도 추가 자리 없음
                </p>
              </div>
              <div className="tile-yellow">
                <strong className="text-base">공통 신청 · 2자리</strong>
                <span className="mt-3 block">
                  <Seats member={0} open={2} large />
                </span>
                <p className="mt-3 text-xs leading-relaxed">
                  정회원과 게스트 모두 신청 가능
                  <br />
                  게스트 2명 보장 또는 상한을 뜻하지 않음
                </p>
              </div>
            </div>

            <ol className="rules-flow">
              {SEAT_FLOW.map((step, i) => (
                <li key={step} className={i === 2 ? "is-key" : ""}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              배정 예시의 전제: 접수순 운영안을 채택한 경우이며, 이미 확정한
              참가자를 뒤늦은 신청자 때문에 교체하지 않습니다.
            </p>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold">최종 구성 예시</h3>
              <span className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <i className="rules-dot-member" /> 정회원
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="rules-dot-guest" /> 게스트
                </span>
              </span>
            </div>
            <ul className="mt-2">
              {SEAT_EXAMPLES.map((ex) => (
                <li key={ex.members} className="rules-example">
                  <span className="rules-example-dots" aria-hidden="true">
                    {Array.from({ length: ex.members }, (_, i) => (
                      <i key={`m${i}`} className="rules-dot-member" />
                    ))}
                    {Array.from({ length: ex.guests }, (_, i) => (
                      <i key={`g${i}`} className="rules-dot-guest" />
                    ))}
                  </span>
                  <strong>
                    정회원 {ex.members} · 게스트 {ex.guests}
                  </strong>
                  <p>{ex.when}</p>
                  <b>{ex.members + ex.guests}명</b>
                </li>
              ))}
            </ul>

            <h3 className="mt-7 text-sm font-bold">
              운영 공지에 꼭 들어갈 내용
            </h3>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {NOTICE_ITEMS.map((item) => (
                <li key={item} className="badge-line">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section
            id="checklist"
            tabIndex={-1}
            aria-labelledby="checklist-title"
            className="tile-yellow rules-section"
          >
            <Eyebrow>APPENDIX B · 확정 전 검토</Eyebrow>
            <h2 id="checklist-title" className="rules-appendix-title">
              최종 공지 전에 결정할 사항
            </h2>
            <p className="mt-2 text-sm leading-relaxed">
              아래 항목은 이번 초안에서 임의로 정하지 않았습니다. 항목을 누르면
              관련 조항으로 이동합니다.
            </p>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {RULE_CHECKLIST.map((item) => (
                <li key={item.title}>
                  <a href={item.href} onClick={jumpTo} className="rules-check">
                    <span className="min-w-0 flex-1">
                      <strong>{item.title}</strong>
                      <span>{item.desc}</span>
                    </span>
                    <ArrowUpRight size={17} className="shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="basis-title"
            className="space-y-1.5 px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
          >
            <h2
              id="basis-title"
              className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300"
            >
              작성 근거와 범위
            </h2>
            {RULES_BASIS.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <p className="pt-2 font-semibold">
              검토용 초안 {RULES_META.version} · {RULES_META.updated} 정리 ·
              시행일 {RULES_META.effective}
            </p>
          </section>
        </div>
      </div>
    </PageBody>
  );
}
