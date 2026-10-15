"""
모임/캘린더 라우터: 모임 CRUD, 캘린더 조회, 참석 투표, 참가비 정산.

코트 면 수(court_count)는 모임 단위로 등록되며, 이후 대진 자동생성에서
한 라운드의 동시 진행 매치 수로 사용된다.

정산은 모임 종류(kind)에 따라 다르다.
- 일반 벙개: 코트비 + 캔볼값을 참석자끼리 n빵
- 오테식 정모·벙개: 회비에서 지출. 회원은 낼 돈이 없고 게스트만 게스트비를 낸다.
  코트비는 예약자(CourtBooking)에게 총무가 돌려준다 (routers/court_bookings.py).
"""
import io
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta

import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import schedule_import as sheet
from .. import visibility
from ..club_account import default_club_account, fill_club_account
from ..database import get_db
from ..deps import get_current_member, get_current_user
from ..models import (
    CLUB_KINDS,
    ApprovalStatus,
    AttendanceStatus,
    CourtBooking,
    Gathering,
    GatheringKind,
    GatheringStatus,
    Participant,
    MemberType,
    User,
)
from ..schemas import (
    GUEST_FEE_DEFAULT,
    AttendanceSummary,
    BookerAccount,
    CourtBookingRead,
    GatheringCreate,
    GatheringDetail,
    GatheringImportItem,
    GatheringImportResult,
    GatheringImportRowError,
    GatheringImportRowNote,
    GatheringPaymentSummary,
    GatheringRead,
    GatheringUpdate,
    MonthlyPaymentSummary,
    MyPaymentDue,
    ParticipantRead,
    ParticipantVote,
    PaymentLine,
    PaymentUpdate,
    UserBrief,
)

router = APIRouter(prefix="/gatherings", tags=["gatherings"])

# 예전 엑셀 양식(한 행 = 한 모임) 헤더 → 모임 필드명. 새 양식(코트 예약 시트)은 schedule_import.py
IMPORT_HEADER_MAP = {
    "날짜": "event_date",
    "제목": "title",
    "종류": "kind",
    "시작시간": "start_time",
    "종료시간": "end_time",
    "장소": "location",
    "코트번호": "court_numbers",
    "최대인원": "max_participants",
    "코트비": "court_fee",
    "캔볼값": "ball_fee",
    "게스트비": "guest_fee",
    "참가비": "fee",  # 예전 양식(총액 한 칸) 호환
    "은행": "bank",
    "계좌번호": "account_number",
    "예금주": "account_holder",
    "설명": "description",
}
# 필드명 → 한국어 헤더 (오류 메시지 표기용)
FIELD_TO_HEADER = {v: k for k, v in IMPORT_HEADER_MAP.items()}

# 엑셀 '종류' 칸 → 모임 종류 (띄어쓰기 무시, 비워 두면 일반 벙개)
KIND_LABELS = {
    "오테식정모": GatheringKind.CLUB_REGULAR,
    "정모": GatheringKind.CLUB_REGULAR,
    "오테식벙개": GatheringKind.CLUB_FLASH,
    "일반벙개": GatheringKind.FLASH,
    "벙개": GatheringKind.FLASH,
}
INT_FIELDS = ("fee", "court_fee", "ball_fee", "guest_fee")


# --- 내부 헬퍼 --------------------------------------------------------------
def _summary(gathering: Gathering) -> AttendanceSummary:
    s = AttendanceSummary()
    for p in gathering.participants:
        if p.status == AttendanceStatus.ATTENDING:
            s.attending += 1
        elif p.status == AttendanceStatus.ABSENT:
            s.absent += 1
        elif p.status == AttendanceStatus.WAITING:
            s.waiting += 1
        else:
            s.maybe += 1
    s.total = len(gathering.participants)
    return s


def _with_open_times(read: GatheringRead, gathering: Gathering) -> GatheringRead:
    """일정 공개 시각·게스트 투표 시각과 지금 열려 있는지 (안내·버튼 잠금용)."""
    now = visibility.now_kst()
    read.member_open_at = visibility.member_open_at(gathering.event_date)
    read.guest_vote_open_at = visibility.guest_vote_open_at(gathering.event_date)
    read.open_to_members = now >= read.member_open_at
    read.guest_vote_open = now >= read.guest_vote_open_at
    return read


def _to_read(gathering: Gathering) -> GatheringRead:
    read = GatheringRead.model_validate(gathering)
    read.attendance = _summary(gathering)
    read.per_person = _per_person(gathering)
    read.court_total = sum(b.amount for b in gathering.court_bookings)
    return _with_open_times(read, gathering)


def _with_my_status(read: GatheringRead, gathering: Gathering, user: User) -> GatheringRead:
    """보고 있는 회원이 이 모임에 참석·대기·불참 중 무엇을 눌렀는지 (안 눌렀으면 None)."""
    read.my_status = next((p.status for p in gathering.participants if p.user_id == user.id), None)
    return read


def _require_open(gathering: Gathering, user: User) -> None:
    """아직 이 회원에게 공개되지 않은 일정이면 보기·투표를 막는다."""
    if not visibility.is_open_for(user, gathering):
        opens = visibility.view_open_at_for(user, gathering.event_date)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"아직 공개되지 않은 일정이에요. {visibility.format_open_at(opens)}부터 보고 투표할 수 있어요.",
        )


def _require_vote_open(gathering: Gathering, user: User) -> None:
    """일정은 보이지만 아직 투표 전(게스트, 모임 3일 전 0시 전)이면 투표를 막는다."""
    if not visibility.can_vote(user, gathering):
        opens = visibility.vote_open_at_for(user, gathering.event_date)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"게스트 투표는 {visibility.format_open_at(opens)}부터 열려요. 그 전에는 정회원만 참석 투표를 할 수 있어요.",
        )


