import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
} from "@remix-run/react";
import {
  ArrowUpRight,
  CalendarDays,
  House,
  LogOut,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { MemberAvatar } from "~/components/Club";
import { Wordmark } from "~/components/Logo";
import { ApiError, api } from "~/lib/api.server";
import { getReturnPath, logout, requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const user = await api<User>("/users/me", { token });
    return json({ user });
  } catch (err) {
    // 토큰 만료/무효 → 세션을 지우고 로그인으로(다시 로그인하면 보던 페이지로 복귀).
    // GET /logout 은 쿠키를 지우지 않아 /login ↔ /app 무한 리다이렉트가 났으므로 여기서 직접 정리한다.
    if (err instanceof ApiError && err.status === 401) {
      throw await logout(request, getReturnPath(request));
    }
    throw err;
  }
}

/** Navigation colors remain consistent with each section's accent. */
type NavItem = {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  color: string;
  end?: boolean;
};
const navItems: NavItem[] = [
  {
    to: "/app",
    label: "클럽 홈",
    short: "홈",
    icon: House,
    color: "blue",
    end: true,
  },
  {
    to: "/app/calendar",
    label: "캘린더",
    short: "캘린더",
    icon: CalendarDays,
    color: "yellow",
  },
  {
    to: "/app/payments",
    label: "회비 정산",
    short: "정산",
    icon: Wallet,
    color: "orange",
  },
  {
    to: "/app/ranking",
    label: "우리의 기록",
    short: "랭킹",
    icon: Trophy,
    color: "green",
  },
  {
    to: "/app/members",
    label: "테니스 식구",
    short: "회원",
    icon: Users,
    color: "lav",
  },
  {
    to: "/app/rules",
    label: "클럽 회칙",
    short: "회칙",
    icon: ScrollText,
    color: "ball",
  },
];
const adminItem: NavItem = {
  to: "/app/admin",
  label: "클럽 관리",
  short: "관리자",
  icon: ShieldCheck,
  color: "neutral",
};

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData("root") as { theme?: string } | undefined;
  const theme = rootData?.theme === "dark" ? "dark" : "light";
  const location = useLocation();
  const items = user.is_admin ? [...navItems, adminItem] : navItems;
  const inCalendar = /^\/app\/(gatherings|day)\//.test(location.pathname);
  const isCurrent = (to: string, isActive: boolean) =>
    isActive || (inCalendar && to === "/app/calendar");
  const section = inCalendar
    ? "모임 상세"
    : location.pathname === "/app/mypage"
    ? "마이페이지"
    : items.find((item) =>
        item.end
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to)
      )?.label ?? "오테식";
  const themeToggle = (
    <Form method="post" action="/resources/theme">
      <input
        type="hidden"
        name="theme"
        value={theme === "dark" ? "light" : "dark"}
      />
      <input
        type="hidden"
        name="redirectTo"
        value={location.pathname + location.search}
      />
      <button
        type="submit"
        className="icon-btn"
        title={theme === "dark" ? "라이트 모드로" : "다크 모드로"}
        aria-label="테마 전환"
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </Form>
  );
  const logoutButton = (
    <Form method="post" action="/logout">
      <button
        type="submit"
        className="icon-btn"
        title="로그아웃"
        aria-label="로그아웃"
      >
        <LogOut size={18} />
      </button>
    </Form>
  );
  return (
    <div className="club-shell">
      <a href="#main-content" className="skip-link">
        본문으로 바로가기
      </a>
      <aside className="club-sidebar">
        <NavLink to="/app" className="club-wordmark">
          <Wordmark />
        </NavLink>
        <p className="eyebrow mb-4 mt-12 text-slate-500">OUR CLUBHOUSE</p>
        <nav aria-label="주 메뉴" className="space-y-2">
          {items.map(({ to, label, icon: Icon, color, end }, i) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `club-nav club-nav-${color} ${
                  isCurrent(to, isActive) ? "is-current" : ""
                }`
              }
            >
              <span className="club-nav-icon">
                <Icon size={18} />
              </span>
              <span>{label}</span>
              <span className="club-nav-number">
                {String(i + 1).padStart(2, "0")}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-8">
          <p className="club-motto">
            <span className="mini-tennis-ball" aria-hidden="true" />
            같이 치면,
            <br />더 즐거우니까.
          </p>
          <NavLink to="/app/mypage" className="club-profile">
            <MemberAvatar user={user} />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{user.name}</strong>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {user.is_admin ? "클럽 관리자" : "오늘도 반가워요"}
              </span>
            </span>
            <ArrowUpRight size={16} />
          </NavLink>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] tracking-wider text-slate-500">
              GOOD GAMES, TOGETHER.
            </span>
            <div className="flex">
              {themeToggle}
              {logoutButton}
            </div>
          </div>
        </div>
      </aside>
      <header className="club-mobile-header">
        <NavLink to="/app">
          <Wordmark size="sm" tagline={false} />
        </NavLink>
        <div className="flex items-center gap-1">
          {themeToggle}
          {logoutButton}
          <NavLink to="/app/mypage" aria-label="마이페이지">
            <MemberAvatar user={user} className="!h-9 !w-9" />
          </NavLink>
        </div>
      </header>
      <main id="main-content" className="club-main" tabIndex={-1}>
        <div className="club-breadcrumb">
          <span>
            우리의 작은 테니스 클럽 <span className="px-3 opacity-50">/</span>{" "}
            {section}
          </span>
          <span>오순도순 테니스 식구</span>
        </div>
        <div
          key={location.pathname}
          className="animate-fade-in motion-reduce:animate-none"
        >
          <Outlet context={{ user }} />
        </div>
        <footer className="club-footer">
          <span className="font-display text-2xl font-extrabold tracking-[-0.07em]">
            otesik.
          </span>
          <span>GOOD GAMES. BETTER TOGETHER.</span>
          <span>오순도순 테니스 식구</span>
        </footer>
      </main>
      <nav className="club-bottom-nav" aria-label="모바일 주 메뉴">
        {items.map(({ to, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isCurrent(to, isActive) ? "is-current" : ""
            }
          >
            {({ isActive }) => (
              <>
                <span>
                  <Icon
                    size={20}
                    strokeWidth={isCurrent(to, isActive) ? 2.3 : 1.8}
                  />
                </span>
                <small>{short}</small>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
