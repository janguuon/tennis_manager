"""
관리자 라우터: 가입 신청 승인/거절, 회원 관리.

모든 엔드포인트는 관리자(is_admin) 권한이 필요하다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_admin
from ..models import ApprovalStatus, User
from ..schemas import UserRead

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/signups/pending", response_model=list[UserRead])
def list_pending_signups(db: Session = Depends(get_db)):
    """승인 대기 중인 가입 신청 목록."""
    return db.scalars(
        select(User).where(User.approval_status == ApprovalStatus.PENDING).order_by(User.created_at)
    ).all()


@router.post("/signups/{user_id}/approve", response_model=UserRead)
def approve_signup(user_id: int, db: Session = Depends(get_db)):
    """가입 신청 승인 → 로그인 가능."""
    user = _get_user_or_404(db, user_id)
    user.approval_status = ApprovalStatus.APPROVED
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


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user