def court_booking_read(b: CourtBooking, viewer: User) -> CourtBookingRead:
    """코트 예약 응답. 예약자 계좌는 본인과 정산 담당(관리자·총무)에게만 보여준다.
    회원이 아닌 코트요정(엑셀에 적은 이름)은 계좌가 없다."""
    show_account = b.booker is not None and (viewer.can_settle or viewer.id == b.booker_id)
    return CourtBookingRead(
        id=b.id,
        gathering_id=b.gathering_id,
        gathering_title=b.gathering.title,
        event_date=b.gathering.event_date,
        kind=b.gathering.kind,
        booker=UserBrief.model_validate(b.booker) if b.booker else None,
        booker_name=b.payee_name,
        amount=b.amount,
        court_label=b.court_label,
        reimbursed=b.reimbursed_at is not None,
        reimbursed_at=b.reimbursed_at,
        reimbursed_by=UserBrief.model_validate(b.reimburser) if b.reimburser else None,
        account=BookerAccount(
            bank=b.booker.bank,
            account_number=b.booker.account_number,
            account_holder=b.booker.account_holder,
        )
        if show_account
        else None,
    )


# --- 참가비 계산 -------------------------------------------------------------
# 1인 금액 = 총액 ÷ 참석 인원을 이 단위(원)로 올림. 송금하기 쉬운 금액이 되고 총액이 모자라지 않는다.
PER_PERSON_UNIT = 100


def per_person_fee(fee: int, attendees: int) -> int:
    """총 참가비를 참석 인원으로 1/n 한 1인 금액 (PER_PERSON_UNIT 단위 올림)."""
    if fee <= 0 or attendees <= 0:
        return 0
    return -(-fee // (attendees * PER_PERSON_UNIT)) * PER_PERSON_UNIT


def _attendees(gathering: Gathering) -> list[Participant]:
    return [p for p in gathering.participants if p.status == AttendanceStatus.ATTENDING]


def _per_person(gathering: Gathering) -> int:
    """일반 벙개의 현재 1인 금액. 취소된 모임과 오테식 모임(회비 지출)은 0."""
    if gathering.status == GatheringStatus.CANCELED or gathering.is_club:
        return 0
    return per_person_fee(gathering.fee, len(_attendees(gathering)))


def _nominal_due(gathering: Gathering, p: Participant, per_person: int) -> int:
    """참석한다면 낼 금액: 일반 벙개는 1인 금액, 오테식 모임은 게스트만 게스트비."""
    if gathering.status == GatheringStatus.CANCELED:
        return 0
    if gathering.is_club:
        return gathering.guest_fee if p.user.member_type == MemberType.GUEST else 0
    return per_person


def _has_payment(gathering: Gathering) -> bool:
    """정산할 참가비가 있는지: 일반 벙개는 총액, 오테식 모임은 게스트 또는 입금 기록."""
    if not gathering.is_club:
        return gathering.fee > 0
    return any(p.paid for p in gathering.participants) or (
        gathering.guest_fee > 0
        and any(p.user.member_type == MemberType.GUEST for p in gathering.participants)
    )


def _payment_breakdown(gathering: Gathering) -> dict:
    """
    모임 1건의 사람별 정산 내역.

    - 참석자: 낼 금액보다 덜 냈으면 dues(받을 돈), 더 냈으면 refunds(돌려줄 돈)
    - 입금 후 불참/취소: 낸 금액 전부 refunds
    입금 금액이 없는 옛 기록(paid_amount 없음)은 현재 낼 금액을 낸 것으로 본다.
    """
    per_person = _per_person(gathering)
    dues: list[tuple[Participant, int]] = []
    refunds: list[tuple[Participant, int]] = []
    collected = 0
    paid_count = 0
    payer_count = 0
    expected = 0
    for p in gathering.participants:
        nominal = _nominal_due(gathering, p, per_person)
        paid = (p.paid_amount if p.paid_amount is not None else nominal) if p.paid else 0
        if p.status == AttendanceStatus.ATTENDING:
            collected += paid
            if nominal > 0:
                payer_count += 1
                expected += nominal
                paid_count += 1 if p.paid else 0
            if paid < nominal:
                dues.append((p, nominal - paid))
            elif paid > nominal:
                refunds.append((p, paid - nominal))
        elif p.paid and paid > 0:
            refunds.append((p, paid))
    return {
        "per_person": per_person,
        "attending": len(_attendees(gathering)),
        "payer_count": payer_count,
        "paid_count": paid_count,
        "collected": collected,
        "expected": expected,
        "dues": dues,
        "refunds": refunds,
    }


def _lines(items: list[tuple[Participant, int]]) -> list[PaymentLine]:
    return [PaymentLine(user=UserBrief.model_validate(p.user), amount=a) for p, a in items]


def _payment_summary(gathering: Gathering) -> GatheringPaymentSummary:
    """모임 1건의 정산 요약 (모임 상세·월별 정산에서 공통으로 사용)."""
    b = _payment_breakdown(gathering)
    return GatheringPaymentSummary(
        id=gathering.id,
        title=gathering.title,
        event_date=gathering.event_date,
        status=gathering.status,
        kind=gathering.kind,
        fee=gathering.fee,
        per_person=b["per_person"],
        guest_fee=gathering.guest_fee,
        attending=b["attending"],
        payer_count=b["payer_count"],
        paid_count=b["paid_count"],
        collected=b["collected"],
        expected=b["expected"],
        outstanding=sum(a for _, a in b["dues"]),
        dues=_lines(b["dues"]),
        refunds=_lines(b["refunds"]),
    )


def gathering_load_options():
    """모임 조회 시 함께 읽을 관계: 참석자, 코트 예약(예약자·지급 처리자)."""
    return (
        selectinload(Gathering.participants).selectinload(Participant.user),
        selectinload(Gathering.court_bookings).selectinload(CourtBooking.booker),
        selectinload(Gathering.court_bookings).selectinload(CourtBooking.reimburser),
    )


def _load_gathering(db: Session, gathering_id: int) -> Gathering:
    g = db.scalar(
        select(Gathering).where(Gathering.id == gathering_id).options(*gathering_load_options())
    )
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    return g


def _require_organizer(gathering: Gathering, user: User) -> None:
    """주최자·관리자만. 오테식 모임은 클럽 일정이라 임원진도 관리할 수 있다."""
    if gathering.created_by == user.id or user.is_admin:
        return
    if gathering.is_club and user.is_staff:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="모임 주최자 또는 관리자만 가능합니다.")


def _require_club_creator(kind: GatheringKind, user: User) -> None:
    if kind in CLUB_KINDS and not user.is_staff:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="오테식 정모·벙개는 관리자와 임원진만 만들 수 있습니다.",
        )


