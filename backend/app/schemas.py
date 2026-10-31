"""
Pydantic 입출력 스키마 (요청 검증 / 응답 직렬화).

ORM 모델(models.py)과 분리해 API 계약을 명확히 한다.
"""
import re
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from .models import (
    ApprovalStatus,
    AttendanceStatus,
    GatheringKind,
    GatheringStatus,
    Gender,
    MatchType,
    MemberType,
    TeamSide,
    TournamentKind,
)

# 오테식 모임의 게스트 기본 참가비 (회칙 제17조)
GUEST_FEE_DEFAULT = 5000


# --- 회원 -------------------------------------------------------------------
def clean_phone(v: str | None) -> str | None:
    """전화번호 정리: 비우면 None, 휴대폰·지역번호는 하이픈을 넣는다 (01012345678 → 010-1234-5678)."""
    v = (v or "").strip()
    if not v:
        return None
    if not re.fullmatch(r"\+?[0-9\s().-]+", v):
        raise PydanticCustomError("phone_rule", "전화번호는 숫자로 적어 주세요. (예: 010-1234-5678)")
    digits = re.sub(r"\D", "", v)
    if not 8 <= len(digits) <= 15:
        raise PydanticCustomError("phone_rule", "전화번호 자릿수를 확인해 주세요. (예: 010-1234-5678)")
    if v.startswith("+"):
        return "+" + digits
    if len(digits) == 11 and digits.startswith("01"):
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10 and digits.startswith("01"):
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    if digits.startswith("02") and len(digits) in (9, 10):
        return f"02-{digits[2:-4]}-{digits[-4:]}"
    if digits.startswith("0") and len(digits) in (10, 11):
        return f"{digits[:3]}-{digits[3:-4]}-{digits[-4:]}"
    return digits


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

    username: str = Field(..., description="영문·숫자(_ . -) 3~50자")
    password: str = Field(..., description="4~72자")
    email: EmailStr | None = None
    # 대진(혼복·남복·여복)에 쓰여 가입할 때 꼭 받는다 (안 보내도 아래 한글 안내가 나가게 기본값을 검사)
    gender: Gender | None = Field(None, validate_default=True)

    # 회원에게 그대로 보이는 안내라 한글 문구로 돌려준다 (기본 문구는 영어 정규식)
    @field_validator("username")
    @classmethod
    def _username_rule(cls, v: str) -> str:
        v = v.strip()
        if re.search(r"[ㄱ-ㅎㅏ-ㅣ가-힣]", v):
            raise PydanticCustomError(
                "username_hangul", "아이디는 한글을 쓸 수 없어요. 영문·숫자로 적어 주세요. (한/영 키를 확인해 주세요)"
            )
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,50}", v):
            raise PydanticCustomError(
                "username_rule", "아이디는 영문·숫자로 3자 이상 적어 주세요. (띄어쓰기는 안 되고 기호는 _ . - 만 돼요)"
            )
        return v

    @field_validator("gender", mode="before")
    @classmethod
    def _gender_required(cls, v):
        if v not in (Gender.MALE, Gender.FEMALE, "male", "female"):
            raise PydanticCustomError("gender_required", "성별을 골라 주세요.")
        return v

    @field_validator("password")
    @classmethod
    def _password_rule(cls, v: str) -> str:
        if len(v) < 4:
            raise PydanticCustomError("password_short", "비밀번호는 4자 이상이어야 해요.")
        if len(v) > 72:
            raise PydanticCustomError("password_long", "비밀번호는 72자 이하로 적어 주세요.")
        return v


