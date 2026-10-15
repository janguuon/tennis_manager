import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { Eyebrow } from "~/components/Club";
import { Wordmark } from "~/components/Logo";
import { getToken } from "~/lib/session.server";

/**
 * 회원 이용 안내 (/guide).
 * 가입 전인 사람에게도 링크로 보낼 수 있도록 로그인 없이 열린다.
 * 로그인 상태면 머리에 "홈으로", 아니면 "로그인 · 회원가입"을 보여 준다.
 */
export const meta: MetaFunction = () => [
  { title: "이용 안내 · 오테식 매니저" },
  {
    name: "description",
    content: "회원가입, 참석 투표, 참가비, 게임·대진 방식까지 한 번에.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return json({ loggedIn: Boolean(await getToken(request)) });
}

const STEPS = [
  { href: "#signup", tone: "tile-blue", text: "회원가입하고 승인 기다리기" },
  {
    href: "#attend",
    tone: "tile-yellow",
    text: "캘린더에서 참석 (꽉\u00a0차면\u00a0대기)",
  },
  { href: "#attend", tone: "tile-orange", text: "참가비 확인하고 입금하기" },
  { href: "#draw", tone: "tile-green", text: "대진표 보고 코트로!" },
];

const MENUS = [
  {
    to: "/app",
    label: "클럽 홈",
    desc: "다음 모임, 내가 낼 참가비를 바로 보여 줘요.",
  },
  { to: "/app/calendar", label: "캘린더", desc: "모든 일정과 참석 투표." },
  {
    to: "/app/payments",
    label: "회비 정산",
    desc: "내가 낼 금액 · 입금 계좌 확인.",
  },
  { to: "/app/members", label: "테니스 식구", desc: "회원 목록과 프로필." },
  { to: "/app/rules", label: "클럽 회칙", desc: "우리 클럽 규칙." },
  {
    to: "/app/mypage",
    label: "마이페이지",
    desc: "내 이름(프로필)을 누르면 들어가요. 성별 등 프로필 수정, 비밀번호 변경.",
  },
];

function GuideSection({
  id,
  no,
  tone,
  title,
  sub,
  children,
}: {
  id: string;
  no: number;
  tone: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="card guide-section"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="guide-section-title">
        <span className={tone}>{no}</span>
        {title}
      </h2>
      {sub ? <p className="guide-section-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

export default function GuidePage() {
  const { loggedIn } = useLoaderData<typeof loader>();
  return (
    <div className="guide-shell">
      <header className="guide-topbar">
        <div className="guide-topbar-inner">
          <Link to={loggedIn ? "/app" : "/login"} aria-label="오테식 매니저">
            <Wordmark size="sm" tagline={false} />
          </Link>
          <div className="flex items-center gap-2">
            {loggedIn ? (
              <Link to="/app" className="btn-ghost btn-sm">
                홈으로
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost btn-sm">
                  로그인
                </Link>
                <Link to="/signup" className="btn-primary btn-sm">
                  회원가입
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="guide-main">
        <section className="tile-ink guide-hero">
          <span className="guide-ball" aria-hidden="true" />
          <Eyebrow>OTESIK MANAGER · 회원 안내</Eyebrow>
          <h1 className="guide-hero-title">
            오테식 매니저,
            <br />
            <span className="text-house-yellow">이렇게</span> 써요
          </h1>
          <p className="mt-3 text-sm text-white/75">
            일정 확인 · 참석 투표 · 참가비 · 대진표를 한곳에서.
          </p>
        </section>

        <nav className="guide-steps" aria-label="이용 순서">
          {STEPS.map((s, i) => (
            <a key={s.text} href={s.href} className={`${s.tone} guide-step`}>
              <Eyebrow>STEP {i + 1}</Eyebrow>
              <strong>{s.text}</strong>
            </a>
          ))}
        </nav>

        <GuideSection id="signup" no={1} tone="bg-house-blue" title="회원가입">
          <ol className="guide-list">
            <li>
              로그인 화면에서{" "}
              {loggedIn ? (
                <b>회원가입</b>
              ) : (
                <Link to="/signup" className="guide-link">
                  회원가입
                </Link>
              )}
              을 눌러요.
            </li>
            <li>
              <b>아이디 · 이름 · 비밀번호</b>를 적고, <b>성별</b>도 꼭 골라
              주세요. (대진에서 남복·여복·혼복을 짤 때 써요)
            </li>
            <li>
              신청하면 운영진이 확인 후 <b>승인</b>해요. 승인되면 바로 로그인할
              수 있어요.
            </li>
          </ol>
          <div className="guide-examples">
            <div>
              <small>아이디 (영문·숫자 3자 이상)</small>
              <p>
                tesik <span>← 짧고 쉽게</span>
              </p>
            </div>
            <div>
              <small>비밀번호 (4자 이상)</small>
              <p>
                1234 <span>← 외우기 쉬운 숫자면 OK</span>
              </p>
            </div>
          </div>
          <p className="guide-tip">
            <b>추천!</b> 아이디와 비밀번호는 <b>최대한 간단하게</b> 만들어
            주세요. 다만 다른 곳에서 쓰는 중요한 비밀번호는 피해 주세요. 이름은{" "}
            <b>실명</b>으로 적어야 명단에서 찾기 쉬워요. 비밀번호를 잊으면
            운영진에게 말하면 다시 만들어 드려요.
          </p>
        </GuideSection>

        <GuideSection
          id="attend"
          no={2}
          tone="bg-house-yellow"
          title="코트 일정 참여하기"
        >
          <ol className="guide-list">
            <li>
              <b>캘린더</b>에서 일정을 눌러 <b>참석</b> 또는 <b>불참</b>을
              골라요.
            </li>
            <li>
              정원이 다 차면 <b>대기 신청</b>을 눌러요. 자리가 나면{" "}
              <b>대기 순서대로 자동으로 참석</b>이 돼요.
            </li>
            <li>
              다음 주(월~일) 일정은 <b>금요일 오전 10시</b>에 열려요. (게스트도
              일정은 함께 보이고, 참석 투표는 모임 3일 전 0시부터)
            </li>
            <li>
              <b>모임 3일 전부터는</b> 참석 → 불참 변경을 운영진에게 요청해요.
              대기 취소는 언제든 OK.
            </li>
            <li>
              <b>회비 정산</b> 메뉴에서 내가 낼 금액과 계좌를 확인하고 입금해요.
              입금 확인은 총무가 해요.
            </li>
          </ol>
          <dl className="guide-kinds">
            <div>
              <dt className="bg-house-green">오테식 정모·벙개</dt>
              <dd>
                클럽 회비로 운영해요. <b>회원은 참가비가 없고,</b> 게스트는
                게스트비(5,000원)를 내요.
              </dd>
            </div>
            <div>
              <dt className="bg-house-orange">일반 벙개</dt>
              <dd>
                코트비 + 캔볼비를 참석한 사람끼리 <b>n분의 1</b>로 나눠요.
              </dd>
            </div>
          </dl>
        </GuideSection>

        <GuideSection
          id="game"
          no={3}
          tone="bg-house-orange"
          title="게임 방식"
          sub="복식 6게임 한 판, 한 판에 30분 정도예요. 2시간이면 보통 4판을 쳐요."
        >
          <div className="guide-scores">
            <div className="tile-yellow">
              <strong>6 : 3</strong>
              <span>6게임을 먼저 따면 끝</span>
            </div>
            <div className="tile-green">
              <strong>5 : 5</strong>
              <span>해피게임 — 무승부로 마무리</span>
            </div>
            <div className="tile-lav">
              <strong>6 : 5</strong>
              <span>타이브레이크로 마무리</span>
            </div>
          </div>
          <ul className="guide-bullets">
            <li>
              <b>5:5가 되면</b> 해피게임으로 끝낼지, 타이브레이크로 6:5를 낼지는{" "}
              <b>그 코트 회원들이 정해요.</b>
            </li>
            <li>
              경기가 끝나면 점수를 <b>게임 수</b>로 기록해요. 기록은 운영진이
              앱에 입력해요.
            </li>
          </ul>
        </GuideSection>

        <GuideSection
          id="draw"
          no={4}
          tone="bg-house-green"
          title="매칭(대진) 방식"
          sub="운영진이 그날 참석자로 앱에서 대진을 자동으로 만들어요."
        >
          <ul className="guide-bullets">
            <li>
              <b>남복 · 여복 · 혼복</b>을 먼저 꾸리고, 인원이 맞지 않을 때만
              잡복을 해요.
            </li>
            <li>
              모임 시간에 맞춰 판 수를 정하고,{" "}
              <b>모두의 게임 수가 최대한 같도록</b> 돌아가며 쉬어요. 되도록 두
              판 연속으로 쉬지 않게 짜요.
            </li>
            <li>
              같은 파트너·상대를 되도록 반복하지 않게 <b>여러 사람과 골고루</b>{" "}
              섞어요.
            </li>
            <li>
              경기 기록이 쌓이면 코트마다 <b>비슷한 실력끼리 접전</b>이 되도록
              맞추기도 해요.
            </li>
          </ul>
          <div className="guide-courts" aria-hidden="true">
            <div className="tile-blue">
              <small>COURT 3 · 1R</small>
              김○○ · 이○○
              <br />
              vs 박○○ · 최○○
            </div>
            <div className="tile-blue">
              <small>COURT 5 · 1R</small>
              정○○ · 한○○
              <br />
              vs 오○○ · 윤○○
            </div>
            <div className="tile-blue">
              <small>COURT 3 · 2R</small>…
            </div>
          </div>
          <p className="guide-tip">
            <b>대진표 보는 곳</b> 모임 화면 아래 <b>‘오늘의 매치업’</b>에서 내
            코트 번호와 몇 번째 판(R)인지 확인하세요. 지각·부상 등으로 바꿔야
            하면 참석자 누구나 <b>‘직접 바꾸기’</b>로 자리를 바꿀 수 있어요.
          </p>
        </GuideSection>

        <GuideSection id="menu" no={5} tone="bg-house-lav" title="메뉴 한눈에">
          <ul className="guide-menus">
            {MENUS.map((m) => (
              <li key={m.to}>
                <Link to={m.to}>
                  <strong>{m.label}</strong>
                  <span>{m.desc}</span>
                  <ArrowUpRight size={15} className="shrink-0 opacity-50" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="guide-tip">
            <b>게스트</b> 클럽 홈·캘린더·마이페이지만 보여요. 참가비와 입금
            계좌는 모임 화면에서 확인해요.
          </p>
          <p className="guide-tip">
            <b>앱처럼 쓰기</b> 휴대폰에서 주소를 연 뒤 브라우저 메뉴의{" "}
            <b>‘홈 화면에 추가’</b>를 누르면 아이콘으로 바로 들어갈 수 있어요.
          </p>
        </GuideSection>

        <footer className="guide-footer">
          <p>궁금한 점은 운영진에게 편하게 물어봐 주세요.</p>
          <Link to={loggedIn ? "/app" : "/signup"} className="btn-primary">
            {loggedIn ? "클럽 홈으로" : "회원가입 하러 가기"}
            <ArrowUpRight size={16} />
          </Link>
        </footer>
      </main>
    </div>
  );
}
