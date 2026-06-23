"""
회원 라우터: 내 프로필 조회/수정, 회원 목록/단건 조회.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import ApprovalStatus, User
from ..schemas import UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
def read_my_profile(current_user: User = Depends(get_current_user)):
    """현재 로그인한 회원의 프로필."""
    return current_user


@router.patch("/me", response_model=UserRead)
def update_my_profile(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필 수정: 전달된 필드만 부분 갱신한다."""
    data = payload.model_dump(exclude_unset=True)

    # 닉네임 변경 시 중복 검사
    new_nick = data.get("nickname")
    if new_nick and new_nick != current_user.nickname:
        taken = db.scalar(select(User).where(User.nickname == new_nick))
        if taken:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 닉네임입니다."
            )

    for field, value in data.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("", response_model=list[UserRead])
def list_members(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """팀 회원 목록 (승인된 활성 회원만). 이후 랭킹/대진 기능에서 활용."""
    users = db.scalars(
        select(User)
        .where(
            User.is_active.is_(True),
            User.approval_status == ApprovalStatus.APPROVED,
        )
        .offset(skip)
        .limit(limit)
    ).all()
    return users


@router.get("/{user_id}", response_model=UserRead)
def get_member(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """특정 회원 프로필 조회."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user
