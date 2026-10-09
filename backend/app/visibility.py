"""
일정 공개 시점 (회칙 제10·11조).

- 관리자·임원진: 등록하는 즉시 보이고 투표할 수 있다.
- 정회원: 모임이 있는 주의 **월요일 0시**(한국 시간)부터 보이고 투표할 수 있다.
- 게스트: **모임 3일 전 0시**부터. 단 정회원 공개보다 앞서지 않는다
  (월요일 모임이면 게스트도 그 주 월요일 0시부터).
"""
from datetime import date, datetime, time, timedelta, timezone

from .models import Gathering, MemberType, User

KST = timezone(timedelta(hours=9))  # 한국은 서머타임이 없어 고정 오프셋으로 충분
GUEST_OPEN_DAYS = 3


def now_kst() -> datetime:
    """현재 한국 시각 (naive). 테스트에서 바꿔 끼울 수 있게 함수로 둔다."""
    return datetime.now(KST).replace(tzinfo=None)


def member_open_at(event_date: date) -> datetime:
    """정회원 공개 시각: 모임이 있는 주의 월요일 0시."""
    monday = event_date - timedelta(days=event_date.weekday())
    return datetime.combine(monday, time.min)


def guest_open_at(event_date: date) -> datetime:
    """게스트 공개 시각: 모임 3일 전 0시 (정회원 공개 이후)."""
    return max(
        member_open_at(event_date),
        datetime.combine(event_date - timedelta(days=GUEST_OPEN_DAYS), time.min),
    )


def sees_early(user: User) -> bool:
    """공개 시점과 관계없이 모든 일정을 보는 사람: 관리자·임원진."""
    return user.is_admin or user.member_type == MemberType.OFFICER


def open_at_for(user: User, event_date: date) -> datetime | None:
    """이 회원에게 일정이 열리는 시각. 바로 보이면 None."""
    if sees_early(user):
        return None
    if user.member_type == MemberType.GUEST:
        return guest_open_at(event_date)
    return member_open_at(event_date)


def is_open_for(user: User, gathering: Gathering, now: datetime | None = None) -> bool:
    opens = open_at_for(user, gathering.event_date)
    return opens is None or (now or now_kst()) >= opens


def format_open_at(at: datetime) -> str:
    """'10월 13일(월) 0시' 같은 안내 문구."""
    weekday = "월화수목금토일"[at.weekday()]
    return f"{at.month}월 {at.day}일({weekday}) {at.hour}시"
