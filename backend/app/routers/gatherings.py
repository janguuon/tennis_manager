"""
모임/캘린더 라우터: 모임 CRUD, 캘린더 조회, 참석 투표.

코트 면 수(court_count)는 모임 단위로 등록되며, 이후 대진 자동생성에서
한 라운드의 동시 진행 매치 수로 사용된다.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import AttendanceStatus, Gathering, Participant, User
from ..schemas import (
    AttendanceSummary,
    GatheringCreate,
    GatheringDetail,
    GatheringRead,
    GatheringUpdate,
    ParticipantRead,
    ParticipantVote,
)

router = APIRouter(prefix="/gatherings", tags=["gatherings"])


# --- 내부 헬퍼 --------------------------------------------------------------
def _summary(gathering: Gathering) -> AttendanceSummary:
    s = AttendanceSummary()
    for p in gathering.participants:
        if p.status == AttendanceStatus.ATTENDING:
            s.attending += 1
        elif p.status == AttendanceStatus.ABSENT:
            s.absent += 1
        else:
            s.maybe += 1
    s.total = len(gathering.participants)
    return s


def _to_read(gathering: Gathering) -> GatheringRead:
    read = GatheringRead.model_validate(gathering)
    read.attendance = _summary(gathering)
    return read


def _load_gathering(db: Session, gathering_id: int) -> Gathering:
    g = db.scalar(
        select(Gathering)
        .where(Gathering.id == gathering_id)
        .options(selectinload(Gathering.participants).selectinload(Participant.user))
    )
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    return g


def _require_organizer(gathering: Gathering, user: User) -> None:
    if gathering.created_by != user.id and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="모임 주최자 또는 관리자만 가능합니다.")


def _normalize_courts(data: dict) -> None:
    """court_numbers가 주어지면 정리하고 court_count를 그 개수로 맞춘다."""
    raw = data.get("court_numbers")
    if raw:
        labels = [s.strip() for s in str(raw).split(",") if s.strip()]
        if labels:
            data["court_numbers"] = ", ".join(labels)
            data["court_count"] = len(labels)


# --- 모임 CRUD --------------------------------------------------------------
@router.post("", response_model=GatheringRead, status_code=status.HTTP_201_CREATED)
def create_gathering(
    payload: GatheringCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """모임 생성 (캘린더에 일정 등록)."""
    data = payload.model_dump()
    _normalize_courts(data)
    gathering = Gathering(**data, created_by=current_user.id)
    db.add(gathering)
    db.commit()
    return _to_read(_load_gathering(db, gathering.id))


@router.get("", response_model=list[GatheringRead])
def list_gatherings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    date_from: date | None = Query(None, description="캘린더 조회 시작일"),
    date_to: date | None = Query(None, description="캘린더 조회 종료일"),
):
    """캘린더 조회: 기간으로 모임 목록을 가져온다(참석 요약 포함)."""
    stmt = select(Gathering).options(
        selectinload(Gathering.participants).selectinload(Participant.user)
    )
    if date_from is not None:
        stmt = stmt.where(Gathering.event_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Gathering.event_date <= date_to)
    stmt = stmt.order_by(Gathering.event_date, Gathering.start_time)

    return [_to_read(g) for g in db.scalars(stmt).all()]


@router.get("/{gathering_id}", response_model=GatheringDetail)
def get_gathering(
    gathering_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """모임 상세 (참여자 명단 포함)."""
    g = _load_gathering(db, gathering_id)
    detail = GatheringDetail.model_validate(g)
    detail.attendance = _summary(g)
    detail.participants = [ParticipantRead.model_validate(p) for p in g.participants]
    return detail


@router.patch("/{gathering_id}", response_model=GatheringRead)
def update_gathering(
    gathering_id: int,
    payload: GatheringUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    _require_organizer(g, current_user)
    data = payload.model_dump(exclude_unset=True)
    _normalize_courts(data)
    for field_name, value in data.items():
        setattr(g, field_name, value)
    db.commit()
    return _to_read(_load_gathering(db, gathering_id))


@router.delete("/{gathering_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gathering(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    _require_organizer(g, current_user)
    db.delete(g)
    db.commit()


# --- 참석 투표 --------------------------------------------------------------
@router.get("/{gathering_id}/participants", response_model=list[ParticipantRead])
def list_participants(
    gathering_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    return [ParticipantRead.model_validate(p) for p in g.participants]


@router.put("/{gathering_id}/attendance", response_model=ParticipantRead)
def vote_attendance(
    gathering_id: int,
    payload: ParticipantVote,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """현재 회원의 참석/불참/미정 투표 (없으면 생성, 있으면 갱신)."""
    gathering = db.get(Gathering, gathering_id)
    if not gathering:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")

    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )

    # 정원 제한: '참석'으로 바꾸려는데 이미 정원이 찼고, 본인이 아직 참석이 아니면 차단
    if payload.status == AttendanceStatus.ATTENDING and gathering.max_participants is not None:
        already_attending = (
            participant is not None and participant.status == AttendanceStatus.ATTENDING
        )
        if not already_attending:
            current_attending = db.scalar(
                select(func.count())
                .select_from(Participant)
                .where(
                    Participant.gathering_id == gathering_id,
                    Participant.status == AttendanceStatus.ATTENDING,
                )
            )
            if current_attending >= gathering.max_participants:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail=f"참석 정원({gathering.max_participants}명)이 가득 찼습니다.",
                )

    if participant is None:
        participant = Participant(
            gathering_id=gathering_id, user_id=current_user.id, status=payload.status
        )
        db.add(participant)
    else:
        participant.status = payload.status

    db.commit()
    db.refresh(participant)
    return ParticipantRead.model_validate(participant)


@router.delete("/{gathering_id}/attendance", status_code=status.HTTP_204_NO_CONTENT)
def cancel_attendance(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """투표 취소 (참여자 명단에서 제거)."""
    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )
    if participant:
        db.delete(participant)
        db.commit()
