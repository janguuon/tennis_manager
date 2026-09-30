"""회비(참가비) 정산 테스트."""
import pytest
from sqlalchemy import create_engine, inspect, text, update

from app import database
from app.models import Participant
from app.routers.gatherings import per_person_fee


def names_amounts(lines: list[dict]) -> list[tuple[str, int]]:
    return sorted((x["user"]["name"], x["amount"]) for x in lines)


# --- 1인 금액 ---------------------------------------------------------------
@pytest.mark.parametrize(
    "fee,attendees,expected",
    [
        (40000, 4, 10000),  # 나누어 떨어짐
        (40000, 3, 13400),  # 13,333.3원 → 100원 단위 올림
        (45001, 2, 22600),  # 22,500.5원 → 올림 (반올림 규칙 차이로 화면마다 달라지던 문제 없음)
        (100, 3, 100),
        (0, 5, 0),  # 무료 모임
        (40000, 0, 0),  # 참석자 없음
    ],
)
def test_per_person_fee(fee, attendees, expected):
    assert per_person_fee(fee, attendees) == expected


def test_per_person_in_gathering_responses(club):
    club.add_members("kim", "lee", "park")
    gid = club.gathering(40000)
    for n in ("kim", "lee", "park"):
        club.vote(gid, n)

    assert club.detail(gid)["per_person"] == 13400
    listed = club.c.get(
        "/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.admin
    ).json()
    assert listed[0]["per_person"] == 13400


# --- 입금 처리 ---------------------------------------------------------------
def test_payment_records_amount(club):
    club.add_members("kim", "lee", "park")
    gid = club.gathering(40000)
    for n in ("kim", "lee", "park"):
        club.vote(gid, n)

    r = club.pay(gid, "kim")
    assert r.status_code == 200
    assert r.json()["paid_amount"] == 13400

    g = club.summary()["gatherings"][0]
    assert (g["collected"], g["expected"], g["outstanding"]) == (13400, 40200, 26800)
    assert names_amounts(g["dues"]) == [("lee", 13400), ("park", 13400)]
    assert g["refunds"] == []


def test_unpaid_clears_record(club):
    club.add_members("kim")
    gid = club.gathering(10000)
    club.vote(gid, "kim")
    club.pay(gid, "kim")

    r = club.pay(gid, "kim", paid=False).json()
    assert (r["paid"], r["paid_amount"], r["paid_at"]) == (False, None, None)


def test_only_attendees_can_be_marked_paid(club):
    club.add_members("kim", "lee")
    gid = club.gathering(20000)
    club.vote(gid, "kim")
    club.vote(gid, "lee", "absent")

    r = club.pay(gid, "lee")
    assert r.status_code == 400
    assert "참석자만" in r.json()["detail"]


def test_free_gathering_cannot_be_paid(club):
    club.add_members("kim")
    gid = club.gathering(0)
    club.vote(gid, "kim")
    assert club.pay(gid, "kim").status_code == 400


def test_member_cannot_mark_payment(club):
    club.add_members("kim", "lee")
    gid = club.gathering(20000)
    club.vote(gid, "kim")
    club.vote(gid, "lee")
    assert club.pay(gid, "kim", as_="lee").status_code == 403


# --- 참석 인원이 바뀐 경우 ---------------------------------------------------
def test_attendance_grows_after_payment(club):
    """입금 후 참석자가 늘면 1인 금액이 줄고, 먼저 낸 사람은 차액 환불 대상."""
    club.add_members("amy", "ben", "cho", "dan", "eve")
    gid = club.gathering(40000)
    for n in ("amy", "ben", "cho", "dan"):
        club.vote(gid, n)
    club.pay(gid, "amy")  # 4명일 때 10,000원
    club.vote(gid, "eve")  # 5명 → 8,000원

    g = club.summary()["gatherings"][0]
    assert g["per_person"] == 8000
    assert g["collected"] == 10000  # 실제로 받은 돈 그대로
    assert names_amounts(g["refunds"]) == [("amy", 2000)]

    # 차액 정산 완료: 다시 입금 처리하면 현재 1인 금액으로 기록
    club.pay(gid, "amy")
    g = club.summary()["gatherings"][0]
    assert g["refunds"] == [] and g["collected"] == 8000


def test_attendance_shrinks_after_payment(club):
    """입금 후 참석자가 줄면 먼저 낸 사람은 차액을 더 내야 한다."""
    club.add_members("amy", "ben", "cho", "dan")
    gid = club.gathering(40000)
    for n in ("amy", "ben", "cho", "dan"):
        club.vote(gid, n)
    club.pay(gid, "amy")  # 10,000원
    club.vote(gid, "dan", "absent")  # 3명 → 13,400원

    g = club.summary()["gatherings"][0]
    assert names_amounts(g["dues"]) == [("amy", 3400), ("ben", 13400), ("cho", 13400)]
    mine = club.my_dues("amy")
    assert [(m["amount"], m["partial"]) for m in mine] == [(3400, True)]


