"""
픽업 요청 정리 — 참석이 바뀌면 요청·운전자를 맞춘다 (라우터와 무관한 DB 헬퍼).

- 요청자가 더 이상 '참석'이 아니면(불참·대기·투표 취소·탈퇴) 그 요청을 지운다.
- 운전자가 더 이상 '참석'이 아니면 그 요청은 다시 '찾는 중'이 된다.
"""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .models import AttendanceStatus, Participant, PickupRequest


def sync_pickups(db: Session, gathering_id: int) -> None:
    """모임의 픽업 요청을 지금 참석자에 맞춘다. 참석 투표를 바꾼 뒤 부른다."""
    db.flush()
    requests = db.scalars(select(PickupRequest).where(PickupRequest.gathering_id == gathering_id)).all()
    if not requests:
        return
    attending = set(
        db.scalars(
            select(Participant.user_id).where(
                Participant.gathering_id == gathering_id,
                Participant.status == AttendanceStatus.ATTENDING,
            )
        )
    )
    for r in requests:
        if r.requester_id not in attending:
            db.delete(r)
        elif r.driver_id is not None and r.driver_id not in attending:
            r.driver_id = None
            r.matched_at = None


def release_user(db: Session, user_id: int) -> None:
    """회원을 지우거나 탈퇴 처리할 때: 그 회원의 요청은 지우고, 태워 가기로 한 요청은 다시 찾는 중으로."""
    for r in db.scalars(
        select(PickupRequest).where(
            or_(PickupRequest.requester_id == user_id, PickupRequest.driver_id == user_id)
        )
    ):
        if r.requester_id == user_id:
            db.delete(r)
        else:
            r.driver_id = None
            r.matched_at = None


def open_counts(db: Session, gathering_ids: list[int]) -> dict[int, int]:
    """모임별 아직 태워 갈 사람을 찾는 요청 수 (캘린더·홈 목록 표시)."""
    if not gathering_ids:
        return {}
    rows = db.execute(
        select(PickupRequest.gathering_id, func.count())
        .where(PickupRequest.gathering_id.in_(gathering_ids), PickupRequest.driver_id.is_(None))
        .group_by(PickupRequest.gathering_id)
    ).all()
    return {gid: n for gid, n in rows}
