"""
코트 예약 시트(일정 자동 등록 양식) 읽기 — DB 와 무관한 순수 함수.

한 행 = 코트 한 면 예약
    날짜 | 시간 | 코트 번호 | 예약자명 | 코트요정 | 코트비 | 캔볼비(선택) | 사용 여부 | 최대 인원(선택) | 장소 | 비고

- 필수: 날짜 · 시간 · 코트 번호 · 예약자명 · 코트요정 · 코트비 · 사용 여부 · 장소
- 사용 여부가 오테식 정모 / 오테식 벙개 / 일반 벙개인 행만 모임이 된다.
  예약대기 · 결재 대기 · 예약취소 · 우천 취소 · 개인 사용 등은 모임이 아니라 건너뛴다.
- 날짜 · 시간 · 장소 · 사용 여부가 같은 행은 한 모임으로 묶는다(코트 여러 면, 예약자 여러 명).
- 예약자명·코트요정은 적은 이름 그대로 쓴다(회원이 아니어도 된다).
- 오테식 모임 코트비는 총무가 코트요정에게 정산한다 → 코트요정이 지급 내역의 받는 사람.
  코트요정이 회원이면 그 회원 앞으로(환급 계좌 표시), 아니면 이름만 남긴다(가입이 승인되면 이어진다).
  일반 벙개는 참석자끼리 코트비 + 캔볼비를 n빵한다.
- 최대 인원을 비우면 오테식 모임은 코트 수 × SEATS_PER_COURT(회칙 제10조, 1면당 6명)로 정한다.
  정원이 있어야 다 찼을 때 대기 신청이 된다. 일반 벙개는 비우면 인원 제한이 없다.
- 날짜만 미리 채워 두고 나머지가 빈 행(양식 기본값)은 빈 행으로 본다.

헤더는 띄어쓰기와 "(선택)" 을 무시하고 찾는다("날 짜", "사용 여부", "캔볼비(선택)" 모두 인식).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time

from .models import GatheringKind

# 정규화한 헤더 → 필드
COURT_SHEET_HEADERS = {
    "날짜": "event_date",
    "시간": "time_range",
    "코트번호": "court",
    "예약자명": "booker",
    "코트요정": "fairy",
    "코트비": "court_fee",
    "캔볼비": "ball_fee",
    "사용여부": "usage",
    "최대인원": "max_participants",
    "장소": "location",
    "비고": "note",
}
REQUIRED = ["event_date", "time_range", "court", "booker", "fairy", "court_fee", "usage", "location"]
LABEL = {
    "event_date": "날짜",
    "time_range": "시간",
    "court": "코트 번호",
    "booker": "예약자명",
    "fairy": "코트요정",
    "court_fee": "코트비",
    "ball_fee": "캔볼비",
    "usage": "사용 여부",
    "max_participants": "최대 인원",
    "location": "장소",
    "note": "비고",
}

# 사용 여부 → 모임 종류 (띄어쓰기 무시). 그 밖의 값은 모임이 아니다.
USAGE_KINDS = {
    "오테식정모": GatheringKind.CLUB_REGULAR,
    "오테식벙개": GatheringKind.CLUB_FLASH,
    "일반벙개": GatheringKind.FLASH,
}
KIND_TITLE = {
    GatheringKind.CLUB_REGULAR: "오테식 정모",
    GatheringKind.CLUB_FLASH: "오테식 벙개",
    GatheringKind.FLASH: "일반 벙개",
}

# 양식의 시간 칸 선택지 (2시간 단위)
TIME_SLOTS = [
    "09:00~11:00", "10:00~12:00", "11:00~13:00", "12:00~14:00", "13:00~15:00", "14:00~16:00",
    "15:00~17:00", "16:00~18:00", "17:00~19:00", "18:00~20:00", "19:00~21:00", "20:00~22:00",
]
USAGE_OPTIONS = [
    "오테식 정모", "오테식 벙개", "일반 벙개", "예약대기", "결재 대기", "예약취소", "우천 취소",
    "최코치님 사용", "예약 (비고에 예약자 작성)", "개인 사용 (비고에 사용자)",
]
# 양식의 예약자명 선택지: 코트 예약에 쓰는 이름 (목록에 없는 이름도 적을 수 있다)
BOOKER_NAMES = [
    "장미주", "김다빈", "이민석", "곽도언", "송승진", "서승우", "황규식", "김수현", "김응희", "안연숙",
]
# 회칙 제10조: 코트 1면당 참가 정원 (최대 인원을 비운 오테식 모임에 적용)
SEATS_PER_COURT = 6
# 양식에서 드롭다운·날짜 검사를 거는 행 수 (2행부터)
TEMPLATE_ROWS = 100
# 날짜 칸 검사 범위: 2020-01-01 ~ 2099-12-31 (엑셀 날짜 일련번호)
DATE_MIN_SERIAL = 43831
DATE_MAX_SERIAL = 73050
TEMPLATE_HEADERS = [
    "날짜", "시간", "코트 번호", "예약자명", "코트요정", "코트비", "캔볼비(선택)",
    "사용 여부", "최대 인원(선택)", "장소", "비고",
]


def normalize_header(value) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", "", text).replace("(선택)", "")


def is_court_sheet(header: tuple) -> bool:
    names = {normalize_header(h) for h in header}
    return {"예약자명", "코트요정", "사용여부"} <= names


def column_map(header: tuple) -> dict[str, int]:
    """필드 → 열 번호."""
    out: dict[str, int] = {}
    for idx, name in enumerate(header):
        key = normalize_header(name)
        if key in COURT_SHEET_HEADERS and COURT_SHEET_HEADERS[key] not in out:
            out[COURT_SHEET_HEADERS[key]] = idx
    return out


def _blank(v) -> bool:
    return v is None or str(v).strip() == ""


def _text(v) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return " ".join(str(v).split())


def parse_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    m = re.fullmatch(r"\s*(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?\s*", str(v))
    if not m:
        raise ValueError("날짜는 2026-10-17 처럼 적어 주세요.")
    return date(int(m[1]), int(m[2]), int(m[3]))


_TIME_RANGE = re.compile(
    r"\s*(\d{1,2})\s*(?::\s*(\d{2}))?\s*시?\s*[~∼\-–]\s*(\d{1,2})\s*(?::\s*(\d{2}))?\s*시?\s*"
)


def parse_time_range(v) -> tuple[time, time]:
    m = _TIME_RANGE.fullmatch(str(v))
    if not m:
        raise ValueError("시간은 10:00~12:00 처럼 적어 주세요.")
    sh, sm, eh, em = int(m[1]), int(m[2] or 0), int(m[3]), int(m[4] or 0)
    if sh > 23 or eh > 24 or sm > 59 or em > 59:
        raise ValueError("시간은 10:00~12:00 처럼 적어 주세요.")
    end = time(23, 59) if eh == 24 else time(eh, em)
    return time(sh, sm), end


def parse_court(v) -> str:
    """'3', 3, '3번', '3번 코트' → '3'. 여러 면은 '3, 5'."""
    raw = _text(v).replace("코트", "").replace("번", "")
    parts = [p.strip() for p in re.split(r"[,/·]", raw) if p.strip()]
    if not parts:
        raise ValueError("코트 번호를 적어 주세요.")
    return ", ".join(parts)


def parse_amount(v, label: str, positive: bool) -> int:
    try:
        n = int(float(str(v).replace(",", "").replace("원", "").strip()))
    except ValueError:
        raise ValueError(f"{label}는 숫자로 적어 주세요.")
    if n < 0 or (positive and n == 0):
        raise ValueError(f"{label}는 0보다 커야 해요." if positive else f"{label}는 0 이상이어야 해요.")
    return n


@dataclass
class SheetRow:
    row: int
    event_date: date
    start: time
    end: time
    court: str
    booker: str
    fairy: str
    court_fee: int
    ball_fee: int
    usage: str
    kind: GatheringKind
    location: str
    max_participants: int | None = None
    note: str | None = None

    @property
    def key(self) -> tuple:
        return group_key(self.event_date, self.start, self.end, self.location, self.kind)


def group_key(d: date, start: time, end: time, location: str, kind) -> tuple:
    return (d, start, end, " ".join(location.split()), kind)


@dataclass
class RowProblem:
    row: int
    message: str
    key: tuple | None = None  # 어느 모임 행인지 알 수 있으면 — 그 모임은 통째로 보류한다


@dataclass
class RowSkip:
    """모임이 아닌 행 (예약대기·우천 취소·개인 사용 등)."""

    row: int
    message: str


def parse_row(
    row_no: int, values: tuple, cols: dict[str, int]
) -> SheetRow | RowProblem | RowSkip | None:
    """한 행을 읽는다. 빈 행이면 None, 모임이 아니면 RowSkip, 문제가 있으면 RowProblem."""
    cell = {f: (values[i] if i < len(values) else None) for f, i in cols.items()}
    if all(_blank(v) for f, v in cell.items() if f != "event_date"):
        return None  # 완전히 빈 행 또는 날짜만 미리 채워 둔 행

    usage = _text(cell["usage"]) if "usage" in cols and not _blank(cell.get("usage")) else ""
    kind = USAGE_KINDS.get(re.sub(r"\s+", "", usage))
    if usage and kind is None:
        # 모임이 아닌 사용 여부는 다른 칸이 비어 있어도 따지지 않는다
        return RowSkip(row_no, f"사용 여부가 '{usage}'라 모임으로 등록하지 않았어요")

    errors: list[str] = []
    missing = [LABEL[f] for f in REQUIRED if f not in cols or _blank(cell.get(f))]
    if missing:
        errors.append(f"필수 칸이 비었어요: {', '.join(missing)}")

    parsed: dict = {}

    def attempt(f: str, fn):
        if f in cols and not _blank(cell.get(f)):
            try:
                parsed[f] = fn(cell[f])
            except ValueError as e:
                errors.append(str(e))

    attempt("event_date", parse_date)
    attempt("time_range", parse_time_range)
    attempt("court", parse_court)
    attempt("court_fee", lambda v: parse_amount(v, "코트비", positive=True))
    attempt("ball_fee", lambda v: parse_amount(v, "캔볼비", positive=False))
    attempt("max_participants", lambda v: parse_amount(v, "최대 인원", positive=True))
    for f in ("booker", "fairy", "location", "note", "usage"):
        if f in cols and not _blank(cell.get(f)):
            parsed[f] = _text(cell[f])

    key = None
    if {"event_date", "time_range", "location", "usage"} <= parsed.keys():
        key = group_key(parsed["event_date"], *parsed["time_range"], parsed["location"], kind)
    if errors:
        return RowProblem(row_no, " · ".join(errors), key)

    start, end = parsed["time_range"]
    return SheetRow(
        row=row_no,
        event_date=parsed["event_date"],
        start=start,
        end=end,
        court=parsed["court"],
        booker=parsed["booker"],
        fairy=parsed["fairy"],
        court_fee=parsed["court_fee"],
        ball_fee=parsed.get("ball_fee", 0),
        usage=parsed["usage"],
        kind=kind,
        location=parsed["location"],
        max_participants=parsed.get("max_participants"),
        note=parsed.get("note"),
    )


@dataclass
class SheetGroup:
    """한 모임이 될 행들 (날짜·시간·장소·종류가 같다)."""

    rows: list[SheetRow] = field(default_factory=list)

    @property
    def first(self) -> SheetRow:
        return self.rows[0]

    @property
    def row_text(self) -> str:
        return "·".join(str(r.row) for r in self.rows) + "행"

    @property
    def courts(self) -> list[str]:
        return [c for r in self.rows for c in r.court.split(", ")]

    @property
    def fairies(self) -> list[str]:
        return list(dict.fromkeys(r.fairy for r in self.rows))

    @property
    def notes(self) -> list[str]:
        return list(dict.fromkeys(r.note for r in self.rows if r.note))


def group_rows(rows: list[SheetRow]) -> list[SheetGroup]:
    groups: dict[tuple, SheetGroup] = {}
    for r in rows:
        groups.setdefault(r.key, SheetGroup()).rows.append(r)
    return list(groups.values())