def test_paid_then_absent_becomes_refund(club):
    club.add_members("kim", "lee", "park")
    gid = club.gathering(30000)
    for n in ("kim", "lee", "park"):
        club.vote(gid, n)
    club.pay(gid, "kim")  # 10,000원
    club.vote(gid, "kim", "absent")  # 2명 → 15,000원

    g = club.summary()["gatherings"][0]
    assert g["collected"] == 0
    assert names_amounts(g["refunds"]) == [("kim", 10000)]

    # 환불 완료 처리 (불참자는 미입금으로만 바꿀 수 있음)
    assert club.pay(gid, "kim", paid=False).status_code == 200
    assert club.summary()["gatherings"][0]["refunds"] == []


def test_legacy_paid_without_amount(club):
    """금액 기록 이전의 입금(paid_amount 없음)은 현재 1인 금액을 낸 것으로 본다."""
    club.add_members("kim", "lee")
    gid = club.gathering(20000)
    club.vote(gid, "kim")
    club.vote(gid, "lee")
    with database.SessionLocal() as db:
        db.execute(
            update(Participant)
            .where(Participant.gathering_id == gid, Participant.user_id == club.ids["kim"])
            .values(paid=True, paid_amount=None)
        )
        db.commit()

    g = club.summary()["gatherings"][0]
    assert g["collected"] == 10000 and g["refunds"] == []
    assert names_amounts(g["dues"]) == [("lee", 10000)]


# --- 정산 요약 / 내 참가비 ----------------------------------------------------
def test_free_gathering_not_in_summary(club):
    club.add_members("kim")
    gid = club.gathering(0)
    club.vote(gid, "kim")

    assert club.summary()["gatherings"] == []
    assert club.my_dues("kim") == []
    assert club.detail(gid)["payment"] is None


def test_detail_payment_matches_monthly_summary(club):
    """모임 상세와 월별 정산이 같은 계산 결과를 보여준다."""
    club.add_members("kim", "lee", "park")
    gid = club.gathering(40000)
    for n in ("kim", "lee", "park"):
        club.vote(gid, n)
    club.pay(gid, "kim")

    assert club.detail(gid)["payment"] == club.summary()["gatherings"][0]


def test_canceled_gathering(club):
    """취소된 모임: 받을 돈은 없고, 이미 낸 돈은 환불 대상."""
    club.add_members("kim", "lee")
    gid = club.gathering(20000)
    club.vote(gid, "kim")
    club.vote(gid, "lee")
    club.pay(gid, "kim")
    club.c.patch(f"/gatherings/{gid}", json={"status": "canceled"}, headers=club.admin)

    assert club.detail(gid)["per_person"] == 0
    assert club.my_dues("lee") == []
    g = club.summary()["gatherings"][0]
    assert g["dues"] == []
    assert names_amounts(g["refunds"]) == [("kim", 10000)]

    # 환불까지 끝나면 정산 목록에서 빠진다
    club.pay(gid, "kim", paid=False)
    assert club.summary()["gatherings"] == []


def test_monthly_totals(club):
    club.add_members("kim", "lee")
    g1 = club.gathering(20000, date="2099-01-10")
    g2 = club.gathering(9000, date="2099-01-20")
    club.gathering(5000, date="2099-02-01")  # 다른 달
    for gid in (g1, g2):
        club.vote(gid, "kim")
        club.vote(gid, "lee")
    club.pay(g1, "kim")

    s = club.summary()
    assert [g["id"] for g in s["gatherings"]] == [g1, g2]
    assert s["total_expected"] == 20000 + 9000
    assert s["total_collected"] == 10000
    assert s["total_outstanding"] == 10000 + 9000
    assert s["total_refund"] == 0


def test_my_dues_include_account_and_clear_after_payment(club):
    club.add_members("kim", "lee")
    gid = club.gathering(20000, bank="국민", account_number="123-456", account_holder="총무")
    club.vote(gid, "kim")
    club.vote(gid, "lee")

    assert club.my_dues("kim") == [
        {
            "gathering_id": gid,
            "title": "모임",
            "event_date": "2099-01-15",
            "amount": 10000,
            "per_person": 10000,
            "partial": False,
            "bank": "국민",
            "account_number": "123-456",
            "account_holder": "총무",
        }
    ]
    club.pay(gid, "kim")
    assert club.my_dues("kim") == []


def test_invalid_month(club):
    r = club.c.get("/gatherings/payments/summary?month=2099-13", headers=club.admin)
    assert r.status_code == 400


# --- 마이그레이션 -------------------------------------------------------------
def test_migration_adds_payment_columns(tmp_path, monkeypatch):
    """기존 운영 DB(정산 컬럼 없음)에 시작 시 컬럼이 추가된다."""
    old = create_engine(f"sqlite:///{tmp_path}/old.db")
    with old.begin() as conn:
        conn.execute(text("CREATE TABLE gatherings (id INTEGER PRIMARY KEY, title VARCHAR(200))"))
        conn.execute(
            text("CREATE TABLE participants (id INTEGER PRIMARY KEY, gathering_id INTEGER, user_id INTEGER)")
        )
    monkeypatch.setattr(database, "engine", old)

    database.run_lightweight_migrations()
    database.run_lightweight_migrations()  # 두 번 실행해도 안전

    assert {"fee", "bank", "account_number", "account_holder"} <= {
        c["name"] for c in inspect(old).get_columns("gatherings")
    }
    assert {"paid", "paid_at", "paid_amount"} <= {
        c["name"] for c in inspect(old).get_columns("participants")
    }