class UserUpdate(BaseModel):
    """프로필 수정 요청 (보낸 필드만 변경)."""

    name: str | None = Field(None, max_length=50)
    nickname: str | None = Field(None, max_length=50)
    gender: Gender | None = None
    ntrp: float | None = Field(None, ge=1.0, le=7.0)
    phone: str | None = Field(None, max_length=20)
    bio: str | None = None
    # 코트비 등을 돌려받을 계좌
    bank: str | None = Field(None, max_length=50)
    account_number: str | None = Field(None, max_length=50)
    account_holder: str | None = Field(None, max_length=50)

    @field_validator("phone")
    @classmethod
    def _phone_rule(cls, v: str | None) -> str | None:
        return clean_phone(v)

    # 성별은 필수 항목이라 바꿀 수는 있어도 비울 수는 없다 (보내지 않으면 그대로)
    @field_validator("gender")
    @classmethod
    def _gender_not_blank(cls, v: Gender | None) -> Gender:
        if v is None:
            raise PydanticCustomError("gender_required", "성별은 비워 둘 수 없어요. 남성·여성 중에 골라 주세요.")
        return v


class PasswordUpdate(BaseModel):
    """비밀번호 변경 요청 (별도 인증 없이 새 비밀번호만)."""

    new_password: str = Field(..., min_length=4, max_length=72)


