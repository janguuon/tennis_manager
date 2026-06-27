"""
Team Breaker 데이터베이스 모델 (SQLAlchemy 2.0 스타일).

핵심 엔티티
-----------
- User          : 회원 (가입/로그인/프로필)
- Match         : 한 경기(전적)의 메타데이터 (날짜/장소/유형/점수/승패)
- MatchPlayer   : 경기-회원 N:M 연결 테이블 (어느 팀 소속인지 기록 → 페어/상대 전적의 핵심)
- Gathering     : 모임 (캘린더 기반 일정/코트)
- Participant   : 모임 참여자 + 참석/불참 투표 상태
- Draw / DrawMatch : 모임 참여자 기반 자동/수동 대진표

설계 핵심
---------
1) 전적(Match)과 회원(User)을 MatchPlayer 라는 연결 테이블로 분리했다.
   - 단식(2명)/복식(4명)을 하나의 구조로 표현 가능
   - team(1/2)과 slot으로 "같은 팀=페어, 반대 팀=상대"를 구분 → 페어전적·상대전적 쿼리 가능
2) 랭킹/승률은 별도 테이블에 저장하지 않고 Match 기록으로부터 집계(derived)한다.
   - 데이터 정합성 유지가 쉽고, 집계 로직 변경에 유연. (필요 시 추후 캐시 테이블 도입)
"""
from __future__ import annotations

import enum
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


# ---------------------------------------------------------------------------
# Enum 정의
# ---------------------------------------------------------------------------
class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"


class MatchType(str, enum.Enum):
    """경기 유형: 단식 / 남복 / 여복 / 혼복."""

    SINGLES = "singles"            # 단식
    MENS_DOUBLES = "mens_doubles"  # 남자복식
    WOMENS_DOUBLES = "womens_doubles"  # 여자복식
    MIXED_DOUBLES = "mixed_doubles"    # 혼합복식


class TeamSide(int, enum.Enum):
    """경기 내 팀 구분."""

    TEAM_1 = 1
    TEAM_2 = 2


class ApprovalStatus(str, enum.Enum):
    """가입 승인 상태 (관리자 승인제)."""

    PENDING = "pending"     # 가입 신청 → 승인 대기
    APPROVED = "approved"   # 승인됨 → 로그인 가능
    REJECTED = "rejected"   # 거절됨


class AttendanceStatus(str, enum.Enum):
    """모임 참석 투표 상태."""

    ATTENDING = "attending"   # 참석
    ABSENT = "absent"         # 불참
    MAYBE = "maybe"           # 미정


class GatheringStatus(str, enum.Enum):
    PLANNED = "planned"       # 예정
    ONGOING = "ongoing"       # 진행중
    COMPLETED = "completed"   # 완료
    CANCELED = "canceled"     # 취소


# ---------------------------------------------------------------------------
# 회원
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # 인증 — 로그인 ID는 username(아이디). 이메일은 선택 항목.
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # 프로필
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    nickname: Mapped[str | None] = mapped_column(String(50), unique=True, index=True)
    gender: Mapped[Gender | None] = mapped_column(Enum(Gender))
    # NTRP(전국테니스등급) 등 실력 지표 — 실력 기반 자동 대진에 사용
    ntrp: Mapped[float | None] = mapped_column()
    phone: Mapped[str | None] = mapped_column(String(20))
    bio: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(String(500))

    # 가입 승인제: 관리자가 승인해야 로그인 가능
    approval_status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus), default=ApprovalStatus.PENDING, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # 관계
    match_links: Mapped[list[MatchPlayer]] = relationship(back_populates="user")
    participations: Mapped[list[Participant]] = relationship(back_populates="user")


