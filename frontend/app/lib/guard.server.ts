// 게스트 접근 제한: 게스트는 일정(홈·캘린더·모임)만 본다 (서버 User.is_guest 와 같은 기준)
import { redirect } from "@remix-run/node";

import { ApiError, api } from "~/lib/api.server";
import { isGuest, isOfficer } from "~/lib/club";
import { requireToken } from "~/lib/session.server";
import type { Me, User, UserBrief } from "~/lib/types";

/** 회원 명단·정산·회칙처럼 게스트에게 보이지 않는 화면: 게스트는 캘린더로 돌려보낸다. */
export async function requireMember(request: Request) {
  const token = await requireToken(request);
  const me = await api<Me>("/users/me", { token });
  if (isGuest(me)) throw redirect("/app/calendar");
  return { token, me };
}

/**
 * 회원 목록(코트요정·대회 참가자 고르기용). 게스트는 볼 수 없어 빈 목록이다.
 * 고르는 데 쓰는 칸만 남긴다: 전화번호·이메일 같은 연락처가 페이지 데이터로 브라우저에 가지 않게.
 * hideAdmin: 회원 탭처럼 직함 없는 관리자 계정은 뺀다.
 */
export async function membersOrEmpty(
  token: string,
  { hideAdmin = false }: { hideAdmin?: boolean } = {}
): Promise<UserBrief[]> {
  try {
    const members = (
      await api<(UserBrief & Pick<User, "is_admin">)[]>("/users", { token })
    ).filter(
      (m) => !hideAdmin || !m.is_admin || isOfficer(m)
    );
    return members.map((m) => ({
      id: m.id,
      username: m.username,
      name: m.name,
      nickname: m.nickname,
      gender: m.gender,
      ntrp: m.ntrp,
      member_type: m.member_type,
      avatar_url: m.avatar_url,
      invited_by_id: m.invited_by_id,
      invited_by_name: m.invited_by_name,
      award_gold: m.award_gold,
      award_silver: m.award_silver,
      award_bronze: m.award_bronze,
      award_note: m.award_note,
    }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return [];
    throw err;
  }
}