def require_booker(db: Session, user_id: int) -> User:
    """코트 예약자는 승인된 활성 회원이어야 한다."""
    user = db.get(User, user_id)
    if not user or not user.is_active or user.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="코트 예약자를 찾을 수 없습니다.")
    return user


def court_fairy_text(names: list[str]) -> str | None:
    """코트요정 표시: 코트비를 받을 사람 이름(겹치면 한 번) — 예: "서승우, 김하린"."""
    return ", ".join(dict.fromkeys(names))[:200] or None


def sync_court_fairy(db: Session, gathering_id: int) -> None:
    """오테식 모임의 코트요정 칸을 코트비 지급 내역(예약자)에 맞춘다. 바뀐 내역을 flush 한 뒤 부른다."""
    g = db.scalar(
        select(Gathering)
        .where(Gathering.id == gathering_id)
        .options(*gathering_load_options())
        .execution_options(populate_existing=True)  # 이미 읽어 둔 예약 목록도 새로
    )
    if g is not None and g.is_club:
        g.court_fairy = court_fairy_text([b.payee_name for b in g.court_bookings])


def _apply_kind_rules(g: Gathering) -> None:
    """
    종류별 금액 정리.
    - 일반 벙개: 코트비·캔볼값을 입력했으면 n빵 총액 = 코트비 + 캔볼값. 게스트비는 없음.
    - 오테식 모임: 회비에서 지출하므로 n빵 금액이 없다(코트비는 예약 내역으로 관리).
    """
    if g.is_club:
        g.fee = 0
        g.court_fee = 0
        g.ball_fee = 0
    else:
        g.guest_fee = 0
        if g.court_fee or g.ball_fee:
            g.fee = g.court_fee + g.ball_fee


def _fill_club_account(db: Session, g: Gathering) -> None:
    """오테식 모임인데 입금 계좌가 비어 있으면 모임 통장으로 채운다."""
    if g.is_club and not g.account_number:
        fill_club_account(g, default_club_account(db))


def _normalize_courts(data: dict) -> None:
    """court_numbers가 주어지면 정리하고 court_count를 그 개수로 맞춘다."""
    raw = data.get("court_numbers")
    if raw:
        labels = [s.strip() for s in str(raw).split(",") if s.strip()]
        if labels:
            data["court_numbers"] = ", ".join(labels)
            data["court_count"] = len(labels)


# 모임 시작 며칠 전부터 참석 → 불참 변경을 잠그는지
ATTENDANCE_LOCK_DAYS = 3


def _attendance_locked(gathering: Gathering) -> bool:
    """모임 시작 ATTENDANCE_LOCK_DAYS일 전부터(당일·지난 경우 포함) 잠금."""
    return (gathering.event_date - date.today()).days <= ATTENDANCE_LOCK_DAYS


# --- 참석 대기열 ---------------------------------------------------------------
def _attending_count(db: Session, gathering_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Participant)
        .where(
            Participant.gathering_id == gathering_id,
            Participant.status == AttendanceStatus.ATTENDING,
        )
    )


def promote_waiting(db: Session, gathering: Gathering) -> list[Participant]:
    """정원에 자리가 나면 대기 순서(waiting_since)대로 참석으로 올린다. 정원이 없으면 모두."""
    db.flush()
    waiting = db.scalars(
        select(Participant)
        .where(
            Participant.gathering_id == gathering.id,
            Participant.status == AttendanceStatus.WAITING,
        )
        .order_by(Participant.waiting_since, Participant.id)
    ).all()
    if not waiting:
        return []
    if gathering.max_participants is None:
        free = len(waiting)
    else:
        free = max(gathering.max_participants - _attending_count(db, gathering.id), 0)
    promoted = list(waiting[:free])
    for p in promoted:
        p.status = AttendanceStatus.ATTENDING
        p.waiting_since = None
    return promoted


def _set_attendance(db: Session, gathering: Gathering, participant: Participant | None, user_id: int, want: str) -> Participant:
    """참석 신청(정원이 찼으면 대기) 또는 불참. 참석자가 빠지면 대기자를 올린다."""
    if participant is None:
        participant = Participant(gathering_id=gathering.id, user_id=user_id, status=AttendanceStatus.ABSENT)
        db.add(participant)
    was = participant.status
    if want == "attending":
        if was in (AttendanceStatus.ATTENDING, AttendanceStatus.WAITING):
            return participant  # 이미 참석이거나 대기 중(순서 유지)
        promote_waiting(db, gathering)  # 먼저 온 대기자가 있으면 그 사람들이 우선
        has_waiting = db.scalar(
            select(func.count())
            .select_from(Participant)
            .where(Participant.gathering_id == gathering.id, Participant.status == AttendanceStatus.WAITING)
        )
        full = (
            gathering.max_participants is not None
            and _attending_count(db, gathering.id) >= gathering.max_participants
        )
        if full or has_waiting:
            participant.status = AttendanceStatus.WAITING
            participant.waiting_since = datetime.now()
        else:
            participant.status = AttendanceStatus.ATTENDING
            participant.waiting_since = None
    else:
        participant.status = AttendanceStatus.ABSENT
        participant.waiting_since = None
        if was == AttendanceStatus.ATTENDING:
            promote_waiting(db, gathering)
    return participant


def waiting_rank(db: Session, participant: Participant) -> int | None:
    """대기 몇 번째인지 (1부터)."""
    if participant.status != AttendanceStatus.WAITING:
        return None
    ahead = db.scalars(
        select(Participant)
        .where(
            Participant.gathering_id == participant.gathering_id,
            Participant.status == AttendanceStatus.WAITING,
        )
        .order_by(Participant.waiting_since, Participant.id)
    ).all()
    return next((i for i, p in enumerate(ahead, start=1) if p.id == participant.id), None)


