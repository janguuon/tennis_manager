"""
코트 예약 라우터: 오테식 정모·벙개의 코트비 지급.

코트를 잡은 회원이 코트비를 먼저 내면, 총무(정산 담당: 관리자·총무)가 회비에서 돌려준다.
한 모임에 예약자가 여러 명일 수 있어 예약 1건(예약자·코트·금액)마다 지급 여부를 기록한다.
지급 전 내역의 등록·수정·삭제는 오테식 모임을 올리는 운영진(관리자·임원진·총무),
지급 처리와 계좌 보기는 관리자·총무만. 조회는 본인 예약(내가 받을 코트비)도 가능하다.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_member, get_current_settler, get_current_user
from ..models import CourtBooking, Gathering, User
from ..schemas import (
    CourtBookingCancel,
    CourtBookingInput,
    CourtBookingRead,
    CourtBookingUpdate,
    ReimbursementBulkUpdate,
    ReimbursementUpdate,
)
from .. import visibility
from .gatherings import _load_gathering, court_booking_read, require_booker, sync_court_fairy

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


def _require_booking_editor(user: User) -> None:
    """지급 전 코트비 내역 등록·수정·삭제: 오테식 모임을 올리는 운영진(관리자·임원진·총무)."""
    if not user.is_staff:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="코트비 내역은 운영진(관리자·임원진·총무)만 고칠 수 있어요."
        )


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
    current_user: User = Depends(get_current_member),
):
    """오테식 모임에 코트 예약 1건 추가 (운영진)."""
    _require_booking_editor(current_user)
    g = _load_gathering(db, gathering_id)
    if not g.is_club:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="코트 예약 내역은 오테식 정모·벙개에만 등록할 수 있습니다.",
        )
    require_booker(db, payload.booker_id)
    booking = CourtBooking(gathering_id=g.id, **payload.model_dump())
    db.add(booking)
    db.flush()
    sync_court_fairy(db, g.id)
    db.commit()
    return court_booking_read(_load_booking(db, booking.id), current_user)


@router.patch("/court-bookings/{booking_id}", response_model=CourtBookingRead)
def update_court_booking(
    booking_id: int,
    payload: CourtBookingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """예약자·금액·코트 수정 (지급 전만, 운영진)."""
    _require_booking_editor(current_user)
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    data = payload.model_dump(exclude_unset=True)
    for key in ("booker_id", "amount"):
        if key in data and data[key] is None:
            del data[key]
    if "booker_id" in data:
        require_booker(db, data["booker_id"])
        data["booker_name"] = None  # 이름만 적어 둔 코트요정을 회원으로 바꿨다
    for key, value in data.items():
        setattr(b, key, value)
    db.flush()
    db.expire_all()
    sync_court_fairy(db, b.gathering_id)
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), current_user)


@router.delete("/court-bookings/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_court_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """예약 삭제 (지급 전만, 운영진)."""
    _require_booking_editor(current_user)
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    gathering_id = b.gathering_id
    db.delete(b)
    db.flush()
    db.expire_all()
    sync_court_fairy(db, gathering_id)
    db.commit()


@router.put("/court-bookings/{booking_id}/cancel", response_model=CourtBookingRead)
def cancel_court_booking(
    booking_id: int,
    payload: CourtBookingCancel,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """코트 취소 (지급 전, 운영진). 원래 코트비 대신 취소 수수료만 회비에서 지급한다.
    이미 취소한 코트에 다시 보내면 수수료만 고친다."""
    _require_booking_editor(current_user)
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    if b.canceled_at is None:
        b.canceled_at = visibility.now_kst()
    b.cancel_fee = payload.fee
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), current_user)


@router.delete("/court-bookings/{booking_id}/cancel", response_model=CourtBookingRead)
def restore_court_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """코트 취소 되돌리기 (지급 전, 운영진): 다시 원래 코트비를 지급한다."""
    _require_booking_editor(current_user)
    b = _load_booking(db, booking_id)
    _require_not_reimbursed(b)
    b.canceled_at = None
    b.cancel_fee = 0
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), current_user)


NOTHING_TO_PAY = "취소 수수료가 0원이라 지급할 코트비가 없어요."


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
        if b.payable <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=NOTHING_TO_PAY)
        b.reimbursed_at = datetime.now()
        b.reimbursed_by = settler.id
    else:
        b.reimbursed_at = None
        b.reimbursed_by = None
    db.commit()
    db.expire_all()
    return court_booking_read(_load_booking(db, booking_id), settler)


@router.put("/court-bookings/reimbursement", response_model=list[CourtBookingRead])
def set_reimbursement_many(
    payload: ReimbursementBulkUpdate,
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """여러 코트비를 한 번에 지급 완료/취소 (코트요정 한 명에게 한 번에 보냈을 때)."""
    ids = list(dict.fromkeys(payload.booking_ids))
    found = {b.id: b for b in db.scalars(_booking_query().where(CourtBooking.id.in_(ids)))}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="코트 예약을 찾을 수 없습니다.")
    now = datetime.now()
    for b in found.values():
        if payload.reimbursed:
            if b.payable <= 0:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=NOTHING_TO_PAY)
            if b.reimbursed_at is None:  # 이미 지급한 건은 처음 기록 그대로
                b.reimbursed_at = now
                b.reimbursed_by = settler.id
        else:
            b.reimbursed_at = None
            b.reimbursed_by = None
    db.commit()
    db.expire_all()
    return [court_booking_read(_load_booking(db, i), settler) for i in ids]


@router.get("/court-bookings", response_model=list[CourtBookingRead])
def list_court_bookings(
    pending: bool = Query(True, description="true면 아직 지급하지 않은 코트비만"),
    db: Session = Depends(get_db),
    settler: User = Depends(get_current_settler),
):
    """총무용 코트비 지급 목록 (계좌 포함). 모임 날짜순.
    공개 전 모임의 코트비도 함께 오며(open_to_members=False), 정산 탭은 공개된 것만 보여 준다."""
    stmt = _booking_query().join(Gathering, CourtBooking.gathering_id == Gathering.id)
    if pending:
        stmt = stmt.where(CourtBooking.reimbursed_at.is_(None))
    stmt = stmt.order_by(Gathering.event_date, CourtBooking.id)
    rows = db.scalars(stmt).all()
    if pending:  # 수수료 없이 취소한 코트는 지급할 게 없다
        rows = [b for b in rows if b.payable > 0]
    return [court_booking_read(b, settler) for b in rows]


@router.get("/court-bookings/me", response_model=list[CourtBookingRead])
def my_court_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내가 받을 코트비 (내가 예약했고 아직 지급받지 않은 것). 정회원에게 공개된 모임만."""
    stmt = (
        _booking_query()
        .join(Gathering, CourtBooking.gathering_id == Gathering.id)
        .where(
            CourtBooking.booker_id == current_user.id,
            CourtBooking.reimbursed_at.is_(None),
        )
        .order_by(Gathering.event_date, CourtBooking.id)
    )
    rows = [court_booking_read(b, current_user) for b in db.scalars(stmt).all() if b.payable > 0]
    return [r for r in rows if r.open_to_members]