class UserRead(UserBase):
    """회원 응답 (비밀번호 제외)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr | None = None
    approval_status: ApprovalStatus
    is_active: bool
    is_admin: bool
    member_type: MemberType = MemberType.MEMBER
    created_at: datetime
    # 대회 입상 별 개수 (관리자가 정한다)
    award_gold: int = 0
    award_silver: int = 0
    award_bronze: int = 0
    award_note: str | None = None


# 프로필 동그라미 위에 둘러 놓을 수 있는 별 수
AWARD_MAX_EACH = 5
AWARD_MAX_TOTAL = 9


class PhoneUpdate(BaseModel):
    """회원 전화번호 (관리자). 비우면 지운다."""

    phone: str | None = Field(None, max_length=20)

    @field_validator("phone")
    @classmethod
    def _phone_rule(cls, v: str | None) -> str | None:
        return clean_phone(v)


class AwardUpdate(BaseModel):
    """대회 입상 별 개수 (관리자): 금 우승 · 은 준우승 · 동 입상. 모두 0이면 지운다."""

    gold: int = Field(0, ge=0, le=AWARD_MAX_EACH)
    silver: int = Field(0, ge=0, le=AWARD_MAX_EACH)
    bronze: int = Field(0, ge=0, le=AWARD_MAX_EACH)
    note: str | None = Field(None, max_length=50)

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        return " ".join((v or "").split()) or None

    @model_validator(mode="after")
    def _total(self):
        if self.gold + self.silver + self.bronze > AWARD_MAX_TOTAL:
            raise PydanticCustomError("award_total", f"별은 모두 합쳐 {AWARD_MAX_TOTAL}개까지 달 수 있어요.")
        return self


class MemberTypeUpdate(BaseModel):
    """회원 구분 변경 (관리자)."""

    member_type: MemberType


class MemberDeleteResult(BaseModel):
    """회원 삭제 결과: 완전 삭제(deleted) 또는 기록 보존 탈퇴(deactivated)."""

    result: Literal["deleted", "deactivated"]
    name: str


class PurgePreview(BaseModel):
    """탈퇴 회원을 완전히 지울 때 함께 지워지거나 바뀌는 것."""

    user_id: int
    name: str
    matches: int  # 함께 지워지는 경기 기록(같이 뛴 회원의 그 경기 포함)
    participations: int  # 참석·입금 기록
    paid: int  # 그중 입금 기록
    court_bookings: int  # 코트비 지급 내역
    gatherings_created: int  # 만든 모임 → 지우는 관리자에게 넘어감
    draw_seats: int  # 대진표 자리 → 빈자리


class PurgeResult(BaseModel):
    purged: list[PurgePreview]


class UserMe(UserRead):
    """내 프로필: 다른 회원에게는 보이지 않는 환급 계좌를 포함한다."""

    bank: str | None = None
    account_number: str | None = None
    account_holder: str | None = None



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
    member_type: MemberType = MemberType.MEMBER
    avatar_url: str | None = None
    # 이름만 적어 초대한 게스트면 데려온 회원 (가입한 회원은 None)
    invited_by_id: int | None = None
    invited_by_name: str | None = None
    # 대회 입상 별 개수: 프로필 동그라미 위에 금·은·동 별
    award_gold: int = 0
    award_silver: int = 0
    award_bronze: int = 0
    award_note: str | None = None


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
# 코트 바닥 재질: 하드 · 인조잔디 · 클레이 · 카펫
CourtSurface = Literal["hard", "turf", "clay", "carpet"]


class GatheringBase(BaseModel):
    title: str = Field(..., max_length=200)
    description: str | None = None
    event_date: date
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=200, description="코트 주소(선택): 지도 버튼이 먼저 이 주소로 찾는다")
    court_count: int = Field(1, ge=1, description="코트 면 수 = 동시 진행 가능한 대진 수")
    court_numbers: str | None = Field(None, max_length=200, description="실제 코트 번호(쉼표 구분, 예: '3, 5')")
    court_surface: CourtSurface | None = Field(None, description="코트 바닥 재질(선택). 비우면 같은 장소의 재질")
    court_fairy: str | None = Field(None, max_length=200, description="코트요정(코트를 잡아 준 사람) 이름")
    court_reservers: str | None = Field(
        None, max_length=300, description="예약자명: 코트에서 말할 예약 이름 (예: '3·5번 장미주, 2번 김다빈')"
    )
    max_participants: int | None = Field(None, ge=1)
    kind: GatheringKind = Field(GatheringKind.FLASH, description="오테식 정모 / 오테식 벙개 / 일반 벙개")
    fee: int = Field(0, ge=0, description="일반 벙개: n빵할 총액. 코트비·캔볼값을 넣으면 둘의 합.")
    court_fee: int = Field(0, ge=0, description="일반 벙개 코트비")
    ball_fee: int = Field(0, ge=0, description="일반 벙개 캔볼값")
    guest_fee: int = Field(GUEST_FEE_DEFAULT, ge=0, description="오테식 모임 게스트 1인 참가비")
    bank: str | None = Field(None, max_length=50, description="입금 은행")
    account_number: str | None = Field(None, max_length=50, description="입금 계좌번호")
    account_holder: str | None = Field(None, max_length=50, description="예금주")


class CourtBookingInput(BaseModel):
    """코트 예약 1건 등록: 누가 어떤 코트를 얼마에 잡았는지."""

    booker_id: int
    amount: int = Field(..., gt=0)
    court_label: str | None = Field(None, max_length=50)


class CourtBookingUpdate(BaseModel):
    booker_id: int | None = None
    amount: int | None = Field(None, gt=0)
    court_label: str | None = Field(None, max_length=50)


class CourtBookingCancel(BaseModel):
    """코트 취소: 원래 코트비 대신 낼 취소 수수료 (0원이면 지급할 것 없음)."""

    fee: int = Field(0, ge=0, le=10_000_000)


class ReimbursementUpdate(BaseModel):
    """코트비 지급 처리. reimbursed=false면 지급 기록을 지운다."""

    reimbursed: bool


class ReimbursementBulkUpdate(BaseModel):
    """여러 코트비를 한 번에 지급 처리 (같은 코트요정에게 한 번에 보낼 때)."""

    booking_ids: list[int] = Field(..., min_length=1, max_length=200)
    reimbursed: bool = True


class BookerAccount(BaseModel):
    bank: str | None = None
    account_number: str | None = None
    account_holder: str | None = None


class CourtBookingRead(BaseModel):
    """코트 예약 1건. 예약자 계좌는 본인과 관리자·임원진에게만 채워진다."""

    id: int
    gathering_id: int
    gathering_title: str
    event_date: date
    kind: GatheringKind
    # 코트비를 받을 회원(코트요정). 엑셀로 올린 코트요정이 회원이 아니면 None 이고 이름만 있다
    booker: UserBrief | None = None
    booker_name: str
    # 회비에서 지급할 금액: 코트비, 코트를 취소했으면 취소 수수료
    amount: int
    # 원래 코트비 (코트를 취소해도 남는다)
    court_fee: int = 0
    # 코트 취소 (우천 등): 취소 수수료만 지급한다
    canceled: bool = False
    canceled_at: datetime | None = None
    cancel_fee: int = 0
    court_label: str | None = None
    reimbursed: bool
    reimbursed_at: datetime | None = None
    reimbursed_by: UserBrief | None = None
    account: BookerAccount | None = None
    # 모임이 정회원에게 공개됐는지 (전주 금요일 오전 10시). 정산 탭은 공개된 모임의 코트비만 보여 준다
    open_to_members: bool = True


class GatheringCreate(GatheringBase):
    # 오테식 모임만: 처음 등록할 때 함께 넣는 코트 예약 내역
    court_bookings: list[CourtBookingInput] = []
    # 운영진: 정해진 공개 시각(전주 금요일 오전 10시)을 기다리지 않고 바로 공개
    open_now: bool = False


class GatheringCancel(BaseModel):
    """모임 취소 (운영진·모임을 만든 사람). 사유는 꼭 적는다. 예: 우천 취소, 코트 예약 취소."""

    reason: str = Field(..., max_length=100)

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise PydanticCustomError("cancel_reason", "취소 사유를 적어 주세요.")
        return v


class GatheringCancelFee(BaseModel):
    """취소 정산 금액. 일반 벙개는 참석자끼리 나눌 총액, 오테식 모임은 게스트 1인 금액. 0이면 낼 돈 없음."""

    fee: int = Field(..., ge=0, le=10_000_000)


class GatheringOpenRange(BaseModel):
    """기간 안의 공개 전 일정을 한 번에 미리 공개 (예: 다음 주 월~일)."""

    date_from: date
    date_to: date


class GatheringOpenResult(BaseModel):
    opened: int


class GatheringImportRowError(BaseModel):
    row: int
    error: str


class GatheringImportRowNote(BaseModel):
    row: int
    message: str


class ClubAccountRead(BaseModel):
    """모임 통장 (오테식 모임 게스트비 입금 계좌)."""

    bank: str | None = None
    account_number: str
    account_holder: str | None = None


class ClubAccountUpdate(BaseModel):
    bank: str | None = Field(None, max_length=50)
    account_number: str = Field(..., min_length=1, max_length=50)
    account_holder: str | None = Field(None, max_length=50)
    apply_upcoming: bool = Field(True, description="다가오는 오테식 모임의 계좌도 바꾼다")

    @field_validator("bank", "account_number", "account_holder")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v

    @field_validator("account_number")
    @classmethod
    def _number(cls, v: str) -> str:
        if not v:
            raise PydanticCustomError("account_number", "계좌번호를 적어 주세요.")
        return v


class ClubAccountResult(BaseModel):
    account: ClubAccountRead | None
    updated: int = 0


class GatheringImportItem(BaseModel):
    """엑셀로 새로 등록된 일정 (카톡 알림 문구용)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    kind: GatheringKind
    event_date: date
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = None
    court_numbers: str | None = None
    # 한 건 등록과 같은 알림 문구를 쓰도록: 공개·게스트 투표 시각과 지금 열려 있는지
    member_open_at: datetime | None = None
    guest_vote_open_at: datetime | None = None
    open_to_members: bool = True
    guest_vote_open: bool = True


