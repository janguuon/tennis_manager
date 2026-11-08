"""
참석 일정 구독 — 내가 참석(대기 포함)한 모임을 폰 캘린더에 구독한다.

- 회원마다 비밀 링크(토큰)를 만든다. 캘린더 앱은 로그인할 수 없어 링크 자체가 열쇠다.
  다시 만들면 예전 링크는 끊기고, 끊기를 누르면 링크가 없어진다.
- GET /calendar-feed/{token}.ics (로그인 없음): 지난 30일부터 앞으로의 모임 중 내가 참석·대기인 것.
  대기는 제목 앞에 '(대기)', 취소된 모임은 '(취소)'. 불참·투표 취소한 모임은 빠진다.
  캘린더 앱이 주기적으로 다시 받아 가므로 시간 변경·취소가 따라온다(아이폰은 기기 설정, 구글은 몇 시간~하루).
- 탈퇴했거나 승인되지 않은 회원의 링크는 열리지 않는다.
"""
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import calendar_export
from ..database import get_db
from ..deps import get_current_user
from ..models import ApprovalStatus, AttendanceStatus, Gathering, Participant, User

router = APIRouter(tags=["calendar"])

FEED_PAST_DAYS = 30


class CalendarFeedRead(BaseModel):
    """내 구독 링크 토큰. 없으면 None (화면이 주소를 만든다)."""

    token: str | None = None


@router.get("/users/me/calendar-feed", response_model=CalendarFeedRead)
def my_calendar_feed(current_user: User = Depends(get_current_user)):
    return CalendarFeedRead(token=current_user.calendar_token)


@router.post("/users/me/calendar-feed", response_model=CalendarFeedRead)
def make_calendar_feed(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """구독 링크 만들기·다시 만들기 (예전 링크는 끊긴다)."""
    current_user.calendar_token = secrets.token_urlsafe(24)
    db.commit()
    return CalendarFeedRead(token=current_user.calendar_token)


@router.delete("/users/me/calendar-feed", status_code=status.HTTP_204_NO_CONTENT)
def stop_calendar_feed(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """구독 링크 끊기. 이미 구독한 캘린더는 더 이상 새로 받지 못한다."""
    current_user.calendar_token = None
    db.commit()


def feed_entries(db: Session, user: User, today: date | None = None) -> list[tuple[Gathering, str]]:
    since = (today or date.today()) - timedelta(days=FEED_PAST_DAYS)
    rows = db.execute(
        select(Gathering, Participant.status)
        .join(Participant, Participant.gathering_id == Gathering.id)
        .where(
            Participant.user_id == user.id,
            Participant.status.in_((AttendanceStatus.ATTENDING, AttendanceStatus.WAITING)),
            Gathering.event_date >= since,
        )
        .order_by(Gathering.event_date, Gathering.start_time, Gathering.id)
    ).all()
    return [(g, "(대기) " if s == AttendanceStatus.WAITING else "") for g, s in rows]


@router.get("/calendar-feed/{token}.ics")
def calendar_feed(
    token: str,
    base: str | None = Query(None, max_length=200, description="모임 화면 링크를 만들 앱 주소 (https://…)"),
    db: Session = Depends(get_db),
):
    """참석 일정 구독 (로그인 없음, 링크가 열쇠)."""
    user = db.scalar(select(User).where(User.calendar_token == token)) if len(token) >= 16 else None
    if user is None or not user.is_active or user.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="구독 주소를 찾을 수 없어요. 마이페이지에서 다시 만들어 주세요.")
    base = calendar_export.safe_link(base)
    body = calendar_export.feed(feed_entries(db, user), base.rstrip("/") if base else None)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )
