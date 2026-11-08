"""
픽업 요청 — 차가 없어 오기 어려운 참석자를 차 있는 참석자가 태워 간다.

- 요청: 그 모임에 '참석'인 사람(게스트 포함)만, 모임당 한 건. 고치기는 요청자, 지우기는 요청자·운영진.
- 수락: '참석'인 다른 사람이 운전자가 된다(한 운전자가 여러 요청을 맡을 수 있다).
  못 가게 되면 운전자(또는 운영진)가 수락을 취소해 다시 찾는 중으로 돌린다.
- 예정·진행 중인 모임에서만 받는다. 참석을 바꾸면 app/pickups.py 가 요청·운전자를 정리한다.
- 연락처는 보여 주지 않는다. 연락은 단톡방에서 한다.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import AttendanceStatus, Gathering, Participant, PickupRequest, User
from ..schemas import PickupRead, PickupWrite
from .gatherings import _load_gathering, _require_open, complete_finished, pickups_active

router = APIRouter(tags=["pickups"])

NOT_ACTIVE = "끝났거나 취소된 모임은 픽업 요청을 받지 않아요."


def _require_active(gathering: Gathering) -> None:
    if not pickups_active(gathering):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=NOT_ACTIVE)


def _is_attending(db: Session, gathering_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(Participant.id).where(
                Participant.gathering_id == gathering_id,
                Participant.user_id == user_id,
                Participant.status == AttendanceStatus.ATTENDING,
            )
        )
        is not None
    )


def _load_pickup(db: Session, pickup_id: int) -> PickupRequest:
    r = db.get(PickupRequest, pickup_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="픽업 요청을 찾을 수 없어요. 이미 취소됐을 수 있어요.")
    return r


def _read(db: Session, r: PickupRequest) -> PickupRead:
    db.commit()
    db.refresh(r)
    return PickupRead.model_validate(r)


@router.post(
    "/gatherings/{gathering_id}/pickups", response_model=PickupRead, status_code=status.HTTP_201_CREATED
)
def request_pickup(
    gathering_id: int,
    payload: PickupWrite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """픽업 요청 (참석으로 투표한 본인, 모임당 한 건)."""
    complete_finished(db)
    g = _load_gathering(db, gathering_id)
    _require_open(g, current_user)
    _require_active(g)
    if not _is_attending(db, g.id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="참석으로 투표한 사람만 픽업을 요청할 수 있어요.")
    if any(r.requester_id == current_user.id for r in g.pickups):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="이미 픽업을 요청했어요. 요청한 내용을 고쳐 주세요.")
    r = PickupRequest(gathering_id=g.id, requester_id=current_user.id, **payload.model_dump())
    db.add(r)
    return _read(db, r)


@router.put("/pickups/{pickup_id}", response_model=PickupRead)
def update_pickup(
    pickup_id: int,
    payload: PickupWrite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """요청 고치기 (요청자 본인). 태워 가기로 한 운전자는 그대로다."""
    complete_finished(db)
    r = _load_pickup(db, pickup_id)
    if r.requester_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="요청한 사람만 고칠 수 있어요.")
    _require_active(r.gathering)
    for key, value in payload.model_dump().items():
        setattr(r, key, value)
    return _read(db, r)


@router.delete("/pickups/{pickup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pickup(
    pickup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """요청 취소 (요청자 본인, 운영진)."""
    r = _load_pickup(db, pickup_id)
    if r.requester_id != current_user.id and not current_user.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="요청한 사람과 운영진만 취소할 수 있어요.")
    db.delete(r)
    db.commit()


@router.post("/pickups/{pickup_id}/driver", response_model=PickupRead)
def accept_pickup(
    pickup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """제가 태워 갈게요 (그 모임에 참석하는 다른 사람)."""
    complete_finished(db)
    r = _load_pickup(db, pickup_id)
    g = r.gathering
    _require_open(g, current_user)
    _require_active(g)
    if r.requester_id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="내 요청은 수락할 수 없어요.")
    if not _is_attending(db, g.id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="참석으로 투표한 사람만 태워 갈 수 있어요.")
    if r.driver_id is not None:
        if r.driver_id == current_user.id:
            return PickupRead.model_validate(r)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"이미 {r.driver.name}님이 태워 가기로 했어요."
        )
    r.driver_id = current_user.id
    r.matched_at = datetime.now()
    return _read(db, r)


@router.delete("/pickups/{pickup_id}/driver", response_model=PickupRead)
def release_pickup(
    pickup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """못 가게 됐어요: 수락 취소 (운전자 본인, 운영진). 요청은 다시 찾는 중이 된다."""
    r = _load_pickup(db, pickup_id)
    if r.driver_id is None:
        return PickupRead.model_validate(r)
    if r.driver_id != current_user.id and not current_user.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="태워 가기로 한 사람과 운영진만 취소할 수 있어요.")
    r.driver_id = None
    r.matched_at = None
    return _read(db, r)
