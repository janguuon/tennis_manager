"""프로필 사진 파일 내려주기 (로그인한 회원만)."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from .. import avatars
from ..deps import get_current_user
from ..models import User

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get("/{filename}")
def get_avatar(filename: str, _: User = Depends(get_current_user)):
    path = avatars.file_for(filename)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="사진을 찾을 수 없습니다.")
    # 사진을 바꾸면 파일 이름이 바뀌므로 오래 캐시해도 된다
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
