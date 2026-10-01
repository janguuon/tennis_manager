import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, NavLink, Outlet, useLoaderData, useLocation, useRouteLoaderData } from "@remix-run/react";
import { CalendarDays, House, LogOut, Moon, ShieldCheck, Sun, Trophy, Users, Wallet, type LucideIcon } from "lucide-react";

import { Logo } from "~/components/Logo";
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

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
const navItems: NavItem[] = [
  { to: "/app", label: "홈", icon: House, end: true },
  { to: "/app/calendar", label: "캘린더", icon: CalendarDays },
  { to: "/app/payments", label: "정산", icon: Wallet },
  { to: "/app/ranking", label: "랭킹", icon: Trophy },
  { to: "/app/members", label: "회원", icon: Users },
];
const adminItem: NavItem = { to: "/app/admin", label: "관리자", icon: ShieldCheck };

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData("root") as { theme?: string } | undefined;
  const theme = rootData?.theme === "dark" ? "dark" : "light";
  const location = useLocation();
  const items = user.is_admin ? [...navItems, adminItem] : navItems;
  // 모임 상세·일자 페이지는 캘린더 메뉴 소속으로 표시
  const inCalendar = /^\/app\/(gatherings|day)\//.test(location.pathname);
  const isCurrent = (to: string, isActive: boolean) => isActive || (inCalendar && to === "/app/calendar");

  return (
    <div className="min-h-screen">
      {/* 헤더: 아래 페이지 히어로(차콜 띠)와 이어지는 같은 색 */}
      <header className="sticky top-0 z-20 bg-slate-900 text-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <NavLink to="/app" className="flex items-center gap-2">
              <Logo size={26} />
              <span className="text-[15px] font-bold tracking-tight">테니스 매니저</span>
            </NavLink>
            <nav className="hidden items-center gap-1 sm:flex">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                      isCurrent(item.to, isActive) ? "bg-white/10 text-ball-400" : "text-white/60 hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1">
            <NavLink
              to="/app/mypage"
              className={({ isActive }) =>
                `mr-1 flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors ${
                  isActive ? "bg-white/10" : "hover:bg-white/10"
                }`
              }
              title="마이페이지"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ball-400 text-xs font-bold text-slate-900">
                {user.name.charAt(0)}
              </span>
              <span className="hidden text-sm font-semibold sm:inline">{user.name}</span>
              {user.is_admin ? <span className="badge-hero hidden sm:inline-flex">관리자</span> : null}
            </NavLink>
            <Form method="post" action="/resources/theme">
              <input type="hidden" name="theme" value={theme === "dark" ? "light" : "dark"} />
              <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
              <button
                type="submit"
                className="icon-btn-hero"
                title={theme === "dark" ? "라이트 모드로" : "다크 모드로"}
                aria-label="테마 전환"
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </Form>
            <Form method="post" action="/logout">
              <button type="submit" className="icon-btn-hero" title="로그아웃" aria-label="로그아웃">
                <LogOut size={18} />
              </button>
            </Form>
          </div>
        </div>
      </header>

      {/* 각 페이지가 PageHero(차콜 띠) + PageBody로 폭을 직접 정한다 */}
      <main className="pb-28 sm:pb-16">
        <div key={location.pathname} className="animate-fade-in motion-reduce:animate-none">
          <Outlet context={{ user }} />
        </div>
      </main>

      {/* 모바일 하단 탭바 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 sm:hidden">
        <div className="flex">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition-colors ${
                  isCurrent(to, isActive) ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-500"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                      isCurrent(to, isActive) ? "bg-ball-400 text-slate-900" : ""
                    }`}
                  >
                    <Icon size={20} strokeWidth={isCurrent(to, isActive) ? 2.2 : 1.8} />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
