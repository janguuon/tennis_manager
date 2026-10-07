import type { LinksFunction, MetaFunction } from "@remix-run/node";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  House,
  LayoutGrid,
  List,
  MapPin,
  Monitor,
  Moon,
  MoreHorizontal,
  Smartphone,
  Sun,
  Trophy,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { BallBasket } from "~/components/BallBasket";
import stylesheet from "~/styles/design-preview.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];
export const meta: MetaFunction = () => [
  { title: "otesik. — 프론트엔드 디자인 시안" },
  { name: "robots", content: "noindex, nofollow" },
];

// A self-contained design study. All data and interactions below are local demo state.
// No loaders, actions, API requests, or changes to club records.
type Screen =
  | "home"
  | "calendar"
  | "gathering"
  | "payments"
  | "ranking"
  | "members";
type Vote = "참석" | "미정" | "불참";
const menu: { id: Screen; label: string; icon: LucideIcon; color: string }[] = [
  { id: "home", label: "클럽 홈", icon: House, color: "blue" },
  { id: "calendar", label: "캘린더", icon: CalendarDays, color: "yellow" },
  { id: "payments", label: "회비 정산", icon: Wallet, color: "orange" },
  { id: "ranking", label: "우리의 기록", icon: Trophy, color: "green" },
  { id: "members", label: "테니스 식구", icon: Users, color: "lav" },
];
const members = [
  {
    name: "김민준",
    initial: "민",
    color: "lav",
    wins: 18,
    losses: 6,
    ntrp: "3.5",
  },
  {
    name: "이서연",
    initial: "서",
    color: "yellow",
    wins: 16,
    losses: 8,
    ntrp: "3.0",
  },
  {
    name: "박지훈",
    initial: "지",
    color: "blue",
    wins: 14,
    losses: 8,
    ntrp: "3.5",
  },
  {
    name: "최유진",
    initial: "유",
    color: "green",
    wins: 13,
    losses: 9,
    ntrp: "3.0",
  },
  {
    name: "정도윤",
    initial: "도",
    color: "orange",
    wins: 12,
    losses: 10,
    ntrp: "3.0",
  },
  {
    name: "한수빈",
    initial: "수",
    color: "lav",
    wins: 10,
    losses: 10,
    ntrp: "2.5",
  },
  {
    name: "윤지우",
    initial: "우",
    color: "yellow",
    wins: 9,
    losses: 11,
    ntrp: "2.5",
  },
  {
    name: "오하준",
    initial: "하",
    color: "green",
    wins: 8,
    losses: 12,
    ntrp: "2.5",
  },
];
const events = [
  {
    day: 11,
    weekday: "일",
    title: "일요일 정기 모임",
    time: "09:00 — 12:00",
    location: "올림픽공원 테니스장",
    count: 8,
    color: "orange",
  },
  {
    day: 17,
    weekday: "토",
    title: "가볍게, 토요 랠리",
    time: "10:00 — 12:00",
    location: "잠실 유수지 테니스장",
    count: 6,
    color: "green",
  },
  {
    day: 25,
    weekday: "일",
    title: "10월 마지막 정기 모임",
    time: "09:00 — 12:00",
    location: "올림픽공원 테니스장",
    count: 10,
    color: "lav",
  },
];

