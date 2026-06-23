"""
데이터베이스 연결 및 세션 관리.

SQLite 파일(tennismanager.db)을 사용하며, SQLAlchemy 2.0 스타일의
Declarative Base와 세션 팩토리를 정의한다.
"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# DB 경로. 기본은 backend/tennismanager.db, 환경변수 DATABASE_URL로 덮어쓸 수 있다.
# (Docker 배포 시 sqlite:////app/data/tennismanager.db 처럼 볼륨 경로 지정)
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./tennismanager.db")

# check_same_thread=False : FastAPI는 여러 스레드에서 동일 커넥션을 사용할 수 있으므로
# SQLite 기본 제약을 해제한다.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """모든 ORM 모델의 베이스 클래스."""

    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI 의존성 주입용 DB 세션 제공자."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
