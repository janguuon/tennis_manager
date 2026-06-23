"""
보안 유틸리티: 비밀번호 해싱 + JWT 토큰 발급/검증.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from .config import settings


# --- 비밀번호 ---------------------------------------------------------------
# passlib 대신 bcrypt를 직접 사용한다 (passlib 1.7.4 는 bcrypt 5.x 와 비호환).
# bcrypt는 비밀번호를 72바이트까지만 처리하므로 바이트 단위로 잘라서 해싱한다.
def hash_password(plain_password: str) -> str:
    pw_bytes = plain_password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    pw_bytes = plain_password.encode("utf-8")[:72]
    try:
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except ValueError:
        return False


# --- JWT --------------------------------------------------------------------
def create_access_token(subject: str | int, expires_delta: timedelta | None = None) -> str:
    """subject(보통 user id)를 담은 JWT 액세스 토큰을 생성한다."""
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode = {"sub": str(subject), "exp": expire}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> str | None:
    """토큰을 검증하고 subject(user id 문자열)를 반환. 실패 시 None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload.get("sub")
    except JWTError:
        return None
