"""
애플리케이션 설정.

환경변수(.env) 또는 기본값을 사용한다.
운영 환경에서는 반드시 SECRET_KEY를 안전한 값으로 교체할 것.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # JWT 서명 키 — 운영에서는 .env 로 주입 (절대 커밋 금지)
    secret_key: str = "CHANGE_ME_IN_PRODUCTION_use_a_long_random_string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7일
    # 프로필 사진 저장 폴더 (Docker 에서는 영속 볼륨 /app/data/avatars)
    avatar_dir: str = "data/avatars"

    # 폰 알림 (웹 푸시, push.py). 키는 비워 두면 처음 켤 때 만들어 DB(club_settings)에 둔다.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    # VAPID 'sub' (https 주소나 mailto:). 비우면 회원이 알림을 켠 앱 주소(https)를 쓴다
    vapid_subject: str | None = None
    # 1분마다 '1시간 전'·'일정 공개' 알림을 보내는 일 (테스트에서는 끈다)
    push_scheduler: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
