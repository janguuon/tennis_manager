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
from datetime import date, datetime, time, timedelta

import openpyxl
from openpyxl.utils import get_column_letter
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import visibility
from ..database import get_db
from ..deps import get_current_user
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
    GatheringImportResult,
    GatheringImportRowError,
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

# 엑셀 헤더(한국어) → 모임 필드명 매핑
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
# 양식에 넣는 열 (예전 양식의 '참가비'는 업로드만 허용)
IMPORT_COLUMNS = [k for k in IMPORT_HEADER_MAP if k != "참가비"]
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
        else:
            s.maybe += 1
    s.total = len(gathering.participants)
    return s


def _with_open_times(read: GatheringRead, gathering: Gathering) -> GatheringRead:
    """정회원·게스트 공개 시각과 지금 열려 있는지 (임원진 화면 안내용)."""
    now = visibility.now_kst()
    read.member_open_at = visibility.member_open_at(gathering.event_date)
    read.guest_open_at = visibility.guest_open_at(gathering.event_date)
    read.open_to_members = now >= read.member_open_at
    read.open_to_guests = now >= read.guest_open_at
    return read


def _to_read(gathering: Gathering) -> GatheringRead:
    read = GatheringRead.model_validate(gathering)
    read.attendance = _summary(gathering)
    read.per_person = _per_person(gathering)
    read.court_total = sum(b.amount for b in gathering.court_bookings)
    return _with_open_times(read, gathering)


def _require_open(gathering: Gathering, user: User) -> None:
    """아직 이 회원에게 공개되지 않은 일정이면 보기·투표를 막는다."""
    if not visibility.is_open_for(user, gathering):
        opens = visibility.open_at_for(user, gathering.event_date)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"아직 공개되지 않은 일정이에요. {visibility.format_open_at(opens)}부터 보고 투표할 수 있어요.",
        )


def court_booking_read(b: CourtBooking, viewer: User) -> CourtBookingRead:
    """코트 예약 응답. 예약자 계좌는 본인과 관리자·임원진에게만 보여준다."""
    show_account = viewer.is_staff or viewer.id == b.booker_id
    return CourtBookingRead(
        id=b.id,
        gathering_id=b.gathering_id,
        gathering_title=b.gathering.title,
        event_date=b.gathering.event_date,
        kind=b.gathering.kind,
        booker=UserBrief.model_validate(b.booker),
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


def _normalize_courts(data: dict) -> None:
    """court_numbers가 주어지면 정리하고 court_count를 그 개수로 맞춘다."""
    raw = data.get("court_numbers")
    if raw:
        labels = [s.strip() for s in str(raw).split(",") if s.strip()]
        if labels:
            data["court_numbers"] = ", ".join(labels)
            data["court_count"] = len(labels)


# 모임 시작 며칠 전부터 참석 변경(불참/미정)을 잠그는지
ATTENDANCE_LOCK_DAYS = 3


def _attendance_locked(gathering: Gathering) -> bool:
    """모임 시작 ATTENDANCE_LOCK_DAYS일 전부터(당일·지난 경우 포함) 잠금."""
    return (gathering.event_date - date.today()).days <= ATTENDANCE_LOCK_DAYS


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
    for b in bookings:
        require_booker(db, b["booker_id"])
        gathering.court_bookings.append(CourtBooking(**b))
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
    """엑셀(.xlsx) 한 행 = 한 모임으로 일괄 등록. 오류 행은 건너뛰고 보고한다."""
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=".xlsx 파일만 업로드할 수 있습니다.")

    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="엑셀 파일을 읽을 수 없습니다.")

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

    created = 0
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
            gathering = Gathering(**d, created_by=current_user.id)
            _apply_kind_rules(gathering)
            db.add(gathering)
            created += 1
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
    return GatheringImportResult(created=created, failed=len(errors), errors=errors)


