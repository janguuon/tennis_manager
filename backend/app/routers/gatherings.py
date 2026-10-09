"""
모임/캘린더 라우터: 모임 CRUD, 캘린더 조회, 참석 투표.

코트 면 수(court_count)는 모임 단위로 등록되며, 이후 대진 자동생성에서
한 라운드의 동시 진행 매치 수로 사용된다.
"""
import io
from datetime import date, datetime, time, timedelta

import openpyxl
from openpyxl.utils import get_column_letter
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import visibility
from ..database import get_db
from ..deps import get_current_user
from ..models import AttendanceStatus, Gathering, GatheringStatus, Participant, User
from ..schemas import (
    AttendanceSummary,
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
    "시작시간": "start_time",
    "종료시간": "end_time",
    "장소": "location",
    "코트번호": "court_numbers",
    "최대인원": "max_participants",
    "참가비": "fee",
    "은행": "bank",
    "계좌번호": "account_number",
    "예금주": "account_holder",
    "설명": "description",
}
IMPORT_COLUMNS = list(IMPORT_HEADER_MAP.keys())
# 필드명 → 한국어 헤더 (오류 메시지 표기용)
FIELD_TO_HEADER = {v: k for k, v in IMPORT_HEADER_MAP.items()}


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
    return _with_open_times(read, gathering)


def _require_open(gathering: Gathering, user: User) -> None:
    """아직 이 회원에게 공개되지 않은 일정이면 보기·투표를 막는다."""
    if not visibility.is_open_for(user, gathering):
        opens = visibility.open_at_for(user, gathering.event_date)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"아직 공개되지 않은 일정이에요. {visibility.format_open_at(opens)}부터 보고 투표할 수 있어요.",
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
    """모임의 현재 1인 금액. 취소된 모임은 받을 돈이 없으므로 0."""
    if gathering.status == GatheringStatus.CANCELED:
        return 0
    return per_person_fee(gathering.fee, len(_attendees(gathering)))


def _payment_breakdown(gathering: Gathering) -> dict:
    """
    모임 1건의 사람별 정산 내역.

    - 참석자: 1인 금액보다 덜 냈으면 dues(받을 돈), 더 냈으면 refunds(돌려줄 돈)
    - 입금 후 불참/취소: 낸 금액 전부 refunds
    입금 금액이 없는 옛 기록(paid_amount 없음)은 현재 1인 금액을 낸 것으로 본다.
    """
    per_person = _per_person(gathering)
    dues: list[tuple[Participant, int]] = []
    refunds: list[tuple[Participant, int]] = []
    collected = 0
    paid_count = 0
    for p in gathering.participants:
        paid = (p.paid_amount if p.paid_amount is not None else per_person) if p.paid else 0
        if p.status == AttendanceStatus.ATTENDING:
            collected += paid
            paid_count += 1 if p.paid else 0
            if paid < per_person:
                dues.append((p, per_person - paid))
            elif paid > per_person:
                refunds.append((p, paid - per_person))
        elif p.paid and paid > 0:
            refunds.append((p, paid))
    return {
        "per_person": per_person,
        "attending": len(_attendees(gathering)),
        "paid_count": paid_count,
        "collected": collected,
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
        fee=gathering.fee,
        per_person=b["per_person"],
        attending=b["attending"],
        paid_count=b["paid_count"],
        collected=b["collected"],
        expected=b["per_person"] * b["attending"],
        outstanding=sum(a for _, a in b["dues"]),
        dues=_lines(b["dues"]),
        refunds=_lines(b["refunds"]),
    )


def _load_gathering(db: Session, gathering_id: int) -> Gathering:
    g = db.scalar(
        select(Gathering)
        .where(Gathering.id == gathering_id)
        .options(selectinload(Gathering.participants).selectinload(Participant.user))
    )
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    return g


def _require_organizer(gathering: Gathering, user: User) -> None:
    if gathering.created_by != user.id and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="모임 주최자 또는 관리자만 가능합니다.")


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
    """모임 생성 (캘린더에 일정 등록)."""
    data = payload.model_dump()
    _normalize_courts(data)
    gathering = Gathering(**data, created_by=current_user.id)
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
    if field == "fee":
        # "5,000" 같은 콤마 표기나 5000.0 float 도 허용
        return int(float(str(value).replace(",", "").strip()))
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
            d = payload.model_dump()
            _normalize_courts(d)
            db.add(Gathering(**d, created_by=current_user.id))
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
    ws.append([
        "2026-07-05", "정기 모임", "09:00", "12:00", "시민 테니스장", "3, 5", 16,
        5000, "국민", "123-456-7890", "홍길동", "비고 예시",
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
    stmt = select(Gathering).options(
        selectinload(Gathering.participants).selectinload(Participant.user)
    )
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
    """모임 상세 (참여자 명단 포함)."""
    g = _load_gathering(db, gathering_id)
    _require_open(g, current_user)
    detail = GatheringDetail.model_validate(g)
    detail.attendance = _summary(g)
    detail.per_person = _per_person(g)
    detail.participants = [ParticipantRead.model_validate(p) for p in g.participants]
    detail.payment = _payment_summary(g) if g.fee > 0 else None
    _with_open_times(detail, g)
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
    _normalize_courts(data)
    for field_name, value in data.items():
        setattr(g, field_name, value)
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
    참가비 입금/미입금 처리. 주최자 또는 관리자만 가능.

    - paid=true : 참석자만 가능. 현재 1인 금액을 입금 금액으로 기록한다.
                  이미 입금한 사람에게 다시 보내면 차액 정산 완료(금액을 현재 1인 금액으로 갱신).
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
        per_person = _per_person(gathering)
        if per_person <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="받을 참가비가 없는 모임입니다.")
        participant.paid = True
        participant.paid_amount = per_person
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
            Gathering.fee > 0,
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
                        amount=amount,
                        per_person=b["per_person"],
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
    """한 달 모임들의 참가비 정산 집계. 참가비가 있는 모임만, 받을 돈·돌려줄 돈을 사람별로."""
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
            Gathering.fee > 0,  # 무료 모임은 정산 대상 아님
        )
        .options(selectinload(Gathering.participants).selectinload(Participant.user))
        .order_by(Gathering.event_date, Gathering.start_time)
    )

    summaries: list[GatheringPaymentSummary] = []
    now = visibility.now_kst()
    for g in db.scalars(stmt).all():
        if not visibility.is_open_for(current_user, g, now):
            continue
        s = _payment_summary(g)
        # 취소된 모임은 돌려줄 돈이 있을 때만 표시
        if g.status == GatheringStatus.CANCELED and not s.refunds:
            continue
        summaries.append(s)

    return MonthlyPaymentSummary(
        month=month,
        total_expected=sum(s.expected for s in summaries),
        total_collected=sum(s.collected for s in summaries),
        total_outstanding=sum(s.outstanding for s in summaries),
        total_refund=sum(r.amount for s in summaries for r in s.refunds),
        gatherings=summaries,
    )
