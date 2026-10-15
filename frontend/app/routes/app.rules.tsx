import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { ArrowUpRight, Printer } from "lucide-react";
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
import { requireMember } from "~/lib/guard.server";
import {
  NOTICE_ITEMS,
  articleId,
  articleLabel,
  RULE_CHAPTERS,
  RULES_HIGHLIGHTS,
  RULES_HISTORY,
  RULES_META,
  RULES_SUPPLEMENT,
  SEAT_EXAMPLES,
  SEAT_FLOW,
  rulesPlainText,
  splitRuleText,
  type RuleArticle,
  type RuleColor,
} from "~/lib/rules";

export const meta: MetaFunction = () => [{ title: "회칙 · 오테식 매니저" }];

// 게스트는 일정만 본다 → 회칙 화면은 캘린더로
export async function loader({ request }: LoaderFunctionArgs) {
  await requireMember(request);
  return null;
}

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

/** 회칙 구성: 장·조 수 */
// 가지 조(제11조의2 등)는 조 수에 세지 않는다 → "6장 22조"
const ARTICLE_COUNT = RULE_CHAPTERS.reduce(
  (n, c) => n + c.articles.filter((a) => !a.branch).length,
  0
);

/** 목차: 장 → 부칙 → 부록 */
const TOC: { id: string; index: string; label: string; color: RuleColor }[] = [
  ...RULE_CHAPTERS.map((c) => ({
    id: c.id,
    index: c.index,
    label: c.title.replace(/^제\d+장\s*/, ""),
    color: c.color,
  })),
  { id: "supplement", index: "+", label: "부칙", color: "ball" },
  { id: "allocation", index: "A", label: "자리 배정 해설", color: "green" },
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
        ) : (
          part.text
        )
      )}
    </>
  );
}

function ArticleCard({ article }: { article: RuleArticle }) {
  return (
    <article
      id={articleId(article)}
      tabIndex={-1}
      className="card rules-article"
    >
      <h3 className="text-[17px] font-bold leading-snug tracking-[-0.03em]">
        {article.no ? (
          <span className="mr-2 font-display text-[13px] font-extrabold text-slate-500 dark:text-slate-400">
            {articleLabel(article)}
          </span>
        ) : null}
        {article.title}
      </h3>
      <ol className="rules-clauses">
        {article.clauses.map((clause, i) => (
          <li key={i}>
            <span aria-hidden="true">{i + 1}</span>
            <p className="whitespace-pre-line">
              <RuleText text={clause} />
            </p>
          </li>
        ))}
      </ol>
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

/** 자리 하나 = 점 하나: 정회원 선착순 자리 → 게스트 투표로 열리는 자리 순 */
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
        title="오테식 회칙"
        sub={`${RULE_CHAPTERS.length}장 ${ARTICLE_COUNT}조와 부칙으로 이루어진 오테식 정식 회칙이에요. ${RULES_META.effective}부터 시행해요.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="badge-green !h-8 px-3.5">
              정식 {RULES_META.version}
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
          eyebrow="SEATS · FIRST COME"
          label="자리 배분 · 선착순"
          href="#allocation"
          desc={
            <>
              <strong>정회원 선착순</strong>
              <br />
              남은 자리는 3일 전 게스트 투표
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
          desc="매월 1일 · 가입한 달은 면제"
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
          desc="일정 1회 · 2~4시간 같음 · 공값 포함"
        >
          <span className="rules-metric-value">
            5,000<small>원</small>
          </span>
        </MetricTile>
      </div>

      <div className="rules-intro">
        <section className="tile-orange">
          <Eyebrow>KEY RULES</Eyebrow>
          <h2 className="tile-title mt-4">꼭 알아 두세요</h2>
          <p className="tile-sub">누르면 해당 조항으로 이동해요.</p>
          <ul className="tile-rows mt-3">
            {RULES_HIGHLIGHTS.map((item) => (
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
            title="회칙 정보"
            sub="개정은 제21조·제22조의 절차를 따라요."
          />
          <dl className="mt-4">
            <div className="rules-info-row">
              <dt>버전</dt>
              <dd>
                <span className="badge-green">정식 {RULES_META.version}</span>
              </dd>
            </div>
            <div className="rules-info-row">
              <dt>시행일</dt>
              <dd>{RULES_META.effective}</dd>
            </div>
            <div className="rules-info-row">
              <dt>구성</dt>
              <dd>
                {RULE_CHAPTERS.length}장 {ARTICLE_COUNT}조 · 부칙 · 부록
              </dd>
            </div>
            <div className="rules-info-row">
              <dt>개정 이력</dt>
              <dd>
                <ul className="space-y-1">
                  {RULES_HISTORY.map((h) => (
                    <li key={h.version}>
                      <strong className="font-display">{h.version}</strong>{" "}
                      <span className="text-slate-500 dark:text-slate-400">
                        {h.date}
                      </span>
                      <br />
                      {h.text}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          <a
            href="#allocation"
            onClick={jumpTo}
            className="btn-secondary mt-auto w-full justify-between print:hidden"
          >
            자리 배정 해설 보기
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
            회칙 복사를 누르면 전체 본문을 단체방에 그대로 붙여 넣을 수 있어요.
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
                  <ArticleCard key={articleId(article)} article={article} />
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
              APPENDIX A · 자리 배정 해설
            </p>
            <h2 id="allocation-title" className="rules-appendix-title">
              선착순, 이렇게 배정합니다.
            </h2>
            <p className="rules-appendix-sub">
              정회원이 먼저 선착순으로 자리를 채우고, 코트 이용일 3일 전에 남은
              자리만큼 게스트 참석 투표를 받습니다. 게스트 자리 수는 정해 두지
              않으며, 전체 정원 6명은 넘지 않습니다. 정원이 차면 대기로 신청할
              수 있고, 빈자리가 나면 대기 순서대로 자동 확정됩니다.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="tile-green">
                <strong className="text-base">1단계 · 정회원 선착순</strong>
                <span className="mt-3 block">
                  <Seats member={4} open={0} large />
                </span>
                <p className="mt-3 text-xs leading-relaxed">
                  금요일 오전 10시 다음 주 일정 공개 후 바로 신청, 6자리까지
                  <br />
                  운영진도 같은 기준 · 별도 우선권 없음
                </p>
              </div>
              <div className="tile-yellow">
                <strong className="text-base">
                  2단계 · 3일 전 게스트 투표
                </strong>
                <span className="mt-3 block">
                  <Seats member={0} open={2} large />
                </span>
                <p className="mt-3 text-xs leading-relaxed">
                  일정은 금요일부터 함께 보고, 남은 자리만큼 투표
                  <br />
                  이때부터는 정회원·게스트 구분 없이 투표 순서
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
              배정은 선착순이며, 이미 확정한 참가자를 뒤늦은 신청자 때문에
              교체하지 않습니다.
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

          <p className="px-1 text-[11px] font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
            오테식 회칙 {RULES_META.version} · {RULES_META.effective} 시행
          </p>
        </div>
      </div>
    </PageBody>
  );
}
