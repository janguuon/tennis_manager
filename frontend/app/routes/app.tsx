import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, NavLink, Outlet, useLoaderData, useLocation, useRouteLoaderData } from "@remix-run/react";

import { ApiError, api } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";
import type { User } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const token = await requireToken(request);
  try {
    const user = await api<User>("/users/me", { token });
    return json({ user });
  } catch (err) {
    // 토큰 만료/무효 → 로그아웃 처리
    if (err instanceof ApiError && err.status === 401) {
      throw redirect("/logout");
    }
    throw err;
  }
}

const navItems = [
  { to: "/app/calendar", label: "캘린더" },
  { to: "/app/ranking", label: "랭킹" },
  { to: "/app/members", label: "회원" },
  { to: "/app/payments", label: "정산" },
];

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData("root") as { theme?: string } | undefined;
  const theme = rootData?.theme === "dark" ? "dark" : "light";
  const location = useLocation();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/70 shadow-sm shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/app" className="flex items-center gap-1.5 text-base font-extrabold tracking-tight sm:text-lg">
              <span>🎾</span>
              <span className="bg-gradient-to-r from-court-600 to-court-800 bg-clip-text text-transparent dark:from-court-400 dark:to-court-500">
                테니스 매니저
              </span>
            </NavLink>
            <nav className="hidden gap-1 sm:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      isActive
                        ? "bg-gradient-to-r from-court-500 to-emerald-600 text-white shadow-md shadow-court-500/30"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {user.is_admin ? (
                <NavLink
                  to="/app/admin"
                  className={({ isActive }) =>
                    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      isActive
                        ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`
                  }
                >
                  관리자
                </NavLink>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <NavLink
              to="/app/mypage"
              className={({ isActive }) =>
                `text-sm font-medium ${
                  isActive ? "text-court-700 dark:text-court-300" : "text-slate-600 hover:text-court-700 dark:text-slate-300"
                }`
              }
              title="마이페이지"
            >
              {user.name}
              {user.is_admin ? <span className="ml-1 text-court-600 dark:text-court-400">(관리자)</span> : null}
            </NavLink>
            <Form method="post" action="/resources/theme">
              <input type="hidden" name="theme" value={theme === "dark" ? "light" : "dark"} />
              <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
              <button
                type="submit"
                className="btn-ghost px-2 py-1.5 text-sm"
                title={theme === "dark" ? "라이트 모드로" : "다크 모드로"}
                aria-label="테마 전환"
              >
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
            </Form>
            <Form method="post" action="/logout">
              <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
                로그아웃
              </button>
            </Form>
          </div>
        </div>

        {/* 모바일 내비 */}
        <nav className="flex gap-1 border-t border-slate-100 px-4 py-2 dark:border-slate-800 sm:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 rounded-full px-2 py-1.5 text-center text-sm font-semibold transition ${
                  isActive
                    ? "bg-gradient-to-r from-court-500 to-emerald-600 text-white shadow-sm shadow-court-500/30"
                    : "text-slate-500 dark:text-slate-300"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
        <div key={location.pathname} className="animate-fade-in-up">
          <Outlet context={{ user }} />
        </div>
      </main>
    </div>
  );
}
