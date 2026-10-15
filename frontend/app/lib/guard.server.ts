// 게스트 접근 제한: 게스트는 일정(홈·캘린더·모임)만 본다 (서버 User.is_guest 와 같은 기준)
import { redirect } from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { isGuest } from "~/lib/club";
import { requireToken } from "~/lib/session.server";
import type { Me, UserBrief } from "~/lib/types";

/** 회원 명단·정산·회칙처럼 게스트에게 보이지 않는 화면: 게스트는 캘린더로 돌려보낸다. */
export async function requireMember(request: Request) {
  const token = await requireToken(request);
  const me = await api<Me>("/users/me", { token });
  if (isGuest(me)) throw redirect("/app/calendar");
  return { token, me };
}

/** 회원 목록(코트요정 고르기용). 게스트는 볼 수 없어 빈 목록이다. */
export async function membersOrEmpty(token: string): Promise<UserBrief[]> {
  try {
    return await api<UserBrief[]>("/users", { token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return [];
    throw err;
  }
}
