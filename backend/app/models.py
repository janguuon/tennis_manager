"""
오테식 매니저 데이터베이스 모델 (SQLAlchemy 2.0 스타일).

핵심 엔티티
-----------
- User          : 회원 (가입/로그인/프로필)
- Match         : 한 경기(전적)의 메타데이터 (날짜/장소/유형/점수/승패)
- MatchPlayer   : 경기-회원 N:M 연결 테이블 (어느 팀 소속인지 기록 → 페어/상대 전적의 핵심)
- Gathering     : 모임 (캘린더 기반 일정/코트)
- Participant   : 모임 참여자 + 참석/불참 투표 상태
- Draw / DrawMatch : 모임 참여자 기반 자동/수동 대진표
- CourtBooking  : 오테식 모임의 코트 예약 내역 (예약자가 낸 코트비를 회비에서 돌려줌)

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
    """경기 유형: 단식 / 남복 / 여복 / 혼복 / 잡복."""

    SINGLES = "singles"            # 단식
    MENS_DOUBLES = "mens_doubles"  # 남자복식
    WOMENS_DOUBLES = "womens_doubles"  # 여자복식
    MIXED_DOUBLES = "mixed_doubles"    # 혼합복식 (팀마다 남1·여1)
    OPEN_DOUBLES = "open_doubles"      # 잡복: 위에 맞지 않는 성별 구성 (자동 대진에서 어쩔 수 없을 때만)


class TeamSide(int, enum.Enum):
    """경기 내 팀 구분."""

    TEAM_1 = 1
    TEAM_2 = 2


class ApprovalStatus(str, enum.Enum):
    """가입 승인 상태 (관리자 승인제)."""

    PENDING = "pending"     # 가입 신청 → 승인 대기
    APPROVED = "approved"   # 승인됨 → 로그인 가능
    REJECTED = "rejected"   # 거절됨
    # 모임 참석자가 이름만 적어 초대한 게스트 (가입·로그인하지 않는다, 회원 명단에 나오지 않는다)
    INVITED = "invited"


class MemberType(str, enum.Enum):
    """
    회원 구분 (회칙 제3조). 관리자(is_admin)와 별개로 관리자가 지정한다.
    일정이 보이는 시점(app/visibility.py)과 정산 권한·금액이 다르다.
    적은 순서가 회원 목록 순서다 (임원진 직함순 → 정회원 → 게스트).
    """

    # 임원진 (OFFICER_TYPES): 모두 임원진 권한이고, 정산은 총무만 한다 (회칙 제8조)
    PRESIDENT = "president"  # 회장
    VICE_PRESIDENT = "vice_president"  # 부회장
    ADVISOR = "advisor"  # 고문
    MATCH_DIRECTOR = "match_director"  # 경기이사
    TREASURER = "treasurer"  # 총무: 임원진 권한 + 정산(입금 확인·코트비 지급)
    VICE_TREASURER = "vice_treasurer"  # 부총무
    OFFICER = "officer"   # 임원진: 등록 즉시 보임, 오테식 정모·벙개 생성·운영, 대진
    MEMBER = "member"     # 정회원: 전주 금요일 오전 10시부터 (다음 주 월~일 일정)
    GUEST = "guest"       # 게스트: 모임 3일 전 0시부터, 오테식 모임 참석 시 게스트비


OFFICER_TYPES = (
    MemberType.PRESIDENT,
    MemberType.VICE_PRESIDENT,
    MemberType.ADVISOR,
    MemberType.MATCH_DIRECTOR,
    MemberType.TREASURER,
    MemberType.VICE_TREASURER,
    MemberType.OFFICER,
)


class AttendanceStatus(str, enum.Enum):
    """모임 참석 투표 상태."""

    ATTENDING = "attending"   # 참석
    ABSENT = "absent"         # 불참
    MAYBE = "maybe"           # 미정 (더 이상 고를 수 없음 — 예전 투표 표시용)
    WAITING = "waiting"       # 대기: 정원이 차서 기다리는 중. 자리가 나면 순서대로 참석이 된다


class GatheringStatus(str, enum.Enum):
    PLANNED = "planned"       # 예정
    ONGOING = "ongoing"       # 진행중
    COMPLETED = "completed"   # 완료
    CANCELED = "canceled"     # 취소


class GatheringKind(str, enum.Enum):
    """모임 종류. 종류에 따라 정산 방식이 다르다."""

    CLUB_REGULAR = "club_regular"  # 오테식 정모: 회비에서 지출 (코트비는 예약자에게 돌려줌)
    CLUB_FLASH = "club_flash"      # 오테식 벙개: 회비에서 지출
    FLASH = "flash"                # 일반 벙개: 코트비 + 캔볼값을 참석자끼리 n빵


CLUB_KINDS = (GatheringKind.CLUB_REGULAR, GatheringKind.CLUB_FLASH)


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
    member_type: Mapped[MemberType] = mapped_column(
        Enum(MemberType), default=MemberType.MEMBER, server_default=MemberType.MEMBER.name
    )
    # 초대 게스트(approval_status=INVITED)를 데려온 회원
    invited_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # 대회 입상 별 개수 (관리자만 정한다): 금 우승 · 은 준우승 · 동 입상. 프로필 동그라미 위에 별로 보인다
    award_gold: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    award_silver: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    award_bronze: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    award_note: Mapped[str | None] = mapped_column(String(100))  # 짧은 이력 (예: "2026 OO오픈 우승")
    # 클럽 소식 팝업을 마지막으로 확인한 시각. 이보다 나중에 올라온 소식이 "새 소식"이다
    notice_seen_at: Mapped[datetime | None] = mapped_column(DateTime)

    # 코트비 등을 돌려받을 계좌 (본인과 관리자·임원진에게만 공개)
    bank: Mapped[str | None] = mapped_column(String(50))
    account_number: Mapped[str | None] = mapped_column(String(50))
    account_holder: Mapped[str | None] = mapped_column(String(50))

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # 관계
    match_links: Mapped[list[MatchPlayer]] = relationship(back_populates="user")
    participations: Mapped[list[Participant]] = relationship(back_populates="user")
    inviter: Mapped["User | None"] = relationship(remote_side="User.id", foreign_keys=[invited_by_id])

    @property
    def is_invited(self) -> bool:
        """이름만 적어 초대한 게스트 (가입하지 않은 사람)."""
        return self.approval_status == ApprovalStatus.INVITED

    @property
    def invited_by_name(self) -> str | None:
        """초대 게스트를 데려온 회원 이름 (화면 표시: "게스트 · 김민준 초대")."""
        return self.inviter.name if self.is_invited and self.inviter else None

    @property
    def is_guest(self) -> bool:
        """게스트(관리자 제외): 일정(캘린더·모임)만 본다. 회원 명단·정산·회칙은 보지 않는다."""
        return not self.is_admin and self.member_type == MemberType.GUEST

    @property
    def is_staff(self) -> bool:
        """관리자·임원진(회장·부회장·고문·경기이사·총무·부총무 포함): 오테식 모임 생성·운영, 대진, 일정 먼저 보기."""
        return self.is_admin or self.member_type in OFFICER_TYPES

    @property
    def can_settle(self) -> bool:
        """관리자·총무: 정산(오테식 모임 입금 확인, 코트비 지급·지급 내역, 예약자 계좌 보기)."""
        return self.is_admin or self.member_type == MemberType.TREASURER


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
    # 코트 주소(선택): 지도 버튼이 장소 이름보다 먼저 이 주소로 찾는다. 같은 장소의 다른 일정과 함께 쓴다
    address: Mapped[str | None] = mapped_column(String(200))
    court_count: Mapped[int] = mapped_column(Integer, default=1)
    # 실제 코트 번호 목록 (쉼표 구분, 예: "3, 5"). 입력 시 court_count는 이 개수로 자동 설정.
    court_numbers: Mapped[str | None] = mapped_column(String(200))
    # 코트 바닥 재질(선택): hard 하드 · turf 인조잔디 · clay 클레이 · carpet 카펫. 같은 장소의 다른 일정과 함께 쓴다
    court_surface: Mapped[str | None] = mapped_column(String(20))
    # 코트요정: 코트를 잡아 준 사람(들) 이름. 엑셀 일정 등록에서 채운다 (예: "서승우, 김하린")
    court_fairy: Mapped[str | None] = mapped_column(String(200))
    # 예약자명: 코트에서 말할 예약 이름(빌린 아이디일 수 있다). 예: "3·5번 장미주, 2번 김다빈"
    court_reservers: Mapped[str | None] = mapped_column(String(300))
    max_participants: Mapped[int | None] = mapped_column(Integer)

    kind: Mapped[GatheringKind] = mapped_column(
        Enum(GatheringKind), default=GatheringKind.FLASH, server_default=GatheringKind.FLASH.name
    )

    # 일반 벙개: 참석자끼리 n빵할 총액. 코트비·캔볼값을 입력하면 둘의 합으로 맞춘다.
    # (오테식 모임은 회비에서 지출하므로 0)
    fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    court_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ball_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 오테식 모임: 게스트 1인 참가비 (회칙 제17조). 일반 벙개는 0.
    guest_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 입금 계좌 (참가자 공개) — 은행/계좌번호/예금주
    bank: Mapped[str | None] = mapped_column(String(50))
    account_number: Mapped[str | None] = mapped_column(String(50))
    account_holder: Mapped[str | None] = mapped_column(String(50))

    status: Mapped[GatheringStatus] = mapped_column(
        Enum(GatheringStatus), default=GatheringStatus.PLANNED
    )

    # 운영진이 정해진 공개 시각(전주 금요일 오전 10시)보다 일찍 공개한 시각 (한국 시간). 미리 공개하지 않았으면 NULL
    opened_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 모임 취소 사유(우천·코트 취소 등)와 취소한 시각 (한국 시간). 취소되지 않았으면 NULL
    cancel_reason: Mapped[str | None] = mapped_column(String(100))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 취소 정산 금액 (취소돼도 낼 돈, 예: 코트 위약금). 일반 벙개는 참석자끼리 나눌 총액,
    # 오테식 모임은 게스트 1인 금액. 취소되지 않은 모임은 0
    cancel_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

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
    court_bookings: Mapped[list[CourtBooking]] = relationship(
        back_populates="gathering", cascade="all, delete-orphan", order_by="CourtBooking.id"
    )

    @property
    def is_club(self) -> bool:
        """오테식 정모·벙개: 회비에서 지출하는 모임."""
        return self.kind in CLUB_KINDS


class CourtBooking(Base):
    """
    오테식 모임의 코트 예약 1건.

    코트를 잡은 회원(코트요정)이 코트비를 먼저 내고, 총무(관리자·임원진)가 회비에서 돌려준다.
    한 모임에 예약자가 여러 명일 수 있어(코트마다 다른 사람) 모임과 분리했다.
    엑셀로 올린 코트요정이 아직 회원이 아니면 booker_id 없이 적은 이름(booker_name)만 남기고,
    그 이름으로 가입이 승인되면 그 회원에게 이어 준다.
    """

    __tablename__ = "court_bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gathering_id: Mapped[int] = mapped_column(
        ForeignKey("gatherings.id"), nullable=False, index=True
    )
    booker_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    # 회원이 아닌 코트요정의 이름 (엑셀에 적은 그대로). 회원이면 비어 있다
    booker_name: Mapped[str | None] = mapped_column(String(50))
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    court_label: Mapped[str | None] = mapped_column(String(50))  # 예: "3번 코트"

    # 코트 취소(우천 등): 취소한 시각과 취소 수수료. 취소하면 코트비 대신 수수료만 회비에서 지급한다
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_fee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # 지급 처리: 시각과 처리한 사람. 미지급이면 NULL.
    reimbursed_at: Mapped[datetime | None] = mapped_column(DateTime)
    reimbursed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    gathering: Mapped[Gathering] = relationship(back_populates="court_bookings")
    booker: Mapped[User | None] = relationship(foreign_keys=[booker_id])
    reimburser: Mapped[User | None] = relationship(foreign_keys=[reimbursed_by])

    @property
    def payee_name(self) -> str:
        """코트비를 받을 사람 이름: 회원이면 회원 이름, 아니면 적은 이름."""
        return self.booker.name if self.booker else (self.booker_name or "")

    @property
    def payable(self) -> int:
        """회비에서 지급할 금액: 코트비, 코트를 취소했으면 취소 수수료(0원이면 지급할 것 없음)."""
        return self.cancel_fee if self.canceled_at is not None else self.amount


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
    # 대기 순서: 대기에 들어간 시각 (참석이 되거나 빠지면 비운다)
    waiting_since: Mapped[datetime | None] = mapped_column(DateTime)

    # 참가비 입금 여부 (회비 정산). paid_at은 입금 처리 시각.
    paid: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 입금 처리 당시의 1인 금액. 이후 참석 인원이 바뀌어 1인 금액이 달라져도
    # 실제 받은 돈을 기준으로 차액(추가 입금/환불)을 계산하기 위해 저장한다.
    paid_amount: Mapped[int | None] = mapped_column(Integer)
    # 게스트비 면제 (관리자·총무, 오테식 모임 게스트만). 회칙 제17조 ⑦ 무료 모집 등
    fee_waived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    fee_waiver_reason: Mapped[str | None] = mapped_column(String(100))  # 예: 당일 인원 부족 무료 모집

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


class ClubSetting(Base):
    """
    클럽 공통 설정 (키-값). 지금은 모임 통장(오테식 모임 게스트비 입금 계좌)만 쓴다.
    계좌번호처럼 코드 저장소에 올리면 안 되는 값을 앱에서 바꿀 수 있게 DB에 둔다.
    """

    __tablename__ = "club_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)


class Notice(Base):
    """클럽 소식: 운영진이 올리는 축하(대회 입상 등)·소식. 회원이 들어오면 안 본 소식이 팝업으로 뜬다."""

    __tablename__ = "notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="news")  # celebrate(축하) | news(소식)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    show_until: Mapped[date | None] = mapped_column(Date)  # 이 날까지 보인다 (비우면 지울 때까지)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # 회원의 notice_seen_at과 비교하므로 같은 시계(파이썬 현지 시각)로 적는다
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    author: Mapped[User | None] = relationship()