# --- 모임 CRUD --------------------------------------------------------------
@router.post("", response_model=GatheringRead, status_code=status.HTTP_201_CREATED)
def create_gathering(
    payload: GatheringCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """모임 생성 (캘린더에 일정 등록). 오테식 정모·벙개는 관리자·임원진만."""
    data = payload.model_dump()
    bookings = data.pop("court_bookings")
    _require_club_creator(data["kind"], current_user)
    if bookings and data["kind"] not in CLUB_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="코트 예약 내역은 오테식 정모·벙개에만 등록할 수 있습니다.",
        )
    _normalize_courts(data)
    gathering = Gathering(**data, created_by=current_user.id)
    _apply_kind_rules(gathering)
    _fill_club_account(db, gathering)
    fairies = []
    for b in bookings:
        fairies.append(require_booker(db, b["booker_id"]).name)
        gathering.court_bookings.append(CourtBooking(**b))
    if fairies:
        # 오테식 모임의 코트요정 = 코트비를 받을 회원
        gathering.court_fairy = court_fairy_text(fairies)
    db.add(gathering)
    db.commit()
    return _to_read(_load_gathering(db, gathering.id))


# --- 엑셀 일괄 업로드 -------------------------------------------------------
def _cell_value(field: str, value) -> str | int:
    """엑셀 셀 값을 GatheringCreate가 받을 수 있는 형태로 정규화."""
    if field == "event_date":
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        return str(value).strip()
    if field in ("start_time", "end_time"):
        if isinstance(value, datetime):
            return value.strftime("%H:%M")
        if isinstance(value, time):
            return value.strftime("%H:%M")
        return str(value).strip()
    if field == "max_participants":
        return int(value)
    if field in INT_FIELDS:
        # "5,000" 같은 콤마 표기나 5000.0 float 도 허용
        return int(float(str(value).replace(",", "").strip()))
    if field == "kind":
        key = str(value).replace(" ", "").strip()
        if key in KIND_LABELS:
            return KIND_LABELS[key].value
        if key in {k.value for k in GatheringKind}:
            return key
        raise ValueError("종류: 오테식 정모 / 오테식 벙개 / 일반 벙개 중 하나로 적어 주세요.")
    if field == "account_number":
        # 엑셀이 계좌번호를 숫자로 인식(예: 1234567890.0)해도 정수 문자열로 보정
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value).strip()
    # title, location, court_numbers, bank, account_holder, description
    return str(value).strip()


@router.post("/import", response_model=GatheringImportResult)
async def import_gatherings(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """엑셀(.xlsx)로 일정을 한꺼번에 등록한다. 오류 행은 건너뛰고 보고한다.

    - 코트 예약 시트(새 양식, schedule_import.py): 한 행 = 코트 한 면 예약. 같은 날짜·시간·장소·종류는
      한 모임으로 묶고, 이미 등록된 일정은 건너뛴다.
    - 예전 양식: 한 행 = 한 모임.
    """
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=".xlsx 파일만 업로드할 수 있습니다.")

    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="엑셀 파일을 읽을 수 없습니다.")

    # 코트 예약 시트(새 양식)가 있는 시트를 먼저 찾는다 — 첫 시트가 빈 시트일 수 있다
    for candidate in wb.worksheets:
        first = next(candidate.iter_rows(max_row=1, values_only=True), None)
        if first and sheet.is_court_sheet(first):
            rows = candidate.iter_rows(values_only=True)
            header = next(rows)
            return _import_court_sheet(db, header, rows, current_user)

    # 예전 양식: 한 행 = 한 모임 (제목·종류·시작시간… 열)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    try:
        header = next(rows)
    except StopIteration:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="빈 파일입니다.")

    # 헤더명 → 열 인덱스 (알 수 없는 컬럼은 무시)
    col_to_field: dict[int, str] = {}
    for idx, name in enumerate(header):
        key = str(name).strip() if name is not None else ""
        if key in IMPORT_HEADER_MAP:
            col_to_field[idx] = IMPORT_HEADER_MAP[key]

    made: list[Gathering] = []
    errors: list[GatheringImportRowError] = []

    for i, row in enumerate(rows, start=2):  # 2행부터 데이터
        if all(c is None or str(c).strip() == "" for c in row):
            continue  # 완전 빈 행 skip
        try:
            data: dict = {}
            for idx, field in col_to_field.items():
                value = row[idx] if idx < len(row) else None
                if value is None or str(value).strip() == "":
                    continue
                data[field] = _cell_value(field, value)
            payload = GatheringCreate(**data)  # pydantic 검증/타입 변환 재사용
            if payload.kind in CLUB_KINDS and not current_user.is_staff:
                raise ValueError("오테식 정모·벙개는 관리자와 임원진만 등록할 수 있습니다.")
            d = payload.model_dump(exclude={"court_bookings"})
            _normalize_courts(d)
            if payload.kind in CLUB_KINDS and d.get("max_participants") is None:
                d["max_participants"] = d["court_count"] * sheet.SEATS_PER_COURT  # 회칙 제10조
            gathering = Gathering(**d, created_by=current_user.id)
            _apply_kind_rules(gathering)
            _fill_club_account(db, gathering)
            db.add(gathering)
            made.append(gathering)
        except ValidationError as ve:
            parts = []
            for err in ve.errors():
                loc = err["loc"][0] if err["loc"] else ""
                label = FIELD_TO_HEADER.get(str(loc), str(loc))
                parts.append(f"{label}: {err['msg']}")
            errors.append(GatheringImportRowError(row=i, error="; ".join(parts)))
        except Exception as e:
            errors.append(GatheringImportRowError(row=i, error=str(e)))

    db.commit()
    return GatheringImportResult(
        created=len(made), failed=len(errors), errors=errors, items=_import_items(made)
    )


def _import_items(made: list[Gathering]) -> list[GatheringImportItem]:
    """새로 등록한 일정을 날짜·시간 순으로 (카톡 알림 문구용)."""
    made.sort(key=lambda g: (g.event_date, g.start_time or time.min, g.id))
    return [GatheringImportItem.model_validate(g) for g in made]


