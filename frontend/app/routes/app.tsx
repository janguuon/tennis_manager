import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, NavLink, Outlet, useLoaderData, useLocation, useRouteLoaderData } from "@remix-run/react";
import {
  ArrowUpRight,
  CalendarDays,
  House,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

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

/** 메뉴: 페이지마다 대표색 타일 (그 페이지의 강조색과 같다) */
type NavItem = { to: string; label: string; icon: LucideIcon; tile: string; end?: boolean };
const navItems: NavItem[] = [
  { to: "/app", label: "홈", icon: House, tile: "bg-house-blue text-ink", end: true },
  { to: "/app/calendar", label: "캘린더", icon: CalendarDays, tile: "bg-house-yellow text-ink" },
  { to: "/app/payments", label: "정산", icon: Wallet, tile: "bg-house-orange text-ink" },
  { to: "/app/ranking", label: "랭킹", icon: Trophy, tile: "bg-house-green text-ink" },
  { to: "/app/members", label: "회원", icon: Users, tile: "bg-house-lav text-ink" },
];
const adminItem: NavItem = {
  to: "/app/admin",
  label: "관리자",
  icon: ShieldCheck,
  tile: "bg-ink text-white dark:ring-1 dark:ring-inset dark:ring-white/15",
};

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData("root") as { theme?: string } | undefined;
  const theme = rootData?.theme === "dark" ? "dark" : "light";
  const location = useLocation();
  const items = user.is_admin ? [...navItems, adminItem] : navItems;
  // 모임 상세·일자 페이지는 캘린더 메뉴 소속으로 표시
  const inCalendar = /^\/app\/(gatherings|day)\//.test(location.pathname);
  const isCurrent = (to: string, isActive: boolean) => isActive || (inCalendar && to === "/app/calendar");
  const initial = user.name.charAt(0);

  const themeToggle = (className: string, iconSize: number) => (
    <Form method="post" action="/resources/theme">
      <input type="hidden" name="theme" value={theme === "dark" ? "light" : "dark"} />
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      <button
        type="submit"
        className={className}
        title={theme === "dark" ? "라이트 모드로" : "다크 모드로"}
        aria-label="테마 전환"
      >
        {theme === "dark" ? <Sun size={iconSize} /> : <Moon size={iconSize} />}
      </button>
    </Form>
  );
  const logoutButton = (className: string, iconSize: number) => (
    <Form method="post" action="/logout">
      <button type="submit" className={className} title="로그아웃" aria-label="로그아웃">
        <LogOut size={iconSize} />
      </button>
    </Form>
  );
  const sideIconBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white";

  return (
    <div className="min-h-screen">
      {/* 데스크톱: 왼쪽 번호 타일 메뉴 */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[156px] flex-col gap-2 overflow-y-auto p-3 md:flex">
        <NavLink to="/app" className="px-1.5 pb-3 pt-2">
          <Wordmark />
        </NavLink>
        {items.map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex h-[84px] shrink-0 flex-col justify-between rounded-2xl p-3 font-bold transition-transform hover:-translate-y-0.5 ${item.tile} ${
                isCurrent(item.to, isActive)
                  ? item.to === adminItem.to
                    ? "ring-[3px] ring-inset ring-house-yellow"
                    : "ring-[3px] ring-inset ring-ink"
                  : ""
              }`
            }
          >
            <span className="flex items-center justify-between text-[13px]">
              {String(i + 1).padStart(2, "0")}
              <ArrowUpRight size={15} />
            </span>
            <span className="text-[15px]">{item.label}</span>
          </NavLink>
        ))}

        <div className="mt-auto space-y-2 pt-2">
          <NavLink
            to="/app/mypage"
            title="마이페이지"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-2xl bg-ink p-2.5 text-white ${
                isActive ? "ring-[3px] ring-inset ring-house-yellow" : "dark:ring-1 dark:ring-inset dark:ring-white/15"
              }`
            }
          >
            <span className="avatar h-7 w-7 bg-house-yellow text-[13px] text-ink">{initial}</span>
            <span className="min-w-0 truncate text-sm font-bold">{user.name}</span>
          </NavLink>
          <div className="flex items-center justify-around rounded-2xl bg-ink p-1 text-white dark:ring-1 dark:ring-inset dark:ring-white/15">
            {themeToggle(sideIconBtn, 17)}
            {logoutButton(sideIconBtn, 17)}
          </div>
        </div>
      </aside>

      {/* 모바일: 위 로고 줄 */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between bg-slate-50/90 px-4 backdrop-blur-md dark:bg-slate-950/90 md:hidden">
        <NavLink to="/app">
          <Wordmark size="sm" />
        </NavLink>
        <div className="flex items-center gap-1">
          {themeToggle("icon-btn", 19)}
          {logoutButton("icon-btn", 19)}
          <NavLink
            to="/app/mypage"
            aria-label="마이페이지"
            className={({ isActive }) =>
              `avatar ml-1 h-10 w-10 rounded-xl bg-ink text-[15px] text-house-yellow dark:bg-slate-800 ${isActive ? "ring-[3px] ring-house-yellow" : ""}`
            }
          >
            {initial}
          </NavLink>
        </div>
      </header>

      <main className="pb-28 md:pb-10 md:pl-[156px]">
        <div key={location.pathname} className="animate-fade-in px-3 pt-1 motion-reduce:animate-none sm:px-4 md:pr-4 md:pt-3">
          <Outlet context={{ user }} />
        </div>
      </main>

      {/* 모바일: 떠 있는 검정 탭바 */}
      <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-20 flex h-16 items-center justify-around rounded-[22px] bg-ink px-1 shadow-pop dark:ring-1 dark:ring-inset dark:ring-white/10 md:hidden">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 text-[10.5px] font-bold transition-colors ${
                isCurrent(to, isActive) ? "text-white" : "text-white/55"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-8 w-11 items-center justify-center rounded-xl transition-colors ${
                    isCurrent(to, isActive) ? "bg-house-yellow text-ink" : ""
                  }`}
                >
                  <Icon size={19} strokeWidth={isCurrent(to, isActive) ? 2.3 : 1.9} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
