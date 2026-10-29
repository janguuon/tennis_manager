"""
회원 라우터: 내 프로필 조회/수정, 회원 목록/단건 조회.
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from .. import avatars
from ..database import get_db
from ..deps import GUEST_ONLY_VIEW_AND_VOTE, get_current_member, get_current_user
from ..models import ApprovalStatus, MemberType, User
from ..schemas import PasswordUpdate, UserMe, UserRead, UserUpdate
from ..security import hash_password
from .auth import nickname_taken

router = APIRouter(prefix="/users", tags=["users"])

PHONE_ADMIN_ONLY = "연락처는 관리자가 등록해요. 바꾸려면 관리자에게 말해 주세요."

# 회원 목록 순서: 회장·부회장·고문·경기이사·총무·부총무·임원진 → 정회원 → 게스트 (MemberType 정의 순서)
MEMBER_RANK = case(*((User.member_type == t, i) for i, t in enumerate(MemberType)), else_=len(MemberType))


@router.get("/me", response_model=UserMe)
def read_my_profile(current_user: User = Depends(get_current_user)):
    """현재 로그인한 회원의 프로필 (환급 계좌 포함)."""
    return current_user


@router.patch("/me", response_model=UserMe)
def update_my_profile(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필 수정: 전달된 필드만 부분 갱신한다. 연락처는 관리자만 바꾼다 (회원 목록의 전화 버튼에 쓰인다)."""
    data = payload.model_dump(exclude_unset=True)

    if "phone" in data and data["phone"] != current_user.phone and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PHONE_ADMIN_ONLY)

    # 닉네임 변경 시 중복 검사 (앞뒤 공백·대소문자 무시, 빈 칸이면 닉네임 지우기)
    if "nickname" in data:
        new_nick = (data["nickname"] or "").strip() or None
        data["nickname"] = new_nick
        if new_nick and nickname_taken(db, new_nick, exclude_id=current_user.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 닉네임입니다."
            )

    for field, value in data.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/avatar", response_model=UserMe)
def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필 사진 올리기: 가운데 정사각형 400px 로 저장하고, 예전 사진은 지운다."""
    data = file.file.read(avatars.MAX_AVATAR_BYTES + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="사진을 선택하세요.")
    if len(data) > avatars.MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="사진은 8MB까지 올릴 수 있어요.")
    try:
        url = avatars.save_avatar(current_user.id, data)
    except ValueError as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    old = current_user.avatar_url
    current_user.avatar_url = url
    db.commit()
    avatars.remove_avatar(old)
    db.refresh(current_user)
    return current_user


@router.delete("/me/avatar", response_model=UserMe)
def delete_my_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로필 사진 지우기 (이름 첫 글자로 돌아간다)."""
    old = current_user.avatar_url
    current_user.avatar_url = None
    db.commit()
    avatars.remove_avatar(old)
    db.refresh(current_user)
    return current_user


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    payload: PasswordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """비밀번호 변경: 현재 비밀번호 확인 없이 새 비밀번호로 교체한다."""
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()


@router.get("", response_model=list[UserRead])
def list_members(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_member),
):
    """팀 회원 목록 (승인된 활성 회원만). 게스트는 볼 수 없다.
    임원진 직함순, 같은 구분 안에서는 먼저 가입한 회원부터."""
    users = db.scalars(
        select(User)
        .where(
            User.is_active.is_(True),
            User.approval_status == ApprovalStatus.APPROVED,
        )
        .order_by(MEMBER_RANK, User.created_at, User.id)
        .offset(skip)
        .limit(limit)
    ).all()
    return users


@router.get("/{user_id}", response_model=UserRead)
def get_member(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """특정 회원 프로필 조회. 게스트는 자기 프로필만.
    탈퇴했거나 승인 전인 사람은 관리자만 본다 (회원 목록에 없는 사람의 연락처가 보이지 않게)."""
    if current_user.is_guest and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GUEST_ONLY_VIEW_AND_VOTE)
    user = db.get(User, user_id)
    listed = user is not None and user.is_active and user.approval_status == ApprovalStatus.APPROVED
    if not user or not (listed or current_user.is_admin or user.id == current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user