# ---------------------------------------------------------------------------
# 경기 / 전적
# ---------------------------------------------------------------------------
class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    match_type: Mapped[MatchType] = mapped_column(Enum(MatchType), nullable=False)

    # 상세 히스토리: 날짜 / 장소
    played_at: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(200))

    # 점수: 게임 스코어 (예: 6-4 → team1_score=6, team2_score=4)
    team1_score: Mapped[int] = mapped_column(Integer, default=0)
    team2_score: Mapped[int] = mapped_column(Integer, default=0)
    # 승리 팀 (무승부/미정은 NULL). 점수로 계산 가능하지만 조회 편의를 위해 저장.
    winner_team: Mapped[TeamSide | None] = mapped_column(Enum(TeamSide))

    # 이 경기가 특정 모임/대진에서 생성되었다면 연결 (단발성 친선경기는 NULL)
    gathering_id: Mapped[int | None] = mapped_column(ForeignKey("gatherings.id"))

    # 전적을 입력/기록한 회원 (삭제·수정 권한 판단용)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 관계
    players: Mapped[list[MatchPlayer]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    gathering: Mapped[Gathering | None] = relationship(back_populates="matches")


class MatchPlayer(Base):
    """
    경기와 회원을 잇는 연결 테이블.

    team(1/2)으로 한 회원이 어느 팀이었는지 기록한다.
    - 같은 match_id + 같은 team  → 페어(파트너)
    - 같은 match_id + 다른 team  → 상대방
    이 구조 덕분에 '페어 전적'·'상대 전적'을 단일 테이블 self-join으로 계산할 수 있다.
    """

    __tablename__ = "match_players"
    __table_args__ = (
        UniqueConstraint("match_id", "user_id", name="uq_match_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    team: Mapped[TeamSide] = mapped_column(Enum(TeamSide), nullable=False)

    match: Mapped[Match] = relationship(back_populates="players")
    user: Mapped[User] = relationship(back_populates="match_links")


# ---------------------------------------------------------------------------
# 모임 / 캘린더
# ---------------------------------------------------------------------------
class Gathering(Base):
    __tablename__ = "gatherings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # 캘린더 일정
    event_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)

    # 코트/장소
    location: Mapped[str | None] = mapped_column(String(200))
    court_count: Mapped[int] = mapped_column(Integer, default=1)
    # 실제 코트 번호 목록 (쉼표 구분, 예: "3, 5"). 입력 시 court_count는 이 개수로 자동 설정.
    court_numbers: Mapped[str | None] = mapped_column(String(200))
    max_participants: Mapped[int | None] = mapped_column(Integer)

    # 1인 참가비(원). 0이면 무료. 모임별 회비 정산에 사용.
    fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 입금 계좌 (참가자 공개) — 은행/계좌번호/예금주
    bank: Mapped[str | None] = mapped_column(String(50))
    account_number: Mapped[str | None] = mapped_column(String(50))
    account_holder: Mapped[str | None] = mapped_column(String(50))

    status: Mapped[GatheringStatus] = mapped_column(
        Enum(GatheringStatus), default=GatheringStatus.PLANNED
    )

    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # 관계
    participants: Mapped[list[Participant]] = relationship(
        back_populates="gathering", cascade="all, delete-orphan"
    )
    matches: Mapped[list[Match]] = relationship(back_populates="gathering")
    draws: Mapped[list[Draw]] = relationship(
        back_populates="gathering", cascade="all, delete-orphan"
    )


class Participant(Base):
    """모임 참여자 + 참석/불참 투표 상태."""

    __tablename__ = "participants"
    __table_args__ = (
        UniqueConstraint("gathering_id", "user_id", name="uq_gathering_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gathering_id: Mapped[int] = mapped_column(
        ForeignKey("gatherings.id"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    status: Mapped[AttendanceStatus] = mapped_column(
        Enum(AttendanceStatus), default=AttendanceStatus.MAYBE
    )
    voted_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # 참가비 납부 여부 (회비 정산). paid_at은 납부 처리 시각.
    paid: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)

    gathering: Mapped[Gathering] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(back_populates="participations")


# ---------------------------------------------------------------------------
# 대진표 (자동/수동 생성)
# ---------------------------------------------------------------------------
class Draw(Base):
    """
    한 모임에 대한 대진표 묶음.

    한 모임에서 여러 번(라운드/시도) 대진을 생성할 수 있으므로 분리했다.
    generation_method 로 랜덤/실력기반/수동 여부를 기록한다.
    """

    __tablename__ = "draws"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gathering_id: Mapped[int] = mapped_column(
        ForeignKey("gatherings.id"), nullable=False, index=True
    )
    name: Mapped[str | None] = mapped_column(String(100))  # 예: "1라운드", "오전 대진"
    generation_method: Mapped[str] = mapped_column(String(20), default="random")  # random|skill|manual
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    gathering: Mapped[Gathering] = relationship(back_populates="draws")
    draw_matches: Mapped[list[DrawMatch]] = relationship(
        back_populates="draw", cascade="all, delete-orphan"
    )


class DrawMatch(Base):
    """
    대진표 안의 개별 대진(예정 경기).

    실제 경기 결과(Match)와는 분리. 대진이 실제로 치러져 결과가 입력되면
    result_match_id 로 Match에 연결한다. player ids는 단순 JSON 대신
    정규화를 위해 DrawMatchPlayer를 둘 수도 있으나, Step1에서는 코트/팀 슬롯만 정의.
    """

    __tablename__ = "draw_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draw_id: Mapped[int] = mapped_column(ForeignKey("draws.id"), nullable=False, index=True)

    court_number: Mapped[int | None] = mapped_column(Integer)
    round_number: Mapped[int | None] = mapped_column(Integer)
    match_type: Mapped[MatchType] = mapped_column(Enum(MatchType), nullable=False)

    # 대진에 배정된 회원 (단식 2명/복식 4명). 수동 편집 시 갱신.
    team1_player1_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    team1_player2_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    team2_player1_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    team2_player2_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # 결과가 입력되면 실제 Match로 연결
    result_match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"))

    draw: Mapped[Draw] = relationship(back_populates="draw_matches")
