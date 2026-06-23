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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
