"""
코트 예약 라우터: 오테식 정모·벙개의 코트비 지급.

코트를 잡은 회원이 코트비를 먼저 내면, 총무(정산 담당: 관리자·총무)가 회비에서 돌려준다.
한 모임에 예약자가 여러 명일 수 있어 예약 1건(예약자·코트·금액)마다 지급 여부를 기록한다.
등록·수정·지급 처리는 관리자·총무만, 조회는 본인 예약(내가 받을 코트비)도 가능하다.
(모임을 처음 만들 때 함께 넣는 예약 내역은 임원진도 넣을 수 있다.)
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_settler, get_current_user
from ..models import CourtBooking, Gathering, User
from ..schemas import (
    CourtBookingInput,
    CourtBookingRead,
    CourtBookingUpdate,
    ReimbursementUpdate,
)
from .gatherings import _load_gathering, court_booking_read, require_booker

router = APIRouter(tags=["court-bookings"])


def _booking_query():
    return select(CourtBooking).options(
        selectinload(CourtBooking.gathering),
        selectinload(CourtBooking.booker),
        selectinload(CourtBooking.reimburser),
    )


def _load_booking(db: Session, booking_id: int) -> CourtBooking:
    b = db.scalar(_booking_query().where(CourtBooking.id == booking_id))
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="코트 예약을 찾을 수 없습니다.")
    return b


def _require_not_reimbursed(b: CourtBooking) -> None:
    if b.reimbursed_at is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="이미 지급한 코트비입니다. 지급 취소 후 수정해 주세요.",
        )


@router.post(
    "/gatherings/{gathering_id}/court-bookings",
    response_model=CourtBookingRead,
    status_code=status.HTTP_201_CREATED,
)
def add_court_booking(
    gathering_id: int,
    payload: CourtBookingInput,
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """오테식 모임에 코트 예약 1건 추가 (관리자·총무)."""
    g = _load_gathering(db, gathering_id)
    if not g.is_club:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="코트 예약 내역은 오테식 정모·벙개에만 등록할 수 있습니다.",
        )
    require_booker(db, payload.booker_id)
    booking = CourtBooking(gathering_id=g.id, **payload.model_dump())
    db.add(booking)
    db.commit()
    return court_booking_read(_load_booking(db, booking.id), settler)


@router.patch("/court-bookings/{booking_id}", response_model=CourtBookingRead)
def update_court_booking(
    booking_id: int,
    payload: CourtBookingUpdate,
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """예약자·금액·코트 수정 (지급 전만)."""
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    data = payload.model_dump(exclude_unset=True)
    for key in ("booker_id", "amount"):
        if key in data and data[key] is None:
            del data[key]
    if "booker_id" in data:
        require_booker(db, data["booker_id"])
    for key, value in data.items():
        setattr(b, key, value)
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), settler)


@router.delete("/court-bookings/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_court_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_settler),
):
    """예약 삭제 (지급 전만)."""
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    db.delete(b)
    db.commit()


@router.put("/court-bookings/{booking_id}/reimbursement", response_model=CourtBookingRead)
def set_reimbursement(
    booking_id: int,
    payload: ReimbursementUpdate,
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """코트비 지급 완료/취소 (관리자·총무). 지급 시각과 처리한 사람을 기록한다."""
    b = _load_booking(db, booking_id)
    if payload.reimbursed:
        b.reimbursed_at = datetime.now()
        b.reimbursed_by = settler.id
    else:
        b.reimbursed_at = None
        b.reimbursed_by = None
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), settler)


@router.get("/court-bookings", response_model=list[CourtBookingRead])
def list_court_bookings(
    pending: bool = Query(True, description="true면 아직 지급하지 않은 코트비만"),
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """총무용 코트비 지급 목록 (계좌 포함). 모임 날짜순."""
    stmt = _booking_query().join(Gathering, CourtBooking.gathering_id == Gathering.id)
    if pending:
        stmt = stmt.where(CourtBooking.reimbursed_at.is_(None))
    stmt = stmt.order_by(Gathering.event_date, CourtBooking.id)
    return [court_booking_read(b, settler) for b in db.scalars(stmt).all()]


@router.get("/court-bookings/me", response_model=list[CourtBookingRead])
def my_court_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내가 받을 코트비 (내가 예약했고 아직 지급받지 않은 것)."""
    stmt = (
        _booking_query()
        .join(Gathering, CourtBooking.gathering_id == Gathering.id)
        .where(
            CourtBooking.booker_id == current_user.id,
            CourtBooking.reimbursed_at.is_(None),
        )
        .order_by(Gathering.event_date, CourtBooking.id)
    )
    return [court_booking_read(b, current_user) for b in db.scalars(stmt).all()]