@router.get("/import/template")
def import_template(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """일정 자동 등록 양식(.xlsx): 코트 예약 시트.
    예약자명은 예약에 쓰는 이름 목록, 코트요정은 회원 이름 목록에서 고른다(목록에 없는 이름도 적을 수 있다)."""
    names = sorted(
        {
            u.name.strip()
            for u in db.scalars(
                select(User).where(
                    User.is_active.is_(True), User.approval_status == ApprovalStatus.APPROVED
                )
            )
        }
    )
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "템플릿"
    ws.append(sheet.TEMPLATE_HEADERS)
    required = {"날짜", "시간", "코트 번호", "예약자명", "코트요정", "코트비", "사용 여부", "장소"}
    for cell in ws[1]:
        cell.font = Font(bold=True)
        if cell.value in required:
            cell.fill = PatternFill("solid", fgColor="F5CD52")
    widths = [12, 13, 10, 11, 11, 10, 12, 22, 14, 18, 28]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    last = sheet.TEMPLATE_ROWS + 1  # 2행부터 100행
    for r in range(2, last + 1):
        ws.cell(r, 1).number_format = "yyyy-mm-dd"
        ws.cell(r, 6).number_format = "#,##0"
        ws.cell(r, 7).number_format = "#,##0"
    ws.freeze_panes = "A2"

    # 목록에서 고르되, 목록에 없는 값도 적을 수 있게(오류창 끔)
    def dropdown(formula: str, col: str) -> None:
        dv = DataValidation(type="list", formula1=formula, allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        dv.add(f"{col}2:{col}{last}")

    # 날짜: 날짜만 받게 해서 구글 시트에서는 칸을 두 번 누르면 달력이 뜬다
    dates = DataValidation(
        type="date",
        operator="between",
        formula1=str(sheet.DATE_MIN_SERIAL),
        formula2=str(sheet.DATE_MAX_SERIAL),
        allow_blank=True,
        showErrorMessage=True,
        errorTitle="날짜",
        error="날짜를 2026-10-17 처럼 적거나 달력에서 골라 주세요.",
    )
    ws.add_data_validation(dates)
    dates.add(f"A2:A{last}")
    dropdown('"' + ",".join(sheet.TIME_SLOTS) + '"', "B")
    dropdown('"' + ",".join(sheet.USAGE_OPTIONS) + '"', "H")
    # 드롭다운 목록은 숨긴 시트에: A열 예약자명, B열 코트요정(회원 이름)
    lists = wb.create_sheet("목록")
    lists.sheet_state = "hidden"
    for i, n in enumerate(sheet.BOOKER_NAMES, start=1):
        lists.cell(i, 1, n)
    for i, n in enumerate(names, start=1):
        lists.cell(i, 2, n)
    dropdown(f"='목록'!$A$1:$A${len(sheet.BOOKER_NAMES)}", "D")
    if names:
        dropdown(f"='목록'!$B$1:$B${len(names)}", "E")

    guide = wb.create_sheet("작성 안내")
    guide.append(sheet.TEMPLATE_HEADERS)
    for cell in guide[1]:
        cell.font = Font(bold=True)
    guide.append(["2026-10-17", "10:00~12:00", 3, "장미주", "김요정", 24000, None, "오테식 정모", None, "시민 테니스장", None])
    guide.append(["2026-10-17", "10:00~12:00", 5, "김다빈", "박요정", 24000, None, "오테식 정모", None, "시민 테니스장", None])
    guide.append(["2026-10-21", "19:00~21:00", 2, "장미주", "박요정", 20000, 6000, "일반 벙개", 8, "구립 테니스장", "야간 조명"])
    guide.append(["2026-10-24", "14:00~16:00", 4, "김다빈", "김요정", 20000, None, "우천 취소", None, "시민 테니스장", None])
    guide.append([])
    for line in (
        "· 노란 칸(날짜·시간·코트 번호·예약자명·코트요정·코트비·사용 여부·장소)을 모두 채운 행만 등록돼요.",
        "· 날짜 칸은 날짜만 받아요. 구글 시트에서는 칸을 두 번 누르면 달력이 떠요.",
        "· 한 행에 코트 한 면씩 적어요. 날짜·시간·장소·사용 여부가 같은 행은 한 모임으로 묶여요(위 예시 1·2행 → 3·5번 코트 정모 하나).",
        "· 사용 여부가 오테식 정모 / 오테식 벙개 / 일반 벙개인 행만 일정이 되고, 예약대기·우천 취소·개인 사용 등은 건너뛰어요.",
        "· 이미 같은 날짜·시간·장소·종류로 등록된 일정은 다시 올려도 건너뛰어요.",
        f"· 최대 인원을 비우면 오테식 모임은 코트 수 × {sheet.SEATS_PER_COURT}명(회칙 제10조)으로 정해져요(위 예시 정모 → 12명).",
        "  정원이 차면 다음 신청자는 대기로 들어가요. 일반 벙개는 비우면 인원 제한이 없어요.",
        "· 예약자명·코트요정은 목록에서 고르거나 직접 적어요. 적은 이름 그대로 들어가요.",
        "· 오테식 모임의 코트비는 총무가 코트요정에게 정산하므로 '지급할 코트비'에 코트요정 앞으로 올라가요",
        "  (예약자명은 '3번 · 예약 장미주'처럼 코트 칸에 남아요).",
        "· 일반 벙개는 참석자끼리 코트비+캔볼비를 n빵해요. 첫 번째 코트요정이 벙주가 되고 그 환급 계좌가 입금 계좌로 들어가요.",
        "· 오테식 모임의 캔볼비는 회비에서 나가므로 반영하지 않아요. 게스트비는 5,000원으로 들어가요.",
        "· 이 '작성 안내' 시트는 올려도 읽지 않아요. '템플릿' 시트에 적어 주세요.",
    ):
        guide.append([line])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return Response(
        content=bio.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="schedule_template.xlsx"'},
    )


def _court_label(court: str) -> str:
    return f"{court}번" if court.isdigit() else court


def _reservers_text(rows: list[sheet.SheetRow]) -> str | None:
    """예약자명을 코트와 함께: 같은 사람이 잡은 코트는 묶는다 — "3·5번 장미주, 2번 김다빈"."""
    courts_by: dict[str, list[str]] = {}
    for r in rows:
        courts_by.setdefault(" ".join(r.booker.split()), []).extend(r.court.split(", "))
    parts = []
    for name, courts in courts_by.items():
        where = "·".join(courts) + "번" if all(c.isdigit() for c in courts) else ", ".join(map(_court_label, courts))
        parts.append(f"{where} {name}")
    return ", ".join(parts)[:300] or None


def _import_court_sheet(db: Session, header: tuple, rows, current_user: User) -> GatheringImportResult:
    """코트 예약 시트를 모임으로 등록한다 (schedule_import.py 의 규칙)."""
    cols = sheet.column_map(header)
    missing = [sheet.LABEL[f] for f in sheet.REQUIRED if f not in cols]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"양식에 이 열이 없어요: {', '.join(missing)}"
        )

    errors: list[GatheringImportRowError] = []
    skips: list[GatheringImportRowNote] = []
    blocked: set[tuple] = set()
    good: list[sheet.SheetRow] = []
    for i, values in enumerate(rows, start=2):
        parsed = sheet.parse_row(i, values, cols)
        if parsed is None:
            continue
        if isinstance(parsed, sheet.RowSkip):
            skips.append(GatheringImportRowNote(row=parsed.row, message=parsed.message))
        elif isinstance(parsed, sheet.RowProblem):
            errors.append(GatheringImportRowError(row=parsed.row, error=parsed.message))
            if parsed.key is not None:
                blocked.add(parsed.key)
        else:
            good.append(parsed)

    # 코트요정 이름 → 회원 (승인된 활동 회원, 이름이 없으면 닉네임).
    # 코트비는 총무가 코트요정에게 정산하므로 지급 내역의 받는 사람은 코트요정이다.
    # 회원에서 찾지 못하면(가입 전이거나 같은 이름이 여럿) 적은 이름 그대로 남긴다.
    members = db.scalars(
        select(User).where(User.is_active.is_(True), User.approval_status == ApprovalStatus.APPROVED)
    ).all()
    by_name: dict[str, list[User]] = defaultdict(list)
    by_nick: dict[str, list[User]] = defaultdict(list)
    for u in members:
        by_name[" ".join(u.name.split())].append(u)
        if u.nickname:
            by_nick[" ".join(u.nickname.split())].append(u)

    def find_member(name: str) -> User | None:
        found = by_name.get(" ".join(name.split())) or by_nick.get(" ".join(name.split())) or []
        return found[0] if len(found) == 1 else None

    no_account: list[str] = []  # 입금 계좌가 비어 있는 일반 벙개 (모임 수정에서 채운다)

    # 오테식 모임 입금 계좌: 모임 통장 (없으면 가장 최근 오테식 모임의 계좌)
    club_account = default_club_account(db)

    made: list[Gathering] = []
    for group in sheet.group_rows(good):
        first = group.first
        if first.key in blocked:
            errors.append(
                GatheringImportRowError(
                    row=first.row,
                    error=f"{group.row_text}: 같은 모임으로 묶이는 다른 행에 오류가 있어 함께 등록하지 않았어요",
                )
            )
            continue
        problems: list[str] = []
        club = first.kind in CLUB_KINDS
        if club and not current_user.is_staff:
            problems.append("오테식 정모·벙개는 관리자와 임원진만 등록할 수 있어요")
        dup = [c for c, n in Counter(group.courts).items() if n > 1]
        if dup:
            problems.append(f"같은 코트({', '.join(_court_label(c) for c in dup)})가 두 번 적혀 있어요")
        fairies = [find_member(r.fairy) for r in group.rows]
        if problems:
            errors.append(GatheringImportRowError(row=first.row, error=f"{group.row_text}: " + " · ".join(problems)))
            continue

        location = " ".join(first.location.split())
        same = [
            g
            for g in db.scalars(
                select(Gathering).where(
                    Gathering.event_date == first.event_date,
                    Gathering.start_time == first.start,
                    Gathering.end_time == first.end,
                    Gathering.kind == first.kind,
                )
            )
            if " ".join((g.location or "").split()) == location
        ]
        if same:
            skips.append(
                GatheringImportRowNote(
                    row=first.row,
                    message=f"{group.row_text}: 이미 등록된 일정이라 건너뛰었어요 ({same[0].title}, 코트 {same[0].court_numbers or '-'})",
                )
            )
            continue

        gathering = Gathering(
            title=sheet.KIND_TITLE[first.kind],
            kind=first.kind,
            event_date=first.event_date,
            start_time=first.start,
            end_time=first.end,
            location=location,
            court_numbers=", ".join(group.courts),
            court_count=len(group.courts),
            court_fairy=", ".join(group.fairies)[:200],
            court_reservers=_reservers_text(group.rows),
            max_participants=next((r.max_participants for r in group.rows if r.max_participants), None)
            or (len(group.courts) * sheet.SEATS_PER_COURT if club else None),
            description="\n".join(group.notes) or None,
            created_by=current_user.id,
        )
        if club:
            gathering.guest_fee = GUEST_FEE_DEFAULT
            fill_club_account(gathering, club_account)
            # 코트 한 면마다 코트요정에게 줄 코트비. 예약자명(예약에 쓴 이름)은 코트 칸에 남긴다.
            # 회원이 아닌 코트요정은 이름만 남긴다(정산 탭에 이름으로, 가입 승인 때 그 회원에게 이어짐)
            for r, fairy in zip(group.rows, fairies):
                label = f"{_court_label(r.court)} · 예약 {r.booker}"[:50]
                gathering.court_bookings.append(
                    CourtBooking(
                        booker_id=fairy.id if fairy else None,
                        booker_name=None if fairy else r.fairy[:50],
                        amount=r.court_fee,
                        court_label=label,
                    )
                )
        else:
            # 일반 벙개: 참석자끼리 코트비+캔볼비 n빵. 회원인 첫 코트요정이 벙주(환급 계좌가 있으면 그 계좌).
            # 회원인 코트요정이 없으면 올린 사람이 벙주이고 계좌는 비워 둔다(모임 수정에서 채운다)
            gathering.court_fee = sum(r.court_fee for r in group.rows)
            gathering.ball_fee = sum(r.ball_fee for r in group.rows)
            host = next((f for f in fairies if f), None)
            if host:
                gathering.created_by = host.id
                gathering.bank = host.bank
                gathering.account_number = host.account_number
                gathering.account_holder = host.account_holder
            if not gathering.account_number:
                no_account.append(f"{first.event_date.month}/{first.event_date.day}")
        _apply_kind_rules(gathering)
        db.add(gathering)
        made.append(gathering)

    db.commit()
    notices = (
        [f"일반 벙개({', '.join(no_account)})는 입금 계좌가 비어 있어요. 모임 수정에서 계좌를 적어 주세요."]
        if no_account
        else []
    )
    return GatheringImportResult(
        created=len(made),
        failed=len(errors),
        errors=errors,
        skipped=len(skips),
        skips=skips,
        items=_import_items(made),
        notices=notices,
    )


@router.get("", response_model=list[GatheringRead])
def list_gatherings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    date_from: date | None = Query(None, description="캘린더 조회 시작일"),
    date_to: date | None = Query(None, description="캘린더 조회 종료일"),
):
    """캘린더 조회: 기간으로 모임 목록을 가져온다(참석 요약 포함)."""
    stmt = select(Gathering).options(*gathering_load_options())
    if date_from is not None:
        stmt = stmt.where(Gathering.event_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Gathering.event_date <= date_to)
    stmt = stmt.order_by(Gathering.event_date, Gathering.start_time)

    now = visibility.now_kst()
    return [
        _with_my_status(_to_read(g), g, current_user)
        for g in db.scalars(stmt).all()
        if visibility.is_open_for(current_user, g, now)
    ]


