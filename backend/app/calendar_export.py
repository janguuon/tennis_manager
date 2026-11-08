"""
모임을 폰 캘린더에 넣기: iCalendar(.ics) 파일과 구글 캘린더 일정 추가 링크.

- 아이폰·맥: .ics 를 열면 '캘린더에 추가' 창이 뜬다.
- 안드로이드: 구글 캘린더 일정 추가 화면 링크(구글 캘린더 앱은 .ics 를 열지 못한다). 삼성 캘린더 등은 .ics.
- 시간은 한국 시간. 시작 시각이 없으면 하루 종일 일정, 끝 시각이 없으면 2시간으로 잡는다.
- 알림은 1시간 전(하루 종일 일정은 전날 오전 9시). 구글 링크는 알림을 정할 수 없어 그 사람의 기본 알림을 쓴다.
- 저장한 뒤 모임이 바뀌거나 취소돼도 폰 캘린더에는 반영되지 않는다(다시 추가하면 같은 일정 UID 라 덮어쓰는 앱도 있다).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

from .models import Gathering, GatheringStatus
from .schedule_import import KIND_TITLE

KST = timezone(timedelta(hours=9))
DEFAULT_LENGTH = timedelta(hours=2)
ALARM_BEFORE = "-PT1H"
ALL_DAY_ALARM = "-PT15H"  # 하루 종일 일정: 0시 15시간 전 = 전날 오전 9시
SURFACE_LABEL = {"hard": "하드", "turf": "인조잔디", "clay": "클레이", "carpet": "카펫"}
GOOGLE_TEMPLATE = "https://calendar.google.com/calendar/render"


def summary(g: Gathering) -> str:
    """'[교류전] A클럽 교류전'. 제목이 종류 이름 그대로면 한 번만('오테식 정모'). 취소된 모임은 '(취소)'."""
    label = KIND_TITLE[g.kind]
    title = " ".join((g.title or "").split()) or label
    text = title if title == label else f"[{label}] {title}"
    return f"(취소) {text}" if g.status == GatheringStatus.CANCELED else text


def span(g: Gathering) -> tuple[datetime | date, datetime | date, bool]:
    """(시작, 끝, 하루 종일). 끝 시각이 시작보다 이르면(자정 넘김) 다음 날로 본다."""
    if g.start_time is None:
        return g.event_date, g.event_date + timedelta(days=1), True
    start = datetime.combine(g.event_date, g.start_time, KST)
    if g.end_time is None:
        end = start + DEFAULT_LENGTH
    else:
        end = datetime.combine(g.event_date, g.end_time, KST)
        if end <= start:
            end += timedelta(days=1)
    return start, end, False


def place(g: Gathering) -> str:
    """지도에서 찾기 좋게 주소가 있으면 주소, 없으면 장소 이름."""
    return " ".join((g.address or g.location or "").split())


def details(g: Gathering, link: str | None) -> str:
    lines: list[str] = []
    if g.location and g.address:
        lines.append(f"장소: {g.location}")
    court = f"{g.court_numbers}번 ({g.court_count}면)" if g.court_numbers else f"{g.court_count}면"
    if g.court_surface in SURFACE_LABEL:
        court += f" · {SURFACE_LABEL[g.court_surface]}"
    lines.append(f"코트: {court}")
    if g.status == GatheringStatus.CANCELED and g.cancel_reason:
        lines.append(f"취소: {g.cancel_reason}")
    if link:
        lines.append(f"모임 화면: {link}")
    return "\n".join(lines)


# --- iCalendar --------------------------------------------------------------
def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\n").replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """RFC 5545: 한 줄은 75바이트까지. 한글(3바이트)이 잘리지 않게 글자 단위로 접는다."""
    out: list[str] = []
    current, size = "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        limit = 75 if not out else 74  # 이어지는 줄은 맨 앞 공백 한 칸을 뺀다
        if size + n > limit:
            out.append(current)
            current, size = "", 0
        current += ch
        size += n
    out.append(current)
    return "\r\n ".join(out)


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _day(d: date) -> str:
    return d.strftime("%Y%m%d")


def ics(g: Gathering, link: str | None = None, now: datetime | None = None) -> str:
    start, end, all_day = span(g)
    title = summary(g)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Otesik//Tennis Manager//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:gathering-{g.id}@otesik",
        f"DTSTAMP:{_utc(now or datetime.now(timezone.utc))}",
    ]
    if all_day:
        lines += [f"DTSTART;VALUE=DATE:{_day(start)}", f"DTEND;VALUE=DATE:{_day(end)}"]
    else:
        lines += [f"DTSTART:{_utc(start)}", f"DTEND:{_utc(end)}"]
    lines.append(f"SUMMARY:{_escape(title)}")
    if place(g):
        lines.append(f"LOCATION:{_escape(place(g))}")
    lines.append(f"DESCRIPTION:{_escape(details(g, link))}")
    if link:
        lines.append(f"URL:{link}")
    lines.append("STATUS:" + ("CANCELLED" if g.status == GatheringStatus.CANCELED else "CONFIRMED"))
    if g.status != GatheringStatus.CANCELED:
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_escape(title)}",
            f"TRIGGER:{ALL_DAY_ALARM if all_day else ALARM_BEFORE}",
            "END:VALARM",
        ]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


# --- 구글 캘린더 -------------------------------------------------------------
def google_url(g: Gathering, link: str | None = None) -> str:
    start, end, all_day = span(g)
    dates = f"{_day(start)}/{_day(end)}" if all_day else f"{_utc(start)}/{_utc(end)}"
    params = {"action": "TEMPLATE", "text": summary(g), "dates": dates, "details": details(g, link), "ctz": "Asia/Seoul"}
    if place(g):
        params["location"] = place(g)
    return f"{GOOGLE_TEMPLATE}?{urlencode(params)}"


def safe_link(link: str | None) -> str | None:
    """설명에 넣을 모임 화면 주소: http(s) 한 줄만."""
    if not link:
        return None
    link = link.strip()
    if not link.startswith(("https://", "http://")) or any(c in link for c in "\r\n \t"):
        return None
    return link[:300]
