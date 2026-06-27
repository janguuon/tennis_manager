"""
데이터베이스 연결 및 세션 관리.

SQLite 파일(tennismanager.db)을 사용하며, SQLAlchemy 2.0 스타일의
Declarative Base와 세션 팩토리를 정의한다.
"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
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


# 기존 운영 DB에 새로 추가된 컬럼을 채우는 경량 마이그레이션.
# Alembic을 도입하기 전까지, 이미 만들어진 테이블에 컬럼만 ADD COLUMN으로 보강한다(SQLite 한정).
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    # (테이블, 컬럼, ADD COLUMN 정의)
    ("gatherings", "fee", "fee INTEGER NOT NULL DEFAULT 0"),
    ("gatherings", "bank", "bank VARCHAR(50)"),
    ("gatherings", "account_number", "account_number VARCHAR(50)"),
    ("gatherings", "account_holder", "account_holder VARCHAR(50)"),
    ("participants", "paid", "paid BOOLEAN NOT NULL DEFAULT 0"),
    ("participants", "paid_at", "paid_at DATETIME"),
]


def run_lightweight_migrations() -> None:
    """create_all 이후 호출. 누락된 컬럼이 있으면 ADD COLUMN으로 추가한다."""
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in _COLUMN_MIGRATIONS:
            if table not in existing_tables:
                continue  # 신규 환경은 create_all이 이미 최신 스키마로 생성함
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
