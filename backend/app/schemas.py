"""
Pydantic 입출력 스키마 (요청 검증 / 응답 직렬화).

ORM 모델(models.py)과 분리해 API 계약을 명확히 한다.
"""
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import (
    ApprovalStatus,
    AttendanceStatus,
    GatheringStatus,
    Gender,
    MatchType,
    TeamSide,
)


# --- 회원 -------------------------------------------------------------------
class UserBase(BaseModel):
    name: str = Field(..., max_length=50)
    nickname: str | None = Field(None, max_length=50)
    gender: Gender | None = None
    ntrp: float | None = Field(None, ge=1.0, le=7.0)
    phone: str | None = Field(None, max_length=20)
    bio: str | None = None
    avatar_url: str | None = Field(None, max_length=500)


class UserCreate(UserBase):
    """회원가입(신청) 요청. 로그인 ID는 username."""

    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(..., min_length=8, max_length=72)
    email: EmailStr | None = None


class UserUpdate(BaseModel):
    """프로필 수정 요청 (보낸 필드만 변경)."""

    name: str | None = Field(None, max_length=50)
    nickname: str | None = Field(None, max_length=50)
    gender: Gender | None = None
    ntrp: float | None = Field(None, ge=1.0, le=7.0)
    phone: str | None = Field(None, max_length=20)
    bio: str | None = None
    avatar_url: str | None = Field(None, max_length=500)


