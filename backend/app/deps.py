"""
공통 의존성: 현재 로그인 사용자 추출.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_access_token

# tokenUrl: 스웨거 UI의 Authorize 버튼이 토큰을 받아오는 로그인 엔드포인트
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 유효하지 않습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    subject = decode_access_token(token)
    if subject is None:
        raise credentials_exc

    user = db.get(User, int(subject))
    if user is None:
        raise credentials_exc
    if not user.is_active:
        # 탈퇴 처리된 회원: 401로 돌려 프론트가 세션을 지우고 로그인 화면으로 보내게 한다
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="탈퇴 처리된 계정입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """관리자 전용 의존성."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다."
        )
    return current_user


GUEST_ONLY_VIEW_AND_VOTE = "게스트는 일정 보기와 참석 투표만 할 수 있어요."


def get_current_member(current_user: User = Depends(get_current_user)) -> User:
    """게스트가 아닌 회원 전용. 게스트는 일정 보기와 참석 투표만 한다
    (회원 명단·월 정산을 보거나, 일정을 만들고 고치고, 대진·결과·입금을 다루지 않는다)."""
    if current_user.is_guest:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GUEST_ONLY_VIEW_AND_VOTE)
    return current_user


def get_current_settler(current_user: User = Depends(get_current_user)) -> User:
    """정산 담당(관리자·총무) 전용 의존성: 코트비 지급 처리, 지급 내역, 지급 대기 목록."""
    if not current_user.can_settle:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="정산은 관리자와 총무만 할 수 있어요."
        )
    return current_user