class GatheringImportResult(BaseModel):
    """엑셀 일괄 업로드 결과. 건너뛴 행(이미 등록된 일정, 모임이 아닌 사용 여부)은 skips.
    items: 이번에 새로 등록된 일정(날짜·시간 순)."""

    created: int
    failed: int
    errors: list[GatheringImportRowError]
    skipped: int = 0
    skips: list[GatheringImportRowNote] = []
    items: list[GatheringImportItem] = []
    # 등록은 됐지만 알아 둘 것 (예: 입금 계좌가 비어 있는 일반 벙개)
    notices: list[str] = []


class GatheringUpdate(BaseModel):
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    event_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=200)
    court_count: int | None = Field(None, ge=1)
    court_numbers: str | None = Field(None, max_length=200)
    court_surface: CourtSurface | None = None
    court_fairy: str | None = Field(None, max_length=200)
    court_reservers: str | None = Field(None, max_length=300)
    max_participants: int | None = Field(None, ge=1)
    kind: GatheringKind | None = None
    fee: int | None = Field(None, ge=0)
    court_fee: int | None = Field(None, ge=0)
    ball_fee: int | None = Field(None, ge=0)
    guest_fee: int | None = Field(None, ge=0)
    bank: str | None = Field(None, max_length=50)
    account_number: str | None = Field(None, max_length=50)
    account_holder: str | None = Field(None, max_length=50)
    status: GatheringStatus | None = None


