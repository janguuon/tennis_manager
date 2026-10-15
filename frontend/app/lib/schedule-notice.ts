// 새 일정을 올린 뒤(한 건 등록 · 엑셀 등록) 단톡방에 알릴 문구 (카톡 공유 · 복사)
import { KIND_LABEL } from "~/lib/club";
import { WEEKDAYS, formatOpenAt } from "~/lib/status";
import type { GatheringKind } from "~/lib/types";

/** 새로 올린 일정 한 건 (엑셀 등록 결과 items, 또는 한 건 등록 응답) */
export type NewSchedule = {
  id: number;
  title: string;
  kind: GatheringKind;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  court_numbers: string | null;
  // 한 건 등록 응답에만 있다: 이 일정이 언제 공개되고 투표가 열리는지
  member_open_at?: string | null;
  guest_vote_open_at?: string | null;
  open_to_members?: boolean;
  guest_vote_open?: boolean;
};

/** 단톡방 문구의 종류 이름: 정모만 줄이고, 벙개는 오테식/일반을 구분해 그대로 */
const NOTICE_NAME: Record<GatheringKind, string> = {
  club_regular: "정모",
  club_flash: "오테식 벙개",
  flash: "일반 벙개",
};

const header = (n: number) =>
  n === 1 ? "🎾 새 코트 일정이 올라왔어요" : `🎾 새 코트 일정 ${n}건이 올라왔어요`;
const FOOTER =
  "정회원 참석 투표는 전주 금요일 오전 10시부터, 게스트 투표는 모임 3일 전 0시부터 열려요.";

/** 한 건이면 그 일정의 공개·투표 시각으로, 여러 건이면 공통 규칙으로 */
function footer(items: NewSchedule[]): string {
  const g = items.length === 1 ? items[0] : null;
  if (!g?.member_open_at || !g.guest_vote_open_at) return FOOTER;
  const member = formatOpenAt(g.member_open_at);
  const guest = formatOpenAt(g.guest_vote_open_at);
  if (g.open_to_members && g.guest_vote_open)
    return "지금 바로 참석 투표할 수 있어요.";
  if (g.open_to_members)
    return `정회원은 지금 바로, 게스트는 ${guest}부터 참석 투표할 수 있어요.`;
  if (member === guest) return `${member}에 공개되고 참석 투표가 열려요.`;
  return `${member}에 공개돼요. 게스트 투표는 ${guest}부터 열려요.`;
}

/** "3, 5" → "3·5번". 숫자가 아닌 이름이 섞이면 그대로 둔다. */
function courtText(raw: string | null): string {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.every((p) => /^\d+$/.test(p))
    ? `${parts.join("·")}번`
    : parts.join(", ");
}

/** "10/17(토) 10:00 정모 · 시민 테니스장 3·5번" */
export function scheduleLine(g: NewSchedule): string {
  const [y, m, d] = g.event_date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const when = `${m}/${d}(${wd})${
    g.start_time ? ` ${g.start_time.slice(0, 5)}` : ""
  }`;
  // 엑셀 새 양식은 제목이 종류 이름이라 짧은 이름으로, 직접 붙인 제목은 그대로
  const name = g.title === KIND_LABEL[g.kind] ? NOTICE_NAME[g.kind] : g.title;
  const where = [g.location, courtText(g.court_numbers)]
    .filter(Boolean)
    .join(" ");
  return `${when} ${name}${where ? ` · ${where}` : ""}`;
}

/** 복사용 전체 문구 (일정 전부 + 링크) */
export function scheduleNoticeText(items: NewSchedule[], url: string): string {
  return [
    header(items.length),
    ...items.map(scheduleLine),
    "",
    footer(items),
    `👉 일정 보기: ${url}`,
  ].join("\n");
}

/**
 * 카톡 공유용 문구: limit 글자 안에 들도록 앞에서부터 일정을 넣고
 * 나머지는 "외 N건"으로 줄인다. 링크는 공유 메시지의 버튼으로 붙는다.
 */
export function scheduleNoticeShort(
  items: NewSchedule[],
  limit: number
): string {
  const lines = items.map(scheduleLine);
  const build = (k: number) =>
    [
      header(items.length),
      ...lines.slice(0, k),
      ...(k < lines.length ? [`외 ${lines.length - k}건`] : []),
      "",
      footer(items),
    ].join("\n");
  let shown = lines.length;
  while (shown > 0 && build(shown).length > limit) shown--;
  const text = build(shown);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** 공유 버튼이 여는 화면: 한 건이면 그 모임, 여러 건이면 가장 빠른 일정의 달 */
export function scheduleNoticePath(items: NewSchedule[]): string {
  if (items.length === 1) return `/app/gatherings/${items[0].id}`;
  return items.length
    ? `/app/calendar?month=${items[0].event_date.slice(0, 7)}`
    : "/app/calendar";
}