class UserRead(UserBase):
    """회원 응답 (비밀번호 제외)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr | None = None
    approval_status: ApprovalStatus
    is_active: bool
    is_admin: bool
    created_at: datetime


# --- 인증 -------------------------------------------------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class SignupResponse(BaseModel):
    """가입 신청 결과. 승인 대기 안내 메시지를 함께 반환."""

    user: UserRead
    message: str


# --- 회원 요약 (전적/매치 응답에 임베드) ------------------------------------
class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    name: str
    nickname: str | None = None
    gender: Gender | None = None
    ntrp: float | None = None


# --- 경기 / 전적 ------------------------------------------------------------
class MatchPlayerInput(BaseModel):
    user_id: int
    team: TeamSide


class MatchCreate(BaseModel):
    """경기 결과 입력. players 로 양 팀 구성원을 지정한다."""

    match_type: MatchType
    played_at: date
    location: str | None = Field(None, max_length=200)
    team1_score: int = Field(0, ge=0)
    team2_score: int = Field(0, ge=0)
    # 미지정 시 점수로 자동 판정 (동점이면 무승부 처리 → NULL)
    winner_team: TeamSide | None = None
    gathering_id: int | None = None
    note: str | None = None
    players: list[MatchPlayerInput]

    @model_validator(mode="after")
    def _validate_roster(self):
        ids = [p.user_id for p in self.players]
        if len(ids) != len(set(ids)):
            raise ValueError("같은 회원이 한 경기에 중복될 수 없습니다.")

        team1 = [p for p in self.players if p.team == TeamSide.TEAM_1]
        team2 = [p for p in self.players if p.team == TeamSide.TEAM_2]
        if self.match_type == MatchType.SINGLES:
            if len(team1) != 1 or len(team2) != 1:
                raise ValueError("단식은 각 팀 1명씩(총 2명)이어야 합니다.")
        else:
            if len(team1) != 2 or len(team2) != 2:
                raise ValueError("복식은 각 팀 2명씩(총 4명)이어야 합니다.")
        return self


class MatchUpdate(BaseModel):
    """경기 결과 수정 (점수/장소/날짜/메모/승팀). 참가자 변경은 삭제 후 재등록."""

    played_at: date | None = None
    location: str | None = Field(None, max_length=200)
    team1_score: int | None = Field(None, ge=0)
    team2_score: int | None = Field(None, ge=0)
    winner_team: TeamSide | None = None
    note: str | None = None


class MatchPlayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    team: TeamSide
    user: UserBrief


class MatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_type: MatchType
    played_at: date
    location: str | None = None
    team1_score: int
    team2_score: int
    winner_team: TeamSide | None = None
    gathering_id: int | None = None
    note: str | None = None
    created_at: datetime
    players: list[MatchPlayerRead]


# --- 통계 / 랭킹 ------------------------------------------------------------
class RecordStats(BaseModel):
    """승/패/무 집계. win_rate 는 승부가 난 경기(승+패) 기준 0~1."""

    wins: int = 0
    losses: int = 0
    draws: int = 0
    total: int = 0
    win_rate: float = 0.0


class TypeRecord(BaseModel):
    match_type: MatchType
    record: RecordStats


class PlayerStatsRead(BaseModel):
    user: UserBrief
    overall: RecordStats
    by_type: list[TypeRecord]


class PartnerStat(BaseModel):
    """특정 회원과 같은 팀(페어)으로 뛰었을 때의 전적."""

    partner: UserBrief
    record: RecordStats


class OpponentStat(BaseModel):
    """특정 회원을 상대로 뛰었을 때의 상대 전적."""

    opponent: UserBrief
    record: RecordStats


class RankingEntry(BaseModel):
    rank: int
    user: UserBrief
    record: RecordStats


# --- 모임 / 캘린더 ----------------------------------------------------------
class GatheringBase(BaseModel):
    title: str = Field(..., max_length=200)
    description: str | None = None
    event_date: date
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(None, max_length=200)
    court_count: int = Field(1, ge=1, description="코트 면 수 = 동시 진행 가능한 대진 수")
    court_numbers: str | None = Field(None, max_length=200, description="실제 코트 번호(쉼표 구분, 예: '3, 5')")
    max_participants: int | None = Field(None, ge=1)


class GatheringCreate(GatheringBase):
    pass


class GatheringImportRowError(BaseModel):
    row: int
    error: str


class GatheringImportResult(BaseModel):
    """엑셀 일괄 업로드 결과."""

    created: int
    failed: int
    errors: list[GatheringImportRowError]


class GatheringUpdate(BaseModel):
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    event_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(None, max_length=200)
    court_count: int | None = Field(None, ge=1)
    court_numbers: str | None = Field(None, max_length=200)
    max_participants: int | None = Field(None, ge=1)
    status: GatheringStatus | None = None


class AttendanceSummary(BaseModel):
    attending: int = 0
    absent: int = 0
    maybe: int = 0
    total: int = 0


class GatheringRead(GatheringBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: GatheringStatus
    created_by: int
    created_at: datetime
    attendance: AttendanceSummary | None = None


class ParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserBrief
    status: AttendanceStatus
    voted_at: datetime


class GatheringDetail(GatheringRead):
    participants: list[ParticipantRead] = []


class ParticipantVote(BaseModel):
    """참석/불참/미정 투표."""

    status: AttendanceStatus


# --- 대진표 (Draw) ----------------------------------------------------------
class DrawGenerateRequest(BaseModel):
    match_type: MatchType
    method: Literal["random", "skill"] = "random"
    name: str | None = Field(None, max_length=100)


class DrawMatchRead(BaseModel):
    id: int
    court_number: int | None = None
    round_number: int | None = None
    match_type: MatchType
    team1: list[UserBrief] = []
    team2: list[UserBrief] = []
    result_match_id: int | None = None


class DrawRead(BaseModel):
    id: int
    gathering_id: int
    name: str | None = None
    generation_method: str
    created_at: datetime
    matches: list[DrawMatchRead] = []


class DrawCreate(BaseModel):
    """빈 수동 대진표 생성."""

    name: str | None = Field(None, max_length=100)


class DrawMatchCreate(BaseModel):
    """수동 대진 한 경기 추가."""

    match_type: MatchType
    court_number: int | None = None
    round_number: int | None = None
    team1_player1_id: int | None = None
    team1_player2_id: int | None = None
    team2_player1_id: int | None = None
    team2_player2_id: int | None = None


class DrawMatchEdit(BaseModel):
    """대진 수동 편집: 코트/라운드/선수 슬롯 변경."""

    court_number: int | None = None
    round_number: int | None = None
    team1_player1_id: int | None = None
    team1_player2_id: int | None = None
    team2_player1_id: int | None = None
    team2_player2_id: int | None = None


class DrawMatchResultInput(BaseModel):
    """대진 결과 입력 → Match 생성(전적 반영)."""

    team1_score: int = Field(0, ge=0)
    team2_score: int = Field(0, ge=0)
    winner_team: TeamSide | None = None
    played_at: date | None = None
    location: str | None = None
    note: str | None = None
