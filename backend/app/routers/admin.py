"""
관리자 라우터: 가입 신청 승인/거절, 회원 관리(비밀번호 초기화·삭제/탈퇴·복구).

모든 엔드포인트는 관리자(is_admin) 권한이 필요하다.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_admin
from ..models import (
    ApprovalStatus,
    AttendanceStatus,
    DrawMatch,
    Gathering,
    GatheringStatus,
    Match,
    MatchPlayer,
    MemberType,
    Participant,
    User,
)
from ..schemas import MemberDeleteResult, MemberTypeUpdate, PasswordUpdate, UserRead
from ..security import hash_password

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
    db.commit()
    db.refresh(user)
    return user


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

    - 남은 기록이 없으면(경기·대진·만든 모임·입금 기록 없음) 계정을 완전히 지운다 → "deleted"
    - 기록이 있으면 다른 회원의 전적·정산이 깨지지 않도록 **탈퇴 처리**한다 → "deactivated"
      로그인 불가, 회원 목록·랭킹에서 빠지고, 앞으로 있을 모임의 참석은 불참으로 바꾼다
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
            p.status = AttendanceStatus.ABSENT
        db.commit()
        return MemberDeleteResult(result="deactivated", name=user.name)

    for p in db.scalars(select(Participant).where(Participant.user_id == user.id)).all():
        db.delete(p)
    name = user.name
    db.delete(user)
    db.commit()
    return MemberDeleteResult(result="deleted", name=name)


@router.post("/users/{user_id}/restore", response_model=UserRead)
def restore_member(user_id: int, db: Session = Depends(get_db)):
    """탈퇴 처리한 회원을 되살린다 (다시 로그인·회원 목록·랭킹에 나타남)."""
    user = _get_user_or_404(db, user_id)
    user.is_active = True
    db.commit()
    db.refresh(user)
    return user


def _has_history(db: Session, user_id: int) -> bool:
    """지우면 다른 기록이 깨지는지: 경기·경기 기록자·대진·만든 모임·입금 기록."""
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
    ]
    return any(db.scalar(q.limit(1)) is not None for q in checks)


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user