@router.get("/{gathering_id}", response_model=GatheringDetail)
def get_gathering(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """모임 상세 (참여자 명단, 정산, 코트 예약 내역 포함)."""
    g = _load_gathering(db, gathering_id)
    _require_open(g, current_user)
    detail = GatheringDetail.model_validate(_with_my_status(_to_read(g), g, current_user).model_dump())
    detail.participants = [ParticipantRead.model_validate(p) for p in g.participants]
    detail.payment = _payment_summary(g) if _has_payment(g) else None
    detail.court_bookings = [court_booking_read(b, current_user) for b in g.court_bookings]
    return detail


@router.patch("/{gathering_id}", response_model=GatheringRead)
def update_gathering(
    gathering_id: int,
    payload: GatheringUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    _require_organizer(g, current_user)
    data = payload.model_dump(exclude_unset=True)
    # 비울 수 없는 칸은 null이면 무시
    for key in ("kind", "fee", "court_fee", "ball_fee", "guest_fee"):
        if key in data and data[key] is None:
            del data[key]

    new_kind = data.get("kind")
    if new_kind is not None and new_kind != g.kind:
        _require_club_creator(new_kind, current_user)
        # 일반 벙개 ↔ 오테식 모임은 정산 방식이 달라 정리할 기록이 없을 때만 바꾼다
        if (new_kind in CLUB_KINDS) != g.is_club:
            if any(p.paid for p in g.participants):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="입금 기록이 있는 모임은 종류를 바꿀 수 없습니다. 입금 기록을 먼저 정리해 주세요.",
                )
            if g.court_bookings:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="코트 예약 내역이 있는 모임은 종류를 바꿀 수 없습니다. 예약 내역을 먼저 지워 주세요.",
                )
            if new_kind in CLUB_KINDS:
                data.setdefault("guest_fee", GUEST_FEE_DEFAULT)

    _normalize_courts(data)
    for field_name, value in data.items():
        setattr(g, field_name, value)
    _apply_kind_rules(g)
    _fill_club_account(db, g)  # 오테식 모임으로 바꿨거나 계좌를 비우면 모임 통장
    if "max_participants" in data:
        promote_waiting(db, g)  # 정원을 늘리거나 없애면 대기자가 올라간다
    db.commit()
    return _to_read(_load_gathering(db, gathering_id))