class AttendanceSummary(BaseModel):
    attending: int = 0
    absent: int = 0
    maybe: int = 0  # 예전 '미정' 투표
    waiting: int = 0
    total: int = 0


class AttendeeBrief(BaseModel):
    """캘린더 목록에 보여 줄 참석자 (이름·사진만)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    avatar_url: str | None = None


class GatheringRead(GatheringBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: GatheringStatus
    created_by: int
    created_at: datetime
    attendance: AttendanceSummary | None = None
    # 1인 참가비 = 총액 ÷ 참석 인원 (100원 단위 올림, 취소된 모임은 0). 서버에서만 계산.
    # 오테식 모임은 회비에서 지출하므로 0 (게스트만 guest_fee).
    per_person: int = 0
    # 공개 시점(한국 시간): 일정은 정회원·게스트 모두 전주 금요일 오전 10시, 게스트 투표는 3일 전 0시. app/visibility.py
    member_open_at: datetime | None = None
    guest_vote_open_at: datetime | None = None
    open_to_members: bool = True
    guest_vote_open: bool = True
    # 정해진 공개 시각(전주 금요일 오전 10시)과, 운영진이 그보다 일찍 공개해 둔 상태인지
    scheduled_open_at: datetime | None = None
    opened_early: bool = False
    # 보고 있는 회원의 참석 투표 (참석·대기·불참). 투표하지 않았으면 None
    my_status: AttendanceStatus | None = None
    # 오테식 모임: 코트 예약 금액 합 (회비 지출)
    court_total: int = 0
    # 캘린더 목록: 참석자 (투표한 순서). 상세는 participants 를 쓴다
    attendees: list[AttendeeBrief] = []
    # 취소된 모임: 사유와 취소한 시각 (한국 시간)
    cancel_reason: str | None = None
    canceled_at: datetime | None = None
    # 취소 정산 금액 (일반 벙개: 나눌 총액, 오테식 모임: 게스트 1인). 0이면 낼 돈 없음
    cancel_fee: int = 0


class ParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserBrief
    status: AttendanceStatus
    voted_at: datetime
    waiting_since: datetime | None = None  # 대기 순서
    paid: bool = False
    paid_at: datetime | None = None
    fee_waived: bool = False  # 게스트비 면제
    fee_waiver_reason: str | None = None  # 면제 사유 (모임 화면에 보인다)
    paid_amount: int | None = None  # 입금 처리 당시 금액


class PaymentLine(BaseModel):
    """사람별 금액 한 줄 (받을 돈 또는 돌려줄 돈)."""

    user: UserBrief
    amount: int


class GatheringPaymentSummary(BaseModel):
    """모임 1건의 참가비 정산 요약. 금액 계산은 모두 서버에서 한다."""

    id: int
    title: str
    event_date: date
    status: GatheringStatus
    kind: GatheringKind = GatheringKind.FLASH
    fee: int              # 일반 벙개 총액(모임 전체 금액). 취소된 모임은 취소 정산 총액
    per_person: int       # 일반 벙개 1인 금액 (100원 단위 올림). 오테식 모임은 0.
    guest_fee: int = 0    # 오테식 모임 게스트 1인 참가비. 취소된 모임은 취소 정산 금액
    cancel_reason: str | None = None  # 취소된 모임의 사유
    attending: int        # 참석 인원
    payer_count: int = 0  # 낼 돈이 있는 참석자 수 (일반 벙개: 참석자 전원, 오테식: 게스트)
    paid_count: int       # 입금한 참석자 수 (낼 돈이 있는 사람 중)
    collected: int        # 실제 걷힌 금액 = 참석자의 입금 금액 합
    expected: int         # 받아야 할 금액 = 참석자별 낼 금액의 합
    outstanding: int      # 아직 받을 금액 = dues 합
    dues: list[PaymentLine] = []     # 받을 돈: 미입금(1인 금액) + 추가 입금(차액)
    refunds: list[PaymentLine] = []  # 돌려줄 돈: 입금 후 불참 + 초과 입금(차액)


class GatheringDetail(GatheringRead):
    participants: list[ParticipantRead] = []
    payment: GatheringPaymentSummary | None = None  # 받을 돈이 있는 모임만
    court_bookings: list[CourtBookingRead] = []      # 오테식 모임의 코트 예약 내역


class GuestInvite(BaseModel):
    """모임 참석자가 가입하지 않은 게스트를 이름으로 초대한다."""

    name: str = Field(..., max_length=30)
    gender: Gender | None = None

    @field_validator("name")
    @classmethod
    def _name_rule(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise PydanticCustomError("guest_name", "게스트 이름을 적어 주세요.")
        return v


class ParticipantVote(BaseModel):
    """참석/불참 투표. 정원이 찼으면 '참석'은 대기로 들어간다. (미정은 없어졌다)"""

    status: Literal["attending", "absent"]


class FeeWaiverUpdate(BaseModel):
    """게스트비 면제 (관리자·총무). 면제할 때는 사유를 꼭 적는다. waived=false 면 면제를 취소한다."""

    waived: bool
    reason: str | None = Field(None, max_length=50)

    @model_validator(mode="after")
    def _reason_required(self):
        self.reason = " ".join((self.reason or "").split()) or None
        if self.waived and not self.reason:
            raise PydanticCustomError("waiver_reason", "면제 사유를 적어 주세요.")
        return self


class PaymentUpdate(BaseModel):
    """참가비 입금 처리(주최자/관리자). paid=true면 현재 1인 금액으로 기록(차액 정산 포함)."""

    paid: bool


# --- 회비 정산 --------------------------------------------------------------
class MonthlyPaymentSummary(BaseModel):
    """한 달 회비 정산 집계 (참가비가 있는 모임만)."""

    month: str            # "YYYY-MM"
    total_expected: int
    total_collected: int
    total_outstanding: int
    total_refund: int
    gatherings: list[GatheringPaymentSummary] = []
    # 오테식 모임 코트비 (회비 지출)
    court_total: int = 0
    court_reimbursed: int = 0
    court_pending: int = 0
    court_bookings: list[CourtBookingRead] = []


class MyPaymentDue(BaseModel):
    """내가 아직 내야 할 참가비 한 건."""

    gathering_id: int
    title: str
    event_date: date
    kind: GatheringKind = GatheringKind.FLASH
    amount: int           # 낼 금액 (미입금이면 1인 금액, 일부 입금이면 차액)
    per_person: int       # 1인 금액 (오테식 모임 게스트는 게스트비)
    partial: bool         # 이미 일부 입금했고 차액만 남은 경우
    bank: str | None = None
    account_number: str | None = None
    account_holder: str | None = None


# --- 대진표 (Draw) ----------------------------------------------------------
class DrawGenerateRequest(BaseModel):
    # auto = 참석자 성별로 남복·여복·혼복을 꾸리고 어쩔 수 없을 때만 잡복
    match_type: MatchType | Literal["auto"] = "auto"
    # random = 다양하게, balanced = 실력 밸런스 (skill 은 예전 이름 → balanced 로 저장)
    method: Literal["random", "balanced", "skill"] = "random"
    # 라운드 수. 없으면 모임 시간으로 정한다(30분에 한 판, 시간이 없으면 4라운드).
    rounds: int | None = Field(None, ge=1, le=12)
    name: str | None = Field(None, max_length=100)


class DrawBalance(BaseModel):
    """관리자 전용: 두 팀 레이팅과 팀1 기대 득점률. 이미 친 경기는 경기 직전 값."""

    team1_rating: int
    team2_rating: int
    expected_team1: float
    tiers: dict[int, str]


class DrawMatchRead(BaseModel):
    id: int
    court_number: int | None = None
    round_number: int | None = None
    match_type: MatchType
    team1: list[UserBrief] = []
    team2: list[UserBrief] = []
    result_match_id: int | None = None
    team1_score: int | None = None
    team2_score: int | None = None
    balance: DrawBalance | None = None
    # 자리별 회원 id [팀1 1번, 팀1 2번, 팀2 1번, 팀2 2번] (빈자리는 null) — 직접 바꾸기 화면용
    slot_ids: list[int | None] = []


DrawSlot = Literal["team1_player1", "team1_player2", "team2_player1", "team2_player2"]


class DrawSlotChange(BaseModel):
    """대진의 한 자리에 참석자를 넣는다. 같은 라운드에 뛰는 사람이면 서로 자리를 바꾼다."""

    slot: DrawSlot
    user_id: int


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


class DrawMatchResultUpdate(BaseModel):
    """대진 결과 점수 고치기 → 승패를 다시 판정하고 전적·티어에 바로 반영된다."""

    team1_score: int = Field(..., ge=0)
    team2_score: int = Field(..., ge=0)


# --- 내부 레이팅 · 티어 (관리자 전용) ---------------------------------------
class RatingRow(BaseModel):
    user: UserBrief
    rating: int
    tier: str
    games: int
    wins: int
    losses: int
    draws: int
    provisional: bool  # 배치 경기 중
    placement_left: int
    peak: int
    last_played: date | None = None
    last_change: int  # 마지막으로 뛴 모임에서 오르내린 값


class RatingConfig(BaseModel):
    base: int
    k_placement: int
    k_regular: int
    placement_games: int
    hysteresis: int
    tier_floors: dict[str, int]


class RatingBoard(BaseModel):
    rows: list[RatingRow]
    counted_matches: int
    tier_counts: dict[str, int]
    config: RatingConfig


class RatingEventRead(BaseModel):
    match_id: int
    played_at: date
    gathering_id: int | None = None
    gathering_title: str | None = None
    partners: list[UserBrief]
    opponents: list[UserBrief]
    games_for: int
    games_against: int
    outcome: Literal["win", "loss", "draw"]
    expected: float
    actual: float
    delta: float
    rating_after: int
    tier_after: str


class RatingHistory(BaseModel):
    row: RatingRow
    events: list[RatingEventRead]  # 최근 경기부터


class NoticeCreate(BaseModel):
    kind: Literal["celebrate", "news"] = "news"
    title: str = Field(min_length=1, max_length=100)
    body: str | None = Field(default=None, max_length=1000)
    show_until: date | None = None

    @field_validator("title", "body", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("body")
    @classmethod
    def _empty_body(cls, v):
        return v or None


class NoticeRead(BaseModel):
    id: int
    kind: str
    title: str
    body: str | None
    show_until: date | None
    created_at: datetime
    author_name: str | None = None
    is_new: bool = False  # 이 회원이 아직 팝업에서 확인하지 않은 소식


# --- 대회 (청백전 · 단식·복식 토너먼트) -------------------------------------
TeamColor = Literal["blue", "white"]  # 청팀 · 백팀


def _strip_or_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class TournamentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    kind: TournamentKind
    event_date: date | None = None
    location: str | None = Field(None, max_length=200)
    note: str | None = Field(None, max_length=1000)
    # 청백전 팀별 인원 수 (비우면 랜덤 배정이 남은 사람을 반씩 나눈다)
    blue_size: int | None = Field(None, ge=1, le=100)
    white_size: int | None = Field(None, ge=1, le=100)

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("location", "note", mode="before")
    @classmethod
    def _strip_text(cls, v):
        return _strip_or_none(v)


class TournamentUpdate(BaseModel):
    """대회 정보 고치기 (보낸 칸만 바꾼다)."""

    title: str | None = Field(None, min_length=1, max_length=100)
    event_date: date | None = None
    location: str | None = Field(None, max_length=200)
    note: str | None = Field(None, max_length=1000)
    blue_size: int | None = Field(None, ge=1, le=100)
    white_size: int | None = Field(None, ge=1, le=100)
    # 청백전 최종 결과 (null 이면 다시 정하기 전으로)
    winner_team: Literal["blue", "white", "draw"] | None = None
    # 최종 결과를 정하면서 클럽 소식(회원이 들어올 때 뜨는 축하 팝업)으로도 알리기
    announce: bool = False

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("location", "note", mode="before")
    @classmethod
    def _strip_text(cls, v):
        return _strip_or_none(v)


class TournamentPlayersAdd(BaseModel):
    """참가자 넣기. 청백전은 team 을 주면 그 팀으로 바로 넣는다."""

    user_ids: list[int] = Field(min_length=1, max_length=200)
    team: TeamColor | None = None


class TournamentEntryUpdate(BaseModel):
    """청백전: 팀 옮기기(null 이면 팀 없음)와 팀장 정하기. 보낸 칸만 바꾼다."""

    team: TeamColor | None = None
    is_captain: bool | None = None


class TournamentPair(BaseModel):
    """복식 토너먼트: 짝이 없는 두 사람을 한 팀으로."""

    entry_ids: list[int] = Field(min_length=2, max_length=2)


class TournamentMatchCreate(BaseModel):
    """청백전 경기 한 판: 청팀 선수와 백팀 선수 (단식 1명씩, 복식 2명씩)."""

    blue_ids: list[int] = Field(min_length=1, max_length=2)
    white_ids: list[int] = Field(min_length=1, max_length=2)


class TournamentRandomMatches(BaseModel):
    """청백전 경기 랜덤으로 짜기: 경기를 덜 뛴 사람부터 청 대 백으로 한 판씩."""

    match_type: Literal["singles", "doubles"] = "doubles"


class TournamentScore(BaseModel):
    team1_score: int = Field(..., ge=0, le=99)
    team2_score: int = Field(..., ge=0, le=99)


class TournamentEntryRead(BaseModel):
    id: int
    players: list[UserBrief]
    team: TeamColor | None = None
    is_captain: bool = False
    random_pick: bool = False


class TournamentMatchRead(BaseModel):
    id: int
    round_number: int
    position: int
    match_type: MatchType
    entry1_id: int | None = None
    entry2_id: int | None = None
    team1: list[UserBrief] = []  # 청백전: 청팀
    team2: list[UserBrief] = []  # 청백전: 백팀
    team1_score: int | None = None
    team2_score: int | None = None
    winner: int | None = None
    recorded: bool = False
    bye: bool = False  # 토너먼트 1라운드 부전승
    can_score: bool = False  # 지금 보는 회원이 점수를 적을 수 있는지


class TeamBattleScore(BaseModel):
    blue_wins: int = 0
    white_wins: int = 0
    draws: int = 0
    blue_games: int = 0
    white_games: int = 0


class TournamentSummary(BaseModel):
    id: int
    title: str
    kind: TournamentKind
    event_date: date | None = None
    location: str | None = None
    created_at: datetime
    players: int  # 참가자 수
    played: int  # 결과가 나온 경기 (부전승 빼고)
    total: int  # 전체 경기 (부전승 빼고)
    score: TeamBattleScore | None = None  # 청백전
    winner_team: Literal["blue", "white", "draw"] | None = None  # 청백전 최종 결과 (운영진이 정한다)
    champion: list[UserBrief] | None = None  # 토너먼트 우승 (결승 결과가 나오면)


class TournamentDetail(TournamentSummary):
    note: str | None = None
    blue_size: int | None = None
    white_size: int | None = None
    created_by_name: str | None = None
    entries: list[TournamentEntryRead]
    matches: list[TournamentMatchRead]
    rounds: int = 0  # 토너먼트 라운드 수 (대진표 전 0)
    can_manage: bool = False  # 참가자·팀·대진표를 꾸릴 수 있는지 (운영진)
    captain_of: TeamColor | None = None  # 지금 보는 회원이 팀장인 팀 (청백전 경기 짜기)
    announced: bool = False  # 청백전 최종 결과를 클럽 소식으로 알렸는지
