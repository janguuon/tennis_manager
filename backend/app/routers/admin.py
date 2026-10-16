"""
관리자 라우터: 가입 신청 승인/거절, 회원 관리(비밀번호 초기화·삭제/탈퇴·복구).

모든 엔드포인트는 관리자(is_admin) 권한이 필요하다.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import avatars
from ..database import get_db
from ..deps import get_current_admin
from ..models import (
    Notice,
    ApprovalStatus,
    AttendanceStatus,
    CourtBooking,
    DrawMatch,
    Gathering,
    GatheringStatus,
    Match,
    MatchPlayer,
    MemberType,
    Participant,
    User,
)
from ..schemas import (
    AwardUpdate,
    MemberDeleteResult,
    MemberTypeUpdate,
    PasswordUpdate,
    PurgePreview,
    PurgeResult,
    UserRead,
)
from ..security import hash_password
from .gatherings import promote_waiting

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/signups/pending", response_model=list[UserRead])
def list_pending_signups(db: Session = Depends(get_db)):
    """승인 대기 중인 가입 신청 목록."""
    return db.scalars(
        select(User).where(User.approval_status == ApprovalStatus.PENDING).order_by(User.created_at)
    ).all()


@router.post("/signups/{user_id}/approve", response_model=UserRead)
def approve_signup(
    user_id: int,
    member_type: MemberType = MemberType.MEMBER,
    db: Session = Depends(get_db),
):
    """가입 신청 승인 → 로그인 가능. 회원 구분(정회원/게스트/임원진)을 함께 정한다."""
    user = _get_user_or_404(db, user_id)
    user.approval_status = ApprovalStatus.APPROVED
    user.member_type = member_type
    db.flush()
    _link_court_bookings(db, user)
    db.commit()
    db.refresh(user)
    return user


def _link_court_bookings(db: Session, user: User) -> None:
    """엑셀로 올릴 때 이름만 적어 둔 코트요정의 코트비 내역을, 같은 이름으로 승인된 회원에게 잇는다.
    같은 이름의 회원이 여럿이면 누구인지 알 수 없어 잇지 않는다."""
    name = " ".join(user.name.split())
    approved = db.scalars(
        select(User).where(User.is_active.is_(True), User.approval_status == ApprovalStatus.APPROVED)
    )
    if sum(" ".join(u.name.split()) == name for u in approved) != 1:
        return
    for b in db.scalars(select(CourtBooking).where(CourtBooking.booker_id.is_(None))):
        if " ".join((b.booker_name or "").split()) == name:
            b.booker_id = user.id
            b.booker_name = None


@router.post("/signups/{user_id}/reject", response_model=UserRead)
def reject_signup(user_id: int, db: Session = Depends(get_db)):
    """가입 신청 거절."""
    user = _get_user_or_404(db, user_id)
    user.approval_status = ApprovalStatus.REJECTED
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/set-admin", response_model=UserRead)
def set_admin(
    user_id: int,
    is_admin: bool = True,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """회원의 관리자 권한 부여/회수."""
    user = _get_user_or_404(db, user_id)
    if user.id == current_admin.id and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="자기 자신의 관리자 권한은 회수할 수 없습니다."
        )
    user.is_admin = is_admin
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/member-type", response_model=UserRead)
def set_member_type(user_id: int, payload: MemberTypeUpdate, db: Session = Depends(get_db)):
    """회원 구분 변경 (예: 체험을 마친 게스트를 정회원으로)."""
    user = _get_user_or_404(db, user_id)
    user.member_type = payload.member_type
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/award", response_model=UserRead)
def set_award(user_id: int, payload: AwardUpdate, db: Session = Depends(get_db)):
    """대회 입상 별 개수 정하기 (관리자): 금 우승 · 은 준우승 · 동 입상, 짧은 이력. 모두 0이면 이력도 지운다."""
    user = _get_user_or_404(db, user_id)
    user.award_gold, user.award_silver, user.award_bronze = payload.gold, payload.silver, payload.bronze
    user.award_note = payload.note if payload.gold + payload.silver + payload.bronze else None
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(
    user_id: int,
    payload: PasswordUpdate,
    db: Session = Depends(get_db),
):
    """관리자가 회원 비밀번호를 초기화한다(분실 대응). 새 비밀번호로 교체."""
    user = _get_user_or_404(db, user_id)
    user.hashed_password = hash_password(payload.new_password)
    db.commit()


@router.get("/users/inactive", response_model=list[UserRead])
def list_inactive_members(db: Session = Depends(get_db)):
    """탈퇴 처리된 회원 목록 (복구용)."""
    return db.scalars(
        select(User)
        .where(User.is_active.is_(False), User.approval_status == ApprovalStatus.APPROVED)
        .order_by(User.name)
    ).all()


@router.delete("/users/{user_id}", response_model=MemberDeleteResult)
def delete_member(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """
    회원 삭제.

    - 남은 기록이 없으면(경기·대진·만든 모임·입금·코트 예약 기록 없음) 계정을 완전히 지운다 → "deleted"
    - 기록이 있으면 정산이 깨지지 않도록 기록은 남기고 **탈퇴 처리**한다 → "deactivated"
      로그인 불가, 회원 목록·랭킹에서 빠지고, 그 회원이 뛴 경기는 다른 회원의 전적·랭킹·티어
      계산에서도 빠진다. 앞으로 있을 모임의 참석은 불참으로 바꾼다
      (이미 입금했다면 그 모임의 "돌려줄 참가비"에 나타난다). 복구할 수 있다.
    """
    user = _get_user_or_404(db, user_id)
    if user.id == current_admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="자기 자신은 삭제할 수 없습니다.")

    if _has_history(db, user.id):
        user.is_active = False
        upcoming = db.scalars(
            select(Participant)
            .join(Gathering)
            .where(
                Participant.user_id == user.id,
                Gathering.event_date >= date.today(),
                Gathering.status.in_([GatheringStatus.PLANNED, GatheringStatus.ONGOING]),
            )
        ).all()
        for p in upcoming:
            was_attending = p.status == AttendanceStatus.ATTENDING
            p.status = AttendanceStatus.ABSENT
            p.waiting_since = None
            if was_attending:
                promote_waiting(db, p.gathering)  # 빠진 자리에 대기자를 올린다
        db.commit()
        return MemberDeleteResult(result="deactivated", name=user.name)

    freed: list[Gathering] = []
    for p in db.scalars(select(Participant).where(Participant.user_id == user.id)).all():
        if p.status == AttendanceStatus.ATTENDING:
            freed.append(p.gathering)
        db.delete(p)
    for g in freed:
        promote_waiting(db, g)  # 빠진 자리에 대기자를 올린다
    name = user.name
    avatar_url = user.avatar_url
    db.delete(user)
    db.commit()
    avatars.remove_avatar(avatar_url)
    return MemberDeleteResult(result="deleted", name=name)


# --- 탈퇴 회원 완전 삭제 -------------------------------------------------------
_SEATS = ("team1_player1_id", "team1_player2_id", "team2_player1_id", "team2_player2_id")


def _seat_filter(user_id: int):
    return or_(*(getattr(DrawMatch, c) == user_id for c in _SEATS))


def _purge_preview(db: Session, user: User) -> PurgePreview:
    def count(stmt) -> int:
        return db.scalar(select(func.count()).select_from(stmt.subquery()))

    return PurgePreview(
        user_id=user.id,
        name=user.name,
        matches=count(select(MatchPlayer.match_id).where(MatchPlayer.user_id == user.id).distinct()),
        participations=count(select(Participant.id).where(Participant.user_id == user.id)),
        paid=count(select(Participant.id).where(Participant.user_id == user.id, Participant.paid.is_(True))),
        court_bookings=count(select(CourtBooking.id).where(CourtBooking.booker_id == user.id)),
        gatherings_created=count(select(Gathering.id).where(Gathering.created_by == user.id)),
        draw_seats=count(select(DrawMatch.id).where(_seat_filter(user.id))),
    )


def _require_withdrawn(user: User, admin: User) -> None:
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="자기 자신은 삭제할 수 없습니다.")
    if user.is_active:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="탈퇴 처리된 회원만 완전히 지울 수 있어요. 먼저 회원 관리에서 삭제(탈퇴 처리)해 주세요.",
        )


def _purge(db: Session, user: User, admin: User) -> PurgePreview:
    """회원과 그 회원의 기록을 DB 에서 지운다. 되돌릴 수 없다.

    - 그 회원이 뛴 경기는 통째로 지운다(탈퇴 후 이미 모든 전적·티어에서 빠져 있던 경기). 대진의 결과 연결도 끊는다.
    - 참석·입금 기록, 코트비 지급 내역(그 회원이 받을 것)을 지운다.
    - 대진표의 그 회원 자리는 빈자리로, 그 회원이 만든 모임은 지우는 관리자에게 넘긴다.
    - 기록자·지급 처리자로 남은 이름은 비운다.
    """
    preview = _purge_preview(db, user)
    uid = user.id
    match_ids = list(db.scalars(select(MatchPlayer.match_id).where(MatchPlayer.user_id == uid).distinct()))
    if match_ids:
        for dm in db.scalars(select(DrawMatch).where(DrawMatch.result_match_id.in_(match_ids))):
            dm.result_match_id = None
        for m in db.scalars(select(Match).where(Match.id.in_(match_ids))):
            db.delete(m)  # MatchPlayer 는 cascade 로 함께
    for m in db.scalars(select(Match).where(Match.recorded_by == uid)):
        m.recorded_by = None
    for dm in db.scalars(select(DrawMatch).where(_seat_filter(uid))):
        for c in _SEATS:
            if getattr(dm, c) == uid:
                setattr(dm, c, None)
    freed: list[Gathering] = []
    for p in db.scalars(select(Participant).where(Participant.user_id == uid)):
        if p.status == AttendanceStatus.ATTENDING:
            freed.append(p.gathering)
        db.delete(p)
    for b in db.scalars(select(CourtBooking).where(CourtBooking.booker_id == uid)):
        db.delete(b)
    for b in db.scalars(select(CourtBooking).where(CourtBooking.reimbursed_by == uid)):
        b.reimbursed_by = None
    for g in db.scalars(select(Gathering).where(Gathering.created_by == uid)):
        g.created_by = admin.id
    for n in db.scalars(select(Notice).where(Notice.created_by == uid)):
        n.created_by = None
    db.flush()
    for g in freed:
        promote_waiting(db, g)
    db.expire(user, ["match_links", "participations"])
    db.delete(user)
    return preview


def _withdrawn(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.is_active.is_(False), User.approval_status == ApprovalStatus.APPROVED)
            .order_by(User.name)
        )
    )


@router.get("/users/inactive/purge-preview", response_model=list[PurgePreview])
def purge_preview_all(db: Session = Depends(get_db)):
    """탈퇴한 회원마다 완전 삭제하면 함께 지워지는 것."""
    return [_purge_preview(db, u) for u in _withdrawn(db)]


@router.delete("/users/inactive/purge", response_model=PurgeResult)
def purge_all_withdrawn(
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """탈퇴 처리된 회원을 모두 DB 에서 완전히 지운다(되돌릴 수 없음)."""
    targets = [u for u in _withdrawn(db) if u.id != current_admin.id]
    avatar_urls = [u.avatar_url for u in targets]
    purged = [_purge(db, u, current_admin) for u in targets]
    db.commit()
    for url in avatar_urls:
        avatars.remove_avatar(url)
    return PurgeResult(purged=purged)


@router.delete("/users/{user_id}/purge", response_model=PurgeResult)
def purge_member(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """탈퇴 처리된 회원을 DB 에서 완전히 지운다(되돌릴 수 없음)."""
    user = _get_user_or_404(db, user_id)
    _require_withdrawn(user, current_admin)
    avatar_url = user.avatar_url
    result = _purge(db, user, current_admin)
    db.commit()
    avatars.remove_avatar(avatar_url)
    return PurgeResult(purged=[result])


@router.post("/users/{user_id}/restore", response_model=UserRead)
def restore_member(user_id: int, db: Session = Depends(get_db)):
    """탈퇴 처리한 회원을 되살린다 (다시 로그인·회원 목록·랭킹에 나타나고 그 경기들도 다시 집계된다)."""
    user = _get_user_or_404(db, user_id)
    user.is_active = True
    db.commit()
    db.refresh(user)
    return user


def _has_history(db: Session, user_id: int) -> bool:
    """지우면 다른 기록이 깨지는지: 경기·경기 기록자·대진·만든 모임·입금 기록·코트 예약(지급)."""
    checks = [
        select(MatchPlayer.id).where(MatchPlayer.user_id == user_id),
        select(Match.id).where(Match.recorded_by == user_id),
        select(DrawMatch.id).where(
            or_(
                DrawMatch.team1_player1_id == user_id,
                DrawMatch.team1_player2_id == user_id,
                DrawMatch.team2_player1_id == user_id,
                DrawMatch.team2_player2_id == user_id,
            )
        ),
        select(Gathering.id).where(Gathering.created_by == user_id),
        select(Participant.id).where(Participant.user_id == user_id, Participant.paid.is_(True)),
        select(CourtBooking.id).where(
            or_(CourtBooking.booker_id == user_id, CourtBooking.reimbursed_by == user_id)
        ),
    ]
    return any(db.scalar(q.limit(1)) is not None for q in checks)


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user