@router.get("/import/template")
def import_template(_: User = Depends(get_current_user)):
    """업로드용 엑셀 양식(.xlsx) 다운로드: 헤더 + 예시 1행."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "모임목록"
    ws.append(IMPORT_COLUMNS)
    # 예시: 오테식 정모(회비 지출, 게스트비) / 일반 벙개(코트비 + 캔볼값 n빵)
    ws.append([
        "2026-07-05", "토요 정모", "오테식 정모", "09:00", "12:00", "시민 테니스장", "3, 5", 12,
        None, None, 5000, "국민", "123-456-7890", "총무", "코트 예약자는 모임 화면에서 등록",
    ])
    ws.append([
        "2026-07-08", "평일 저녁 벙개", "일반 벙개", "19:00", "21:00", "시민 테니스장", "2", 6,
        40000, 8000, None, "카카오", "3333-01-2345678", "홍길동", None,
    ])
    # 계좌번호 열은 텍스트 서식으로(숫자 자동 인식·0 누락 방지)
    acct_col = get_column_letter(IMPORT_COLUMNS.index("계좌번호") + 1)
    ws.column_dimensions[acct_col].number_format = "@"
    for cell in ws[acct_col]:
        cell.number_format = "@"
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return Response(
        content=bio.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="gathering_template.xlsx"'},
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
    return [_to_read(g) for g in db.scalars(stmt).all() if visibility.is_open_for(current_user, g, now)]


@router.get("/{gathering_id}", response_model=GatheringDetail)
def get_gathering(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """모임 상세 (참여자 명단, 정산, 코트 예약 내역 포함)."""
    g = _load_gathering(db, gathering_id)
    _require_open(g, current_user)
    detail = GatheringDetail.model_validate(_to_read(g).model_dump())
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
    """현재 회원의 참석/불참/미정 투표 (없으면 생성, 있으면 갱신)."""
    gathering = db.get(Gathering, gathering_id)
    if not gathering:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    _require_open(gathering, current_user)

    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )

    # 마감 제한: 모임 3일 전부터는 일반 회원이 불참/미정으로 바꿀 수 없음(관리자만 가능)
    if (
        payload.status in (AttendanceStatus.ABSENT, AttendanceStatus.MAYBE)
        and not current_user.is_admin
        and _attendance_locked(gathering)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"모임 시작 {ATTENDANCE_LOCK_DAYS}일 전부터는 불참/미정으로 변경할 수 없습니다. 관리자에게 문의하세요.",
        )

    # 정원 제한: '참석'으로 바꾸려는데 이미 정원이 찼고, 본인이 아직 참석이 아니면 차단
    if payload.status == AttendanceStatus.ATTENDING and gathering.max_participants is not None:
        already_attending = (
            participant is not None and participant.status == AttendanceStatus.ATTENDING
        )
        if not already_attending:
            current_attending = db.scalar(
                select(func.count())
                .select_from(Participant)
                .where(
                    Participant.gathering_id == gathering_id,
                    Participant.status == AttendanceStatus.ATTENDING,
                )
            )
            if current_attending >= gathering.max_participants:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail=f"참석 정원({gathering.max_participants}명)이 가득 찼습니다.",
                )

    if participant is None:
        participant = Participant(
            gathering_id=gathering_id, user_id=current_user.id, status=payload.status
        )
        db.add(participant)
    else:
        participant.status = payload.status

    db.commit()
    db.refresh(participant)
    return ParticipantRead.model_validate(participant)


@router.delete("/{gathering_id}/attendance", status_code=status.HTTP_204_NO_CONTENT)
def cancel_attendance(
    gathering_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """투표 취소 (참여자 명단에서 제거)."""
    gathering = db.get(Gathering, gathering_id)
    if gathering is not None:
        _require_open(gathering, current_user)
    # 마감 제한: 취소(=사실상 불참)도 3일 전부터는 일반 회원 불가(관리자만 가능)
    if (
        gathering is not None
        and not current_user.is_admin
        and _attendance_locked(gathering)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"모임 시작 {ATTENDANCE_LOCK_DAYS}일 전부터는 참석 취소를 할 수 없습니다. 관리자에게 문의하세요.",
        )

    participant = db.scalar(
        select(Participant).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == current_user.id,
        )
    )
    if participant:
        db.delete(participant)
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
    참가비 입금/미입금 처리. 주최자 또는 관리자(오테식 모임은 임원진도)만 가능.

    - paid=true : 낼 돈이 있는 참석자만 가능. 현재 낼 금액을 입금 금액으로 기록한다.
                  (일반 벙개는 1인 금액, 오테식 모임은 게스트비)
                  이미 입금한 사람에게 다시 보내면 차액 정산 완료(금액을 현재 낼 금액으로 갱신).
    - paid=false: 누구든 가능(입금 취소, 환불 완료). 기록을 지운다.
    """
    gathering = _load_gathering(db, gathering_id)
    _require_organizer(gathering, current_user)

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
    current_user: User = Depends(get_current_user),
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
