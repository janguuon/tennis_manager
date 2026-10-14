"""
프로필 사진 저장.

- 서버 data 폴더(settings.avatar_dir, Docker 에서는 영속 볼륨)에 `{회원id}-{12자리 hex}.jpg` 로 저장한다.
  이름에 무작위 값이 들어가 사진을 바꾸면 주소도 바뀌므로 브라우저가 오래 캐시해도 된다.
- 회원의 avatar_url 은 "/avatars/{파일}" — 프론트가 같은 경로로 받아 로그인한 회원에게만 보여 준다.
- 올린 사진은 방향(EXIF)을 바로잡고 가운데 정사각형 400px JPEG 로 다시 저장한다(위치 등 메타데이터는 남지 않는다).
"""
import re
import secrets
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

AVATAR_SIZE = 400
MAX_AVATAR_BYTES = 8 * 1024 * 1024
URL_PREFIX = "/avatars/"
_FILE_NAME = re.compile(r"\d+-[0-9a-f]{12}\.jpg")

# 너무 큰 이미지(압축 폭탄)는 열지 않는다
Image.MAX_IMAGE_PIXELS = 50_000_000


def avatar_dir() -> Path:
    path = Path(settings.avatar_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_for(name: str) -> Path | None:
    """저장된 사진 파일. 이름 형식이 다르거나 없으면 None (경로 조작 방지)."""
    if not _FILE_NAME.fullmatch(name):
        return None
    path = avatar_dir() / name
    return path if path.is_file() else None


def save_avatar(user_id: int, data: bytes) -> str:
    """사진을 정사각형 JPEG 로 저장하고 avatar_url 을 돌려준다. 사진이 아니면 ValueError."""
    try:
        with Image.open(BytesIO(data)) as raw:
            img = ImageOps.exif_transpose(raw).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as err:
        raise ValueError("사진 파일(JPG·PNG)만 올릴 수 있어요.") from err
    # 투명한 부분은 흰 바탕으로
    flat = Image.new("RGB", img.size, (255, 255, 255))
    flat.paste(img, mask=img.getchannel("A"))
    square = ImageOps.fit(flat, (AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS)
    name = f"{user_id}-{secrets.token_hex(6)}.jpg"
    square.save(avatar_dir() / name, "JPEG", quality=85, optimize=True)
    return URL_PREFIX + name


def remove_avatar(url: str | None) -> None:
    """저장된 사진 파일을 지운다 (사진 변경·삭제, 회원 완전 삭제 때)."""
    if url and url.startswith(URL_PREFIX):
        path = file_for(url[len(URL_PREFIX):])
        if path is not None:
            path.unlink(missing_ok=True)