@router.delete("/{gathering_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gathering(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    _require_organizer(g, current_user)
    if any(b.reimbursed_at for b in g.court_bookings):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="코트비를 지급한 모임은 삭제할 수 없습니다. 모임을 취소 상태로 바꿔 주세요.",
        )
    db.delete(g)
    db.commit()


# --- 참석 투표 --------------------------------------------------------------
@router.get("/{gathering_id}/participants", response_model=list[ParticipantRead])
def list_participants(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    g = _load_gathering(db, gathering_id)
    _require_open(g, current_user)
    return [ParticipantRead.model_validate(p) for p in g.participants]


@router.put("/{gathering_id}/attendance", response_model=ParticipantRead)
def vote_attendance(
    gathering_id: int,
    payload: ParticipantVote,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """참석/불참 투표. 정원이 찼으면 참석 신청은 대기(waiting)로 들어가고, 자리가 나면 순서대로 참석이 된다."""
    gathering = db.get(Gathering, gathering_id)
    if not gathering:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    _require_open(gathering, current_user)
    _require_vote_open(gathering, current_user)

    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )

    # 마감 제한: 모임 3일 전부터는 참석자가 불참으로 바꿀 수 없음(운영진에게 요청). 대기 취소는 언제든.
    # 관리자·임원진·총무는 회원 참석도 취소해 주므로 본인 것도 막지 않는다.
    if (
        payload.status == "absent"
        and participant is not None
        and participant.status == AttendanceStatus.ATTENDING
        and not current_user.is_staff
        and _attendance_locked(gathering)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"모임 시작 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참으로 변경할 수 없습니다. 운영진에게 문의하세요.",
        )

    participant = _set_attendance(db, gathering, participant, current_user.id, payload.status)
    db.commit()
    db.refresh(participant)
    return ParticipantRead.model_validate(participant)


@router.put("/{gathering_id}/participants/{user_id}/attendance", response_model=ParticipantRead)
def set_member_attendance(
    gathering_id: int,
    user_id: int,
    payload: ParticipantVote,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """운영진이 회원의 참석을 바꾼다(3일 전 마감 뒤 참석 취소 요청 처리 등). 불참이 되면 대기자가 올라간다.
    관리자·임원진·총무는 모든 모임에서, 그 밖에는 모임을 만든 사람(벙주)만."""
    gathering = db.get(Gathering, gathering_id)
    if not gathering:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    if not current_user.is_staff:
        _require_organizer(gathering, current_user)
    participant = db.scalar(
        select(Participant).where(Participant.gathering_id == gathering_id, Participant.user_id == user_id)
    )
    if participant is None and payload.status == "absent":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="참석 투표한 회원이 아닙니다.")
    if participant is None and not db.get(User, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    participant = _set_attendance(db, gathering, participant, user_id, payload.status)
    db.commit()
    db.refresh(participant)
    return ParticipantRead.model_validate(participant)


@router.delete("/{gathering_id}/attendance", status_code=status.HTTP_204_NO_CONTENT)
def cancel_attendance(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """투표 취소 (참여자 명단에서 제거). 참석자가 빠지면 대기자가 올라간다."""
    gathering = db.get(Gathering, gathering_id)
    if gathering is not None:
        _require_open(gathering, current_user)
    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )
    if participant is None:
        return
    was_attending = participant.status == AttendanceStatus.ATTENDING
    # 마감 제한: 참석 취소(=사실상 불참)는 3일 전부터 일반 회원 불가(운영진은 가능). 대기 취소는 언제든.
    if was_attending and not current_user.is_staff and _attendance_locked(gathering):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"모임 시작 {ATTENDANCE_LOCK_DAYS}일 전부터는 참석 취소를 할 수 없습니다. 운영진에게 문의하세요.",
        )
    db.delete(participant)
    if was_attending:
        promote_waiting(db, gathering)
    db.commit()


# --- 회비 / 참가비 정산 -----------------------------------------------------
@router.put(
    "/{gathering_id}/participants/{user_id}/payment", response_model=ParticipantRead
)
def set_payment(
    gathering_id: int,
    user_id: int,
    payload: PaymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    참가비 입금/미입금 처리. 정산 담당(관리자·총무)만. 일반 벙개는 그 모임을 만든 벙주도 가능.

    - paid=true : 낼 돈이 있는 참석자만 가능. 현재 낼 금액을 입금 금액으로 기록한다.
                  (일반 벙개는 1인 금액, 오테식 모임은 게스트비)
                  이미 입금한 사람에게 다시 보내면 차액 정산 완료(금액을 현재 낼 금액으로 갱신).
    - paid=false: 누구든 가능(입금 취소, 환불 완료). 기록을 지운다.
    """
    gathering = _load_gathering(db, gathering_id)
    if not (current_user.can_settle or (not gathering.is_club and gathering.created_by == current_user.id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="입금 처리는 관리자와 총무만 할 수 있어요. (일반 벙개는 만든 사람도 가능)",
        )

    participant = next((p for p in gathering.participants if p.user_id == user_id), None)
    if participant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="참여자를 찾을 수 없습니다.")

    if payload.paid:
        if participant.status != AttendanceStatus.ATTENDING:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="참석자만 입금 처리할 수 있습니다.")
        due = _nominal_due(gathering, participant, _per_person(gathering))
        if due <= 0:
            detail = (
                "오테식 모임은 회비에서 지출해 게스트만 참가비를 냅니다."
                if gathering.is_club
                else "받을 참가비가 없는 모임입니다."
            )
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=detail)
        participant.paid = True
        participant.paid_amount = due
        participant.paid_at = datetime.now()
    else:
        participant.paid = False
        participant.paid_amount = None
        participant.paid_at = None

    db.commit()
    db.refresh(participant)
    return ParticipantRead.model_validate(participant)


@router.get("/payments/me", response_model=list[MyPaymentDue])
def my_payment_dues(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내가 아직 내야 할 참가비 목록(참석한 모임 중 미입금·추가 입금). 날짜순."""
    stmt = (
        select(Gathering)
        .join(Participant, Participant.gathering_id == Gathering.id)
        .where(
            Participant.user_id == current_user.id,
            Participant.status == AttendanceStatus.ATTENDING,
            or_(Gathering.fee > 0, Gathering.kind.in_(CLUB_KINDS)),
            Gathering.status != GatheringStatus.CANCELED,
        )
        .options(selectinload(Gathering.participants).selectinload(Participant.user))
        .order_by(Gathering.event_date, Gathering.start_time)
    )
    result: list[MyPaymentDue] = []
    for g in db.scalars(stmt).all():
        b = _payment_breakdown(g)
        for p, amount in b["dues"]:
            if p.user_id == current_user.id:
                result.append(
                    MyPaymentDue(
                        gathering_id=g.id,
                        title=g.title,
                        event_date=g.event_date,
                        kind=g.kind,
                        amount=amount,
                        per_person=_nominal_due(g, p, b["per_person"]),
                        partial=p.paid,
                        bank=g.bank,
                        account_number=g.account_number,
                        account_holder=g.account_holder,
                    )
                )
    return result


@router.get("/payments/summary", response_model=MonthlyPaymentSummary)
def payment_summary(
    month: str = Query(..., description="정산할 달 (YYYY-MM)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """
    한 달 정산 집계.
    - 참가비: 받을 돈이 있는 모임만, 받을 돈·돌려줄 돈을 사람별로
    - 회비 지출: 오테식 모임 코트비 (예약자별 지급 여부)
    """
    try:
        year, mon = (int(x) for x in month.split("-"))
        first = date(year, mon, 1)
        nxt = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
        last = nxt - timedelta(days=1)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="month는 YYYY-MM 형식이어야 합니다.")

    stmt = (
        select(Gathering)
        .where(
            Gathering.event_date >= first,
            Gathering.event_date <= last,
            # 무료 일반 벙개는 정산 대상 아님
            or_(Gathering.fee > 0, Gathering.kind.in_(CLUB_KINDS)),
        )
        .options(*gathering_load_options())
        .order_by(Gathering.event_date, Gathering.start_time)
    )

    summaries: list[GatheringPaymentSummary] = []
    now = visibility.now_kst()
    bookings: list[CourtBookingRead] = []
    for g in db.scalars(stmt).all():
        if not visibility.is_open_for(current_user, g, now):
            continue
        bookings.extend(court_booking_read(b, current_user) for b in g.court_bookings)
        if not _has_payment(g):
            continue
        s = _payment_summary(g)
        # 취소된 모임은 돌려줄 돈이 있을 때만 표시
        if g.status == GatheringStatus.CANCELED and not s.refunds:
            continue
        summaries.append(s)

    court_total = sum(b.amount for b in bookings)
    court_reimbursed = sum(b.amount for b in bookings if b.reimbursed)
    return MonthlyPaymentSummary(
        month=month,
        total_expected=sum(s.expected for s in summaries),
        total_collected=sum(s.collected for s in summaries),
        total_outstanding=sum(s.outstanding for s in summaries),
        total_refund=sum(r.amount for s in summaries for r in s.refunds),
        gatherings=summaries,
        court_total=court_total,
        court_reimbursed=court_reimbursed,
        court_pending=court_total - court_reimbursed,
        court_bookings=bookings,
    )
