"""
인증 라우터: 회원가입(신청) / 로그인.

가입 승인제
-----------
- 가입 신청 시 approval_status=PENDING 으로 저장 (즉시 로그인 불가)
- 관리자가 승인(APPROVED)해야 로그인 가능
- 단, 시스템 최초 가입자는 자동으로 관리자(is_admin) + 승인 처리하여
  최초 관리자를 부트스트랩한다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ApprovalStatus, User
from ..schemas import SignupResponse, Token, UserCreate
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def find_by_username(db: Session, raw: str) -> User | None:
    """로그인 아이디 찾기: 똑같은 아이디가 먼저, 없으면 대소문자 무시(예전에 대문자로 가입한 계정 포함)."""
    username = raw.strip()
    user = db.scalar(select(User).where(User.username == username))
    if user:
        return user
    found = db.scalars(select(User).where(func.lower(User.username) == username.lower())).all()
    return found[0] if len(found) == 1 else None


def nickname_taken(db: Session, nickname: str, exclude_id: int | None = None) -> bool:
    """닉네임 중복(앞뒤 공백·대소문자 무시)."""
    stmt = select(User.id).where(func.lower(func.trim(User.nickname)) == nickname.strip().lower())
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return db.scalar(stmt) is not None


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    """가입 신청: 아이디/닉네임/이메일 중복 검사 후 승인 대기 상태로 저장.

    대소문자는 구분하지 않는다(휴대폰이 첫 글자를 대문자로 바꿔도 같은 아이디). 아이디는 소문자로 저장한다.
    """
    username = payload.username.strip().lower()
    nickname = (payload.nickname or "").strip() or None
    email = (payload.email or "").strip().lower() or None
    if db.scalar(select(User).where(func.lower(User.username) == username)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디입니다.")

    if email and db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 가입된 이메일입니다.")

    if nickname and nickname_taken(db, nickname):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 사용 중인 닉네임입니다.")

    # 최초 가입자 = 관리자 부트스트랩
    is_first_user = db.scalar(select(func.count()).select_from(User)) == 0

    user = User(
        username=username,
        email=email,
        hashed_password=hash_password(payload.password),
        name=payload.name.strip(),
        nickname=nickname,
        gender=payload.gender,
        ntrp=payload.ntrp,
        phone=payload.phone,
        bio=payload.bio,
        is_admin=is_first_user,
        approval_status=ApprovalStatus.APPROVED if is_first_user else ApprovalStatus.PENDING,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # 동시에 같은 아이디로 신청한 경우
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디·닉네임·이메일입니다.")
    db.refresh(user)

    if is_first_user:
        message = "최초 가입자로 관리자 권한이 부여되었으며 바로 로그인할 수 있습니다."
    else:
        message = "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다."
    return SignupResponse(user=user, message=message)


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """로그인: username + password 로 JWT 발급. 승인된 계정만 허용."""
    user = find_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.approval_status == ApprovalStatus.PENDING:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="관리자 승인 대기 중인 계정입니다.")
    if user.approval_status == ApprovalStatus.REJECTED:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="가입이 거절된 계정입니다.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="탈퇴 처리된 계정입니다. 관리자에게 문의하세요.")

    token = create_access_token(subject=user.id)
    return Token(access_token=token, user=user)