function Avatar({ index, small = false }: { index: number; small?: boolean }) {
  const person = members[index % members.length];
  return (
    <span
      className={`dp-avatar dp-${person.color} ${small ? "dp-avatar-sm" : ""}`}
      title={person.name}
    >
      {person.initial}
    </span>
  );
}
function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="dp-eyebrow">{children}</span>;
}
function ArrowButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="dp-circle" aria-label={label} onClick={onClick}>
      <ArrowUpRight size={19} />
    </button>
  );
}
function Court({ label = "03" }: { label?: string }) {
  return (
    <div className="dp-court" aria-label={`${label}번 테니스 코트`}>
      <div className="dp-court-inner" />
      <i className="dp-net" />
      <i className="dp-service" />
      <span>{label}</span>
      <span className="dp-court-ball" />
    </div>
  );
}
function VoteButtons({
  vote,
  setVote,
}: {
  vote: Vote;
  setVote: (vote: Vote) => void;
}) {
  return (
    <div className="dp-votes" aria-label="참석 투표">
      {(["참석", "미정", "불참"] as Vote[]).map((v) => (
        <button key={v} aria-pressed={vote === v} onClick={() => setVote(v)}>
          {vote === v && <Check size={15} />}
          {v === "참석" ? "참석할게요" : v}
        </button>
      ))}
    </div>
  );
}
function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="dp-section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export default function DesignPreview() {
  const [screen, setScreen] = useState<Screen>("home");
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(false);
  const [vote, setVote] = useState<Vote>("참석");
  const [toast, setToast] = useState("");
  const [person, setPerson] = useState<number | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const attendeeCount = vote === "참석" ? 8 : 7;
  const perPerson = Math.ceil(60000 / attendeeCount / 100) * 100;
  const active = screen === "gathering" ? "calendar" : screen;
  const money = (n: number) => n.toLocaleString("ko-KR");
  const navigate = (next: Screen) => {
    setScreen(next);
    setPerson(null);
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
  const notify = (message: string) => setToast(message);
  const onVote = (next: Vote) => {
    setVote(next);
    notify(`시안에서 '${next}'으로 변경했어요.`);
  };
  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText("시안용 계좌 · 실제 송금 불가");
      notify("예시 계좌 정보를 복사했어요.");
    } catch {
      notify("예시 계좌: 1234-56-•••••• (실제 송금 불가)");
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (person !== null) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [person]);

  const feeCard = (wide = false) => (
    <section
      className={`dp-panel dp-yellow dp-fee ${wide ? "dp-fee-wide" : ""}`}
    >
      <div className="dp-row">
        <Eyebrow>MY CLUB DUES</Eyebrow>
        <Wallet size={20} strokeWidth={1.7} />
      </div>
      <h2>내가 낼 참가비</h2>
      <div className="dp-fee-number">
        {vote === "참석" ? money(perPerson) : "0"}
        <span>원</span>
      </div>
      <p>
        {vote === "참석"
          ? "일요일 정기 모임 · 1건 입금 전"
          : "아직 낼 참가비가 없어요"}
      </p>
      <div className="dp-account">
        <span>
          카카오뱅크 · 김총무<small>1234-56-••••••</small>
        </span>
        <button onClick={copyAccount} aria-label="예시 계좌 복사">
          <Copy size={17} />
        </button>
      </div>
      <button
        className="dp-text-link"
        onClick={() =>
          navigate(screen === "payments" ? "gathering" : "payments")
        }
      >
        {screen === "payments" ? "모임에서 입금 현황 보기" : "정산 내역 보기"}{" "}
        <ArrowUpRight size={16} />
      </button>
    </section>
  );

  const eventList = (all = false) => (
    <div className="dp-event-list">
      {events.slice(all ? 0 : 1).map((e) => (
        <button
          className="dp-event-row"
          key={e.day}
          onClick={() =>
            e.day === 11
              ? navigate("gathering")
              : notify(`10월 ${e.day}일 · ${e.title} · ${e.count}명 참석 예정`)
          }
        >
          <span className="dp-date-box">
            <strong>{e.day}</strong>
            <small>10월 {e.weekday}요일</small>
          </span>
          <span className="dp-event-info">
            <strong>{e.title}</strong>
            <small>
              {e.time} · {e.location}
            </small>
          </span>
          <span className="dp-event-count">
            <Users size={14} />
            {e.day === 11 ? attendeeCount : e.count}
          </span>
          <ArrowUpRight size={17} />
        </button>
      ))}
    </div>
  );

  return (
    <div className={`dp-preview ${dark ? "dp-dark" : ""}`}>
      <div className="dp-preview-bar">
        <div>
          <span className="dp-preview-dot" />
          <strong>otesik. / design study</strong>
          <span className="dp-demo-label">디자인 시안 · 예시 데이터</span>
        </div>
        <div className="dp-preview-tools">
          <div className="dp-device-controls">
            <button
              aria-label="데스크톱 시안"
              aria-pressed={!mobile}
              onClick={() => setMobile(false)}
            >
              <Monitor size={15} />
            </button>
            <button
              aria-label="모바일 시안"
              aria-pressed={mobile}
              onClick={() => setMobile(true)}
            >
              <Smartphone size={15} />
            </button>
          </div>
          <button
            aria-label={dark ? "라이트 모드" : "다크 모드"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
      <div className={`dp-stage ${mobile ? "dp-mobile-stage" : ""}`}>
        <div className="dp-app">
          <aside className="dp-sidebar">
            <button className="dp-brand" onClick={() => navigate("home")}>
              otesik<span>.</span>
              <small>오순도순 테니스 식구</small>
            </button>
            <div className="dp-side-caption">OUR CLUBHOUSE</div>
            <nav aria-label="주 메뉴">
              {menu.map(({ id, label, icon: Icon, color }, i) => (
                <button
                  key={id}
                  className={`dp-nav-item ${
                    active === id ? `dp-selected dp-${color}` : ""
                  }`}
                  aria-current={active === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <span className={`dp-nav-icon dp-${color}`}>
                    <Icon size={18} />
                  </span>
                  <span>{label}</span>
                  <span className="dp-nav-number">0{i + 1}</span>
                </button>
              ))}
            </nav>
            <div className="dp-side-bottom">
              <div className="dp-club-note">
                <span className="dp-mini-ball" />
                <span>
                  같이 치면,
                  <br />더 즐거우니까.
                </span>
              </div>
              <button className="dp-profile" onClick={() => setPerson(1)}>
                <Avatar index={1} small />
                <span>
                  <strong>이서연</strong>
                  <small>오늘도 반가워요</small>
                </span>
                <MoreHorizontal size={18} />
              </button>
            </div>
          </aside>
          <header className="dp-mobile-header">
            <button className="dp-brand" onClick={() => navigate("home")}>
              otesik.
            </button>
            <div>
              <button
                className="dp-icon-btn"
                aria-label={dark ? "라이트 모드" : "다크 모드"}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button aria-label="내 프로필" onClick={() => setPerson(1)}>
                <Avatar index={1} small />
              </button>
            </div>
          </header>
          <main ref={mainRef} className="dp-main">
            <div className="dp-content" key={screen}>
              <div className="dp-topline">
                <span>
                  우리의 작은 테니스 클럽{" "}
                  <span className="dp-topline-divider">/</span>{" "}
                  {screen === "gathering"
                    ? "모임 상세"
                    : menu.find((m) => m.id === screen)?.label}
                </span>
                <span>
                  WED, OCT 07 <span className="dp-topline-divider">·</span> 2026
                </span>
              </div>
              {screen === "home" && (
                <>
                  <header className="dp-page-header">
                    <div>
                      <Eyebrow>GOOD DAY, GOOD GAME.</Eyebrow>
                      <h1>
                        오늘도, 좋은 한 게임
                        <span className="dp-heading-dot">.</span>
                      </h1>
                      <p>서연님, 이번 주도 코트에서 만나요.</p>
                    </div>
                    <button
                      className="dp-button dp-button-paper"
                      onClick={() => navigate("calendar")}
                    >
                      이번 달 일정 <ArrowUpRight size={16} />
                    </button>
                  </header>
                  <div className="dp-news">
                    <span>
                      <i /> CLUB NEWS
                    </span>
                    <p>이번 주 일요일, {attendeeCount}명의 식구가 함께해요.</p>
                    <button
                      onClick={() => navigate("gathering")}
                      aria-label="이번 주 모임 보기"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="dp-home-grid">
                    <section className="dp-panel dp-orange dp-hero">
                      <div className="dp-row">
                        <Eyebrow>NEXT MATCH / 10.11</Eyebrow>
                        <span className="dp-pill">D−4</span>
                      </div>
                      <div className="dp-hero-art">
                        <div className="dp-art-orbit" />
                        <BallBasket />
                        <span className="dp-art-label">
                          SEE YOU
                          <br />
                          ON COURT!
                        </span>
                      </div>
                      <div className="dp-hero-copy">
                        <h2>
                          일요일
                          <br />
                          정기 모임<span>.</span>
                        </h2>
                        <p className="dp-hero-time">
                          10월 11일 일요일 <span>09:00 — 12:00</span>
                        </p>
                        <p className="dp-location">
                          <MapPin size={15} />
                          올림픽공원 테니스장 · 3, 5번 코트
                        </p>
                      </div>
                      <div className="dp-hero-bottom">
                        <div className="dp-attendees">
                          <div className="dp-avatar-stack">
                            {[0, 1, 2, 3].map((i) => (
                              <Avatar key={i} index={i} small />
                            ))}
                          </div>
                          <span>
                            <b>{attendeeCount}명</b> 함께해요{" "}
                            <small>/ 정원 12명</small>
                          </span>
                          <button
                            className="dp-text-link"
                            onClick={() => navigate("gathering")}
                          >
                            모임 보기 <ArrowUpRight size={16} />
                          </button>
                        </div>
                        <VoteButtons vote={vote} setVote={onVote} />
                      </div>
                    </section>
                    {feeCard()}
                    <section className="dp-panel dp-paper dp-upcoming">
                      <SectionTitle
                        title="다음에도, 함께"
                        subtitle="다가오는 우리 모임"
                        action={
                          <ArrowButton
                            label="캘린더 보기"
                            onClick={() => navigate("calendar")}
                          />
                        }
                      />
                      {eventList()}
                      <div className="dp-footnote">
                        <span className="dp-small-dot dp-green" />
                        꾸준히 만나는 즐거움, 오테식
                      </div>
                    </section>
                    <section className="dp-panel dp-blue dp-court-card">
                      <div className="dp-row">
                        <Eyebrow>OUR COURT</Eyebrow>
                        <span className="dp-pill">2면 예약</span>
                      </div>
                      <div className="dp-courts">
                        <Court label="03" />
                        <Court label="05" />
                      </div>
                      <div className="dp-court-bottom">
                        <div>
                          <h2>우리의 코트</h2>
                          <p>올림픽공원 · 09:00 — 12:00</p>
                        </div>
                        <a
                          href="https://map.naver.com/p/search/올림픽공원%20테니스장"
                          target="_blank"
                          rel="noreferrer"
                          className="dp-circle"
                          aria-label="네이버 지도에서 코트 보기"
                        >
                          <ArrowUpRight size={19} />
                        </a>
                      </div>
                    </section>
                    <section className="dp-panel dp-ink dp-my-record">
                      <div className="dp-row">
                        <Eyebrow>MY RECORD</Eyebrow>
                        <ArrowButton
                          label="내 전적 보기"
                          onClick={() => setPerson(1)}
                        />
                      </div>
                      <h2>차곡차곡 쌓인 실력</h2>
                      <div className="dp-record-number">
                        67<span>%</span>
                      </div>
                      <div
                        className="dp-record-bars"
                        aria-label="24경기 중 16승, 8패"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <i key={i} className={i < 16 ? "dp-win" : ""} />
                        ))}
                      </div>
                      <div className="dp-record-footer">
                        <span>
                          <b>16</b>승 <b>8</b>패
                        </span>
                        <span>총 24경기</span>
                      </div>
                    </section>
                    <section className="dp-panel dp-paper dp-ranking-strip">
                      <SectionTitle
                        title="코트 위의 주인공들"
                        subtitle="우리 클럽 승률 TOP 3"
                        action={
                          <button
                            className="dp-text-link"
                            onClick={() => navigate("ranking")}
                          >
                            전체 랭킹 <ArrowUpRight size={15} />
                          </button>
                        }
                      />
                      <div className="dp-top-three">
                        {members.slice(0, 3).map((m, i) => (
                          <button key={m.name} onClick={() => setPerson(i)}>
                            <span className="dp-rank-position">0{i + 1}</span>
                            <Avatar index={i} small />
                            <span>
                              <strong>{m.name}</strong>
                              <small>
                                {m.wins}승 {m.losses}패
                              </small>
                            </span>
                            <b>
                              {Math.round((m.wins / (m.wins + m.losses)) * 100)}
                              <small>%</small>
                            </b>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}

              {screen === "calendar" && (
                <CalendarView
                  navigate={navigate}
                  eventList={eventList}
                  notify={notify}
                />
              )}

              {screen === "gathering" && (
                <>
                  <button
                    className="dp-back"
                    onClick={() => navigate("calendar")}
                  >
                    <ArrowLeft size={16} />
                    캘린더로
                  </button>
                  <header className="dp-page-header">
                    <div>
                      <Eyebrow>LET’S PLAY TOGETHER.</Eyebrow>
                      <h1>
                        일요일 정기 모임
                        <span className="dp-heading-dot">.</span>
                      </h1>
                      <p>한 주의 마무리는, 좋아하는 사람들과 좋아하는 운동.</p>
                    </div>
                    <span className="dp-status">
                      <i />
                      참석 투표 중
                    </span>
                  </header>
                  <div className="dp-detail-grid">
                    <section className="dp-panel dp-orange dp-detail-intro">
                      <div className="dp-row">
                        <Eyebrow>SUNDAY TENNIS CLUB</Eyebrow>
                        <span className="dp-pill">D−4</span>
                      </div>
                      <div className="dp-detail-date">
                        10.11<span>SUN</span>
                      </div>
                      <p>
                        09:00 — 12:00 <span>· 3시간</span>
                      </p>
                      <div className="dp-detail-location">
                        <MapPin size={18} />
                        <div>
                          <strong>올림픽공원 테니스장</strong>
                          <span>3번 · 5번 코트 / 총 2면</span>
                        </div>
                      </div>
                      <BallBasket className="dp-detail-art" />
                    </section>
                    <section className="dp-panel dp-paper dp-attendance-card">
                      <SectionTitle
                        title="이번에도 함께할까요?"
                        subtitle="10월 8일부터 불참·미정 변경이 제한돼요."
                      />
                      <div className="dp-big-attendance">
                        {attendeeCount}
                        <span>/ 12명</span>
                        <span className="dp-attendance-caption">참석 예정</span>
                      </div>
                      <div className="dp-segments">
                        {Array.from({ length: 12 }, (_, i) => (
                          <i
                            key={i}
                            className={i < attendeeCount ? "dp-blue" : ""}
                          />
                        ))}
                      </div>
                      <VoteButtons vote={vote} setVote={onVote} />
                      <p className="dp-muted-note">
                        현재 내 응답: {vote} · {12 - attendeeCount}자리 남았어요
                      </p>
                    </section>
                    <section className="dp-panel dp-paper dp-attendee-panel">
                      <SectionTitle
                        title="함께하는 식구들"
                        subtitle={`참석 ${attendeeCount}명 · 미정 ${
                          vote === "미정" ? 3 : 2
                        }명 · 불참 ${vote === "불참" ? 2 : 1}명`}
                        action={<Users size={20} />}
                      />
                      <div className="dp-attendee-grid">
                        {members
                          .filter((_, i) => vote === "참석" || i !== 1)
                          .map((m) => {
                            const i = members.indexOf(m);
                            return (
                              <button key={m.name} onClick={() => setPerson(i)}>
                                <Avatar index={i} />
                                <strong>
                                  {m.name}
                                  {i === 1 && <small>나</small>}
                                </strong>
                                <span>NTRP {m.ntrp}</span>
                              </button>
                            );
                          })}
                      </div>
                    </section>
                    <section className="dp-panel dp-yellow dp-settlement">
                      <div className="dp-row">
                        <Eyebrow>MATCH DUES</Eyebrow>
                        <Wallet size={20} />
                      </div>
                      <h2>가볍게 나눠 내요</h2>
                      <div className="dp-fee-number">
                        {money(perPerson)}
                        <span>원 / 1인</span>
                      </div>
                      <p>코트비 60,000원 ÷ 참석 {attendeeCount}명</p>
                      <div className="dp-account">
                        <span>
                          카카오뱅크 · 김총무<small>1234-56-••••••</small>
                        </span>
                        <button
                          onClick={copyAccount}
                          aria-label="예시 계좌 복사"
                        >
                          <Copy size={17} />
                        </button>
                      </div>
                      <div className="dp-segments">
                        {Array.from({ length: attendeeCount }, (_, i) => (
                          <i key={i} className={i < 5 ? "dp-ink" : ""} />
                        ))}
                      </div>
                      <div className="dp-row dp-payment-caption">
                        <span>5명 입금 완료</span>
                        <span>{attendeeCount - 5}명 입금 전</span>
                      </div>
                      <p className="dp-muted-note">
                        참석 인원에 따라 금액이 달라질 수 있어요.
                      </p>
                    </section>
                    <section className="dp-panel dp-paper dp-draw-panel">
                      <SectionTitle
                        title="오늘의 매치업"
                        subtitle="1라운드 · 남자 복식 / 여자 복식"
                        action={<span className="dp-status">대진 확정</span>}
                      />
                      <div className="dp-draw-grid">
                        {[
                          [0, 2, 4, 7],
                          [1, 3, 5, 6],
                        ].map((ids, i) => (
                          <div className="dp-match" key={i}>
                            <div className="dp-row">
                              <span
                                className={`dp-pill dp-${i ? "lav" : "green"}`}
                              >
                                COURT {i ? "05" : "03"}
                              </span>
                              <span>09:00</span>
                            </div>
                            <div className="dp-versus">
                              <div>
                                {ids.slice(0, 2).map((id) => (
                                  <span key={id}>
                                    <Avatar index={id} small />
                                    {members[id].name}
                                  </span>
                                ))}
                              </div>
                              <span>VS</span>
                              <div>
                                {ids.slice(2).map((id) => (
                                  <span key={id}>
                                    <Avatar index={id} small />
                                    {members[id].name}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p>경기 예정</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}

              {screen === "payments" && (
                <>
                  <header className="dp-page-header">
                    <div>
                      <Eyebrow>A LITTLE EACH, A LOT TOGETHER.</Eyebrow>
                      <h1>
                        깔끔하게, 나눠 내요
                        <span className="dp-heading-dot">.</span>
                      </h1>
                      <p>우리 모임의 참가비를 한눈에 확인하세요.</p>
                    </div>
                    <span className="dp-month-label">2026년 10월</span>
                  </header>
                  <div className="dp-payment-grid">
                    {feeCard(true)}
                    <section className="dp-panel dp-paper dp-payment-summary">
                      <SectionTitle
                        title="10월 정산 현황"
                        subtitle="정기 모임 3건 기준"
                      />
                      <div className="dp-summary-item">
                        <span>
                          <i className="dp-green" />
                          걷힌 돈
                        </span>
                        <strong>
                          142,500<small>원</small>
                        </strong>
                      </div>
                      <div className="dp-summary-item">
                        <span>
                          <i className="dp-orange" />
                          받을 돈
                        </span>
                        <strong>
                          37,500<small>원</small>
                        </strong>
                      </div>
                      <div className="dp-summary-item">
                        <span>
                          <ArrowDownLeft size={15} />
                          돌려줄 돈
                        </span>
                        <strong>
                          0<small>원</small>
                        </strong>
                      </div>
                    </section>
                  </div>
                  <section className="dp-panel dp-paper dp-payment-table">
                    <SectionTitle
                      title="모임별 정산"
                      subtitle="입금 확인은 모임 주최자가 진행해요."
                    />
                    <div className="dp-payment-table-head">
                      <span>모임</span>
                      <span>입금 현황</span>
                      <span>걷힌 돈 / 총액</span>
                      <span />
                    </div>
                    {events.map((e, i) => (
                      <button
                        key={e.day}
                        className="dp-payment-table-row"
                        onClick={() =>
                          i === 0
                            ? navigate("gathering")
                            : notify(
                                `${e.title} · ${
                                  i === 1 ? "입금 완료" : "10명 중 8명 입금"
                                }`
                              )
                        }
                      >
                        <span>
                          <b>{e.title}</b>
                          <small>
                            10월 {e.day}일 · {e.location}
                          </small>
                        </span>
                        <span>
                          <div className="dp-mini-progress">
                            <i style={{ width: `${[62.5, 100, 80][i]}%` }} />
                          </div>
                          <small>{["5 / 8명", "6 / 6명", "8 / 10명"][i]}</small>
                        </span>
                        <span>
                          <b>{["37,500", "45,000", "60,000"][i]}</b>
                          <small>
                            {" "}
                            / {["60,000", "45,000", "75,000"][i]}원
                          </small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                    ))}
                  </section>
                </>
              )}

              {screen === "ranking" && (
                <>
                  <header className="dp-page-header">
                    <div>
                      <Eyebrow>EVERY GAME COUNTS.</Eyebrow>
                      <h1>
                        함께 쌓아온 기록
                        <span className="dp-heading-dot">.</span>
                      </h1>
                      <p>이기는 날도, 배우는 날도. 모두 우리의 테니스.</p>
                    </div>
                    <span className="dp-month-label">전체 경기 · 승률순</span>
                  </header>
                  <div className="dp-podium">
                    {members.slice(0, 3).map((m, i) => (
                      <button
                        className={`dp-panel dp-${
                          ["green", "yellow", "lav"][i]
                        }`}
                        key={m.name}
                        onClick={() => setPerson(i)}
                      >
                        <div className="dp-row">
                          <Eyebrow>CLUB RANKING</Eyebrow>
                          <Trophy size={20} />
                        </div>
                        <span className="dp-podium-number">0{i + 1}</span>
                        <Avatar index={i} />
                        <h2>{m.name}</h2>
                        <p>
                          {m.wins}승 {m.losses}패{" "}
                          <b>
                            {Math.round((m.wins / (m.wins + m.losses)) * 100)}%
                          </b>
                        </p>
                      </button>
                    ))}
                  </div>
                  <section className="dp-panel dp-paper dp-ranking-table">
                    <SectionTitle
                      title="우리 클럽 랭킹"
                      subtitle="승률 → 승수 → 경기수 순으로 집계해요."
                    />
                    {members.map((m, i) => (
                      <button
                        className="dp-ranking-row"
                        key={m.name}
                        onClick={() => setPerson(i)}
                      >
                        <span className="dp-rank-position">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <Avatar index={i} small />
                        <strong>
                          {m.name}
                          {i === 1 && <small className="dp-you">나</small>}
                        </strong>
                        <span>
                          {m.wins}승 {m.losses}패
                        </span>
                        <b>
                          {Math.round((m.wins / (m.wins + m.losses)) * 100)}%
                        </b>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </section>
                </>
              )}

              {screen === "members" && (
                <>
                  <header className="dp-page-header">
                    <div>
                      <Eyebrow>OUR PEOPLE, OUR CLUB.</Eyebrow>
                      <h1>
                        반가운, 테니스 식구들
                        <span className="dp-heading-dot">.</span>
                      </h1>
                      <p>코트 위에서 만나 더 가까워지는 사이.</p>
                    </div>
                    <span className="dp-month-label">함께하는 식구 8명</span>
                  </header>
                  <div className="dp-member-grid">
                    {members.map((m, i) => (
                      <button
                        key={m.name}
                        className="dp-panel dp-paper dp-member-card"
                        onClick={() => setPerson(i)}
                      >
                        <div className={`dp-member-banner dp-${m.color}`}>
                          <span className="dp-member-line" />
                          <Avatar index={i} />
                        </div>
                        <div className="dp-member-body">
                          <div className="dp-row">
                            <h2>{m.name}</h2>
                            <ArrowUpRight size={18} />
                          </div>
                          <p>
                            NTRP {m.ntrp} <span>·</span> {m.wins + m.losses}경기
                            함께했어요
                          </p>
                          <div className="dp-member-stats">
                            <span>
                              {m.wins}승 {m.losses}패
                            </span>
                            <b>
                              승률{" "}
                              {Math.round((m.wins / (m.wins + m.losses)) * 100)}
                              %
                            </b>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <footer className="dp-footer">
                <strong>otesik.</strong>
                <span>GOOD GAMES. BETTER TOGETHER.</span>
                <span>오순도순 테니스 식구</span>
              </footer>
            </div>
          </main>
          <nav className="dp-bottom-nav" aria-label="모바일 주 메뉴">
            {menu.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={active === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <span>
                  <Icon size={20} />
                </span>
                <small>{label}</small>
              </button>
            ))}
          </nav>
          {toast && (
            <div className="dp-toast" role="status">
              <Check size={16} />
              {toast}
            </div>
          )}
          <dialog
            ref={dialogRef}
            className="dp-dialog"
            aria-label="회원 프로필"
            onCancel={() => setPerson(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPerson(null);
            }}
            onClose={() => setPerson(null)}
          >
            {person !== null && (
              <>
                <button
                  className="dp-dialog-close dp-icon-btn"
                  aria-label="프로필 닫기"
                  onClick={() => setPerson(null)}
                >
                  <X size={22} />
                </button>
                <Avatar index={person} />
                <Eyebrow>PLAYER PROFILE</Eyebrow>
                <h2>{members[person].name}</h2>
                <p>NTRP {members[person].ntrp} · 오테식 테니스 식구</p>
                <div className="dp-profile-stats">
                  <div>
                    <b>{members[person].wins + members[person].losses}</b>
                    <span>함께한 경기</span>
                  </div>
                  <div>
                    <b>{members[person].wins}</b>
                    <span>승리</span>
                  </div>
                  <div>
                    <b>
                      {Math.round(
                        (members[person].wins /
                          (members[person].wins + members[person].losses)) *
                          100
                      )}
                      <small>%</small>
                    </b>
                    <span>승률</span>
                  </div>
                </div>
                <button
                  className="dp-button dp-button-ink"
                  onClick={() => {
                    setPerson(null);
                    navigate("ranking");
                  }}
                >
                  클럽 전체 기록 보기 <ArrowRight size={16} />
                </button>
              </>
            )}
          </dialog>
        </div>
      </div>
    </div>
  );
}

function CalendarView({
  navigate,
  eventList,
  notify,
}: {
  navigate: (screen: Screen) => void;
  eventList: (all: boolean) => ReactNode;
  notify: (message: string) => void;
}) {
  const [month, setMonth] = useState(9);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const date = new Date(2026, month, 1);
  const y = date.getFullYear(),
    m = date.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((date.getDay() + count) / 7) * 7 },
    (_, i) => {
      const d = i - date.getDay() + 1;
      return d > 0 && d <= count ? d : null;
    }
  );
  const isDemoMonth = y === 2026 && m === 9;
  return (
    <>
      <header className="dp-page-header">
        <div>
          <Eyebrow>MAKE TIME FOR TENNIS.</Eyebrow>
          <h1>
            코트에서 만나요<span className="dp-heading-dot">.</span>
          </h1>
          <p>함께할 날을 골라, 일상에 테니스를 더해요.</p>
        </div>
        <div className="dp-view-toggle">
          <button
            aria-label="달력 보기"
            aria-pressed={view === "calendar"}
            onClick={() => setView("calendar")}
          >
            <LayoutGrid size={16} />
            달력
          </button>
          <button
            aria-label="목록 보기"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={16} />
            목록
          </button>
        </div>
      </header>
      <section className="dp-panel dp-paper dp-calendar-panel">
        <div className="dp-calendar-heading">
          <div>
            <h2>
              {y}
              <span>.</span>
              {String(m + 1).padStart(2, "0")}
            </h2>
            <span>이번 달 모임 {isDemoMonth ? 3 : 0}개</span>
          </div>
          <div>
            <button
              className="dp-circle"
              aria-label="이전 달"
              onClick={() => setMonth(month - 1)}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="dp-button dp-button-paper"
              onClick={() => setMonth(9)}
            >
              오늘
            </button>
            <button
              className="dp-circle"
              aria-label="다음 달"
              onClick={() => setMonth(month + 1)}
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </div>
        {view === "calendar" ? (
          <>
            <div className="dp-weekdays">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="dp-calendar-grid">
              {cells.map((day, i) => {
                const e = isDemoMonth
                  ? events.find((event) => event.day === day)
                  : undefined;
                return (
                  <div
                    key={i}
                    className={`dp-day ${day === null ? "dp-empty-day" : ""} ${
                      isDemoMonth && day === 7 ? "dp-today" : ""
                    }`}
                  >
                    <span>{day}</span>
                    {isDemoMonth && day === 7 && (
                      <small className="dp-today-label">TODAY</small>
                    )}
                    {e && (
                      <button
                        className={`dp-cal-event dp-${e.color}`}
                        onClick={() =>
                          day === 11
                            ? navigate("gathering")
                            : notify(`10월 ${day}일 ${e.time} · ${e.title}`)
                        }
                      >
                        <span>{e.time.slice(0, 5)}</span>
                        <strong>{e.title}</strong>
                        <small>{e.location}</small>
                        <span className="dp-cal-event-count">
                          <Users size={12} />
                          {e.count}명
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="dp-calendar-legend">
              <span>
                <i className="dp-orange" />
                정기 모임
              </span>
              <span>
                <i className="dp-green" />
                자유 랠리
              </span>
              <span>
                모임을 눌러 참석을 알려주세요 <ArrowUpRight size={14} />
              </span>
            </div>
          </>
        ) : isDemoMonth ? (
          eventList(true)
        ) : (
          <div className="dp-empty-state">
            <CalendarDays size={32} />
            <h3>아직 잡힌 모임이 없어요</h3>
            <p>다음 만남을 기다리고 있어요.</p>
          </div>
        )}
      </section>
      <div className="dp-calendar-mobile-list">
        {isDemoMonth && view === "calendar" && (
          <section className="dp-panel dp-paper">
            <SectionTitle title="이번 달 모임" />
            {eventList(true)}
          </section>
        )}
      </div>
    </>
  );
}
