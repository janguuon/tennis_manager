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
    ("participants", "paid_amount", "paid_amount INTEGER"),
    # 회원 구분 (기존 회원은 정회원)
    ("users", "member_type", "member_type VARCHAR(7) NOT NULL DEFAULT 'MEMBER'"),
    # 환급 계좌, 모임 종류·코트비·캔볼값·게스트비 (Enum은 이름으로 저장된다)
    ("users", "bank", "bank VARCHAR(50)"),
    ("users", "account_number", "account_number VARCHAR(50)"),
    ("users", "account_holder", "account_holder VARCHAR(50)"),
    ("gatherings", "kind", "kind VARCHAR(12) NOT NULL DEFAULT 'FLASH'"),
    ("gatherings", "court_fee", "court_fee INTEGER NOT NULL DEFAULT 0"),
    ("gatherings", "ball_fee", "ball_fee INTEGER NOT NULL DEFAULT 0"),
    ("gatherings", "guest_fee", "guest_fee INTEGER NOT NULL DEFAULT 0"),
    # 코트요정 (엑셀 일정 등록)
    ("gatherings", "court_fairy", "court_fairy VARCHAR(200)"),
    # 참석 대기열 순서
    ("participants", "waiting_since", "waiting_since DATETIME"),
    # 회원이 아닌 코트요정 이름 (엑셀 일정 등록)
    ("court_bookings", "booker_name", "booker_name VARCHAR(50)"),
    # 코트 예약자명 (코트에서 말할 예약 이름)
    ("gatherings", "court_reservers", "court_reservers VARCHAR(300)"),
    # 이름만 적어 초대한 게스트를 데려온 회원
    ("users", "invited_by_id", "invited_by_id INTEGER REFERENCES users(id)"),
    # 게스트비 면제
    ("participants", "fee_waived", "fee_waived BOOLEAN NOT NULL DEFAULT 0"),
    ("participants", "fee_waiver_reason", "fee_waiver_reason VARCHAR(100)"),
    # 코트 주소 (지도 버튼)
    ("gatherings", "address", "address VARCHAR(200)"),
    # 운영진 미리 공개
    ("gatherings", "opened_at", "opened_at DATETIME"),
    ("users", "notice_seen_at", "notice_seen_at DATETIME"),
    # 대회 입상 별 개수와 이력
    ("users", "award_gold", "award_gold INTEGER NOT NULL DEFAULT 0"),
    ("users", "award_silver", "award_silver INTEGER NOT NULL DEFAULT 0"),
    ("users", "award_bronze", "award_bronze INTEGER NOT NULL DEFAULT 0"),
    ("users", "award_note", "award_note VARCHAR(100)"),
    # 모임 취소 사유
    ("gatherings", "cancel_reason", "cancel_reason VARCHAR(100)"),
    ("gatherings", "canceled_at", "canceled_at DATETIME"),
    ("gatherings", "cancel_fee", "cancel_fee INTEGER NOT NULL DEFAULT 0"),
    # 코트 취소와 취소 수수료
    ("court_bookings", "canceled_at", "canceled_at DATETIME"),
    ("court_bookings", "cancel_fee", "cancel_fee INTEGER NOT NULL DEFAULT 0"),
    # 코트 바닥 재질
    ("gatherings", "court_surface", "court_surface VARCHAR(20)"),
    # 청백전 최종 승리팀
    ("tournaments", "winner_team", "winner_team VARCHAR(10)"),
]


def run_lightweight_migrations(bind=None) -> None:
    """create_all 이후 호출. 누락된 컬럼이 있으면 ADD COLUMN으로 추가한다."""
    bind = bind or engine
    if bind.dialect.name != "sqlite":
        return
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    with bind.begin() as conn:
        for table, column, ddl in _COLUMN_MIGRATIONS:
            if table not in existing_tables:
                continue  # 신규 환경은 create_all이 이미 최신 스키마로 생성함
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
        if "court_bookings" in existing_tables:
            _relax_court_booker(conn)


def _relax_court_booker(conn) -> None:
    """court_bookings.booker_id 의 NOT NULL 을 푼다 (회원이 아닌 코트요정은 이름만 남긴다).

    SQLite 는 컬럼 제약을 바꿀 수 없어, 예전 표의 이름을 바꿔 두고 최신 정의로 새 표를 만든 뒤 옮겨 담는다.
    """
    cols = inspect(conn).get_columns("court_bookings")
    if next(c for c in cols if c["name"] == "booker_id")["nullable"]:
        return
    from .models import CourtBooking  # models 가 이 모듈의 Base 를 쓰므로 여기서 불러온다

    names = ", ".join(c["name"] for c in cols)
    conn.execute(text("ALTER TABLE court_bookings RENAME TO court_bookings_old"))
    # 인덱스 이름은 표 이름을 바꿔도 그대로라 새 표의 인덱스와 겹치지 않게 지운다
    for ix in inspect(conn).get_indexes("court_bookings_old"):
        conn.execute(text(f'DROP INDEX IF EXISTS "{ix["name"]}"'))
    CourtBooking.__table__.create(conn)
    conn.execute(text(f"INSERT INTO court_bookings ({names}) SELECT {names} FROM court_bookings_old"))
    conn.execute(text("DROP TABLE court_bookings_old"))
