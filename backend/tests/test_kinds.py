"""모임 종류별 정산(일반 벙개 n빵 / 오테식 모임 회비 지출), 회원 등급, 코트비 지급 테스트."""
import io

import openpyxl
from sqlalchemy import create_engine, inspect, text

from app import database


def names_amounts(lines: list[dict]) -> list[tuple[str, int]]:
    return sorted((x["user"]["name"], x["amount"]) for x in lines)


# --- 회원 구분 · 환급 계좌 -----------------------------------------------------
def test_member_type_in_member_list(club):
    club.add_members("kim", "lee")
    assert club.c.get("/users/me", headers=club.headers["kim"]).json()["member_type"] == "member"
    club.set_type("kim", "officer")
    members = club.c.get("/users", headers=club.headers["lee"]).json()
    assert {m["name"]: m["member_type"] for m in members}["kim"] == "officer"


def test_refund_account_is_private(club):
    club.add_members("kim", "lee")
    r = club.c.patch(
        "/users/me",
        json={"bank": "국민", "account_number": "111-222", "account_holder": "김"},
        headers=club.headers["kim"],
    )
    assert r.json()["account_number"] == "111-222"
    assert club.c.get("/users/me", headers=club.headers["kim"]).json()["bank"] == "국민"

    other = club.c.get(f"/users/{club.ids['kim']}", headers=club.headers["lee"]).json()
    assert "account_number" not in other and "bank" not in other


# --- 모임 종류와 생성 권한 ----------------------------------------------------
def test_only_staff_create_club_gatherings(club):
    club.add_members("kim", "off")
    club.set_type("off", "officer")

    assert club.create("kim", kind="club_regular").status_code == 403
    assert club.create("kim", kind="club_flash").status_code == 403
    assert club.create("kim", kind="flash").status_code == 201
    assert club.create("off", kind="club_regular").status_code == 201
    assert club.create(None, kind="club_flash").status_code == 201
    # 종류를 안 보내면 일반 벙개
    assert club.create("kim").json()["kind"] == "flash"


def test_flash_splits_court_and_ball(club):
    club.add_members("aaa", "bbb", "ccc", "ddd")
    g = club.create(kind="flash", court_fee=40000, ball_fee=8000).json()
    assert (g["fee"], g["court_fee"], g["ball_fee"], g["guest_fee"]) == (48000, 40000, 8000, 0)
    for n in ("aaa", "bbb", "ccc", "ddd"):
        club.vote(g["id"], n)
    assert club.detail(g["id"])["per_person"] == 12000
    assert club.my_dues("aaa")[0]["amount"] == 12000


def test_club_members_pay_nothing_guests_pay_guest_fee(club):
    club.add_members("kim", "gst")
    club.set_type("gst", "guest")
    g = club.create(kind="club_regular", fee=30000, bank="국민", account_number="999").json()
    # 오테식 모임은 n빵 금액이 없다 (게스트비 기본 5,000원)
    assert (g["fee"], g["guest_fee"], g["per_person"]) == (0, 5000, 0)
    club.vote(g["id"], "kim")
    club.vote(g["id"], "gst")

    pay = club.detail(g["id"])["payment"]
    assert (pay["payer_count"], pay["expected"], pay["per_person"]) == (1, 5000, 0)
    assert names_amounts(pay["dues"]) == [("gst", 5000)]

    assert club.my_dues("kim") == []
    due = club.my_dues("gst")
    assert (due[0]["amount"], due[0]["per_person"], due[0]["kind"]) == (5000, 5000, "club_regular")

    assert club.pay(g["id"], "kim").status_code == 400
    r = club.pay(g["id"], "gst")
    assert r.status_code == 200 and r.json()["paid_amount"] == 5000
    assert club.my_dues("gst") == []

    month = club.summary()
    assert [x["kind"] for x in month["gatherings"]] == ["club_regular"]
    assert month["total_collected"] == 5000


def test_club_without_guests_has_no_payment(club):
    club.add_members("kim")
    gid = club.create(kind="club_flash").json()["id"]
    club.vote(gid, "kim")
    assert club.detail(gid)["payment"] is None
    assert club.summary()["gatherings"] == []


def test_guest_fee_change_after_payment_creates_due(club):
    club.add_members("gst")
    club.set_type("gst", "guest")
    gid = club.create(kind="club_regular").json()["id"]
    club.vote(gid, "gst")
    club.pay(gid, "gst")
    club.c.patch(f"/gatherings/{gid}", json={"guest_fee": 7000}, headers=club.admin)
    assert names_amounts(club.detail(gid)["payment"]["dues"]) == [("gst", 2000)]


# --- 코트 예약 / 코트비 지급 ---------------------------------------------------
def test_multiple_bookers_and_reimbursement(club):
    club.add_members("off", "kim", "lee", "park")
    club.set_type("off", "officer")
    club.c.patch(
        "/users/me",
        json={"bank": "신한", "account_number": "110-1", "account_holder": "김"},
        headers=club.headers["kim"],
    )
    r = club.create(
        "off",
        kind="club_regular",
        court_bookings=[
            {"booker_id": club.ids["kim"], "amount": 30000, "court_label": "3번"},
            {"booker_id": club.ids["lee"], "amount": 20000, "court_label": "5번"},
        ],
    )
    gid = r.json()["id"]
    assert r.json()["court_total"] == 50000

    # 계좌: 임원진은 보이고, 다른 회원에게는 숨김 (본인 것은 보임)
    by_staff = club.c.get(f"/gatherings/{gid}", headers=club.headers["off"]).json()["court_bookings"]
    assert by_staff[0]["account"]["account_number"] == "110-1"
    by_park = club.c.get(f"/gatherings/{gid}", headers=club.headers["park"]).json()["court_bookings"]
    assert [b["account"] for b in by_park] == [None, None]
    by_kim = club.c.get(f"/gatherings/{gid}", headers=club.headers["kim"]).json()["court_bookings"]
    assert by_kim[0]["account"] is not None and by_kim[1]["account"] is None

    kim_booking, lee_booking = (b["id"] for b in by_staff)

    # 정회원은 지급 처리·목록 조회 불가
    assert club.c.put(
        f"/court-bookings/{kim_booking}/reimbursement", json={"reimbursed": True},
        headers=club.headers["park"],
    ).status_code == 403
    assert club.c.get("/court-bookings", headers=club.headers["park"]).status_code == 403

    # 임원진이 지급 처리
    r = club.c.put(
        f"/court-bookings/{kim_booking}/reimbursement", json={"reimbursed": True},
        headers=club.headers["off"],
    )
    assert r.status_code == 200
    assert r.json()["reimbursed"] is True and r.json()["reimbursed_by"]["name"] == "off"

    pending = club.c.get("/court-bookings", headers=club.headers["off"]).json()
    assert [b["id"] for b in pending] == [lee_booking]
    assert len(club.c.get("/court-bookings?pending=false", headers=club.admin).json()) == 2

    mine = club.c.get("/court-bookings/me", headers=club.headers["lee"]).json()
    assert [(b["amount"], b["gathering_title"]) for b in mine] == [(20000, "모임")]
    assert club.c.get("/court-bookings/me", headers=club.headers["kim"]).json() == []

    month = club.summary()
    assert (month["court_total"], month["court_reimbursed"], month["court_pending"]) == (
        50000, 30000, 20000,
    )

    # 지급한 예약은 수정·삭제 불가, 지급 취소 후 가능
    assert club.c.delete(f"/court-bookings/{kim_booking}", headers=club.admin).status_code == 400
    assert club.c.patch(
        f"/court-bookings/{kim_booking}", json={"amount": 1}, headers=club.admin
    ).status_code == 400
    club.c.put(f"/court-bookings/{kim_booking}/reimbursement", json={"reimbursed": False},
               headers=club.admin)
    assert club.c.delete(f"/court-bookings/{kim_booking}", headers=club.admin).status_code == 204


def test_add_edit_booking_permissions(club):
    club.add_members("off", "kim")
    club.set_type("off", "officer")
    gid = club.create(kind="club_flash").json()["id"]
    body = {"booker_id": club.ids["kim"], "amount": 24000}

    assert club.c.post(f"/gatherings/{gid}/court-bookings", json=body,
                       headers=club.headers["kim"]).status_code == 403
    r = club.c.post(f"/gatherings/{gid}/court-bookings", json=body, headers=club.headers["off"])
    assert r.status_code == 201
    bid = r.json()["id"]
    r = club.c.patch(f"/court-bookings/{bid}", json={"amount": 26000, "court_label": "7번"},
                     headers=club.headers["off"])
    assert (r.json()["amount"], r.json()["court_label"]) == (26000, "7번")

    # 없는 회원, 0원은 거부
    assert club.c.post(f"/gatherings/{gid}/court-bookings", json={"booker_id": 999, "amount": 1},
                       headers=club.admin).status_code == 400
    assert club.c.post(f"/gatherings/{gid}/court-bookings",
                       json={"booker_id": club.ids["kim"], "amount": 0},
                       headers=club.admin).status_code == 422


def test_bookings_only_for_club_gatherings(club):
    club.add_members("kim")
    flash = club.create(kind="flash", fee=10000).json()["id"]
    r = club.c.post(f"/gatherings/{flash}/court-bookings",
                    json={"booker_id": club.ids["kim"], "amount": 10000}, headers=club.admin)
    assert r.status_code == 400
    r = club.create(kind="flash", court_bookings=[{"booker_id": club.ids["kim"], "amount": 1}])
    assert r.status_code == 400


def test_delete_blocked_after_reimbursement(club):
    club.add_members("kim")
    gid = club.create(kind="club_regular",
                      court_bookings=[{"booker_id": club.ids["kim"], "amount": 30000}]).json()["id"]
    bid = club.detail(gid)["court_bookings"][0]["id"]
    club.c.put(f"/court-bookings/{bid}/reimbursement", json={"reimbursed": True}, headers=club.admin)
    assert club.c.delete(f"/gatherings/{gid}", headers=club.admin).status_code == 400


# --- 종류 변경 / 수정 권한 ----------------------------------------------------
def test_kind_change_blocked_by_payments_and_bookings(club):
    club.add_members("kim")
    gid = club.create(kind="flash", fee=20000).json()["id"]
    club.vote(gid, "kim")
    club.pay(gid, "kim")
    patch = lambda gid, body: club.c.patch(f"/gatherings/{gid}", json=body, headers=club.admin)

    assert patch(gid, {"kind": "club_flash"}).status_code == 400
    club.pay(gid, "kim", paid=False)
    g = patch(gid, {"kind": "club_flash"}).json()
    assert (g["kind"], g["fee"], g["guest_fee"]) == ("club_flash", 0, 5000)

    club.c.post(f"/gatherings/{gid}/court-bookings",
                json={"booker_id": club.ids["kim"], "amount": 10000}, headers=club.admin)
    assert patch(gid, {"kind": "flash"}).status_code == 400
    # 오테식 정모 ↔ 오테식 벙개는 정산 방식이 같아 그대로 바꿀 수 있다
    assert patch(gid, {"kind": "club_regular"}).status_code == 200


def test_officer_manages_club_gatherings_only(club):
    club.add_members("off", "kim", "gst")
    club.set_type("off", "officer")
    club.set_type("gst", "guest")
    club_gid = club.create(kind="club_regular").json()["id"]
    flash_gid = club.create(kind="flash", fee=10000).json()["id"]

    edit = lambda gid, who: club.c.patch(f"/gatherings/{gid}", json={"title": "수정"},
                                        headers=club.headers[who])
    assert edit(club_gid, "off").status_code == 200
    assert edit(flash_gid, "off").status_code == 403
    assert edit(club_gid, "kim").status_code == 403

    club.vote(club_gid, "gst")
    assert club.pay(club_gid, "gst", as_="off").status_code == 200

    # 정회원은 자기 일반 벙개를 오테식 모임으로 바꿀 수 없다
    own = club.create("kim", kind="flash").json()["id"]
    assert club.c.patch(f"/gatherings/{own}", json={"kind": "club_flash"},
                        headers=club.headers["kim"]).status_code == 403


# --- 엑셀 일괄 등록 ----------------------------------------------------------
def _xlsx(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def test_import_with_kind_columns(club):
    club.add_members("kim")
    header = ["날짜", "제목", "종류", "코트비", "캔볼값", "게스트비"]
    data = _xlsx([
        header,
        ["2099-01-10", "정모", "오테식 정모", None, None, 6000],
        ["2099-01-11", "벙개", "일반 벙개", 40000, 8000, None],
        ["2099-01-12", "예전 양식", None, None, None, None],
        ["2099-01-13", "오타", "번개", None, None, None],
    ])
    files = {"file": ("m.xlsx", data, "application/octet-stream")}
    r = club.c.post("/gatherings/import", files=files, headers=club.admin).json()
    assert (r["created"], r["failed"]) == (3, 1) and r["errors"][0]["row"] == 5

    listed = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31",
                        headers=club.admin).json()
    got = {g["title"]: (g["kind"], g["fee"], g["guest_fee"]) for g in listed}
    assert got["정모"] == ("club_regular", 0, 6000)
    assert got["벙개"] == ("flash", 48000, 0)
    assert got["예전 양식"][0] == "flash"

    # 정회원은 오테식 모임 행을 올릴 수 없다
    member = club.c.post("/gatherings/import", files=files, headers=club.headers["kim"]).json()
    assert member["errors"][0]["row"] == 2

    # 양식 다운로드는 새 코트 예약 시트(test_schedule_import.py). 예전 양식 파일도 계속 올릴 수 있다.


# --- 마이그레이션 -------------------------------------------------------------
def test_migration_adds_account_and_kind(tmp_path, monkeypatch):
    """기존 운영 DB: 회원은 정회원, 모임은 일반 벙개로 채워진다."""
    old = create_engine(f"sqlite:///{tmp_path}/old.db")
    with old.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50))"))
        conn.execute(text("CREATE TABLE gatherings (id INTEGER PRIMARY KEY, title VARCHAR(200))"))
        conn.execute(text("INSERT INTO users (name) VALUES ('kim')"))
        conn.execute(text("INSERT INTO gatherings (title) VALUES ('old')"))
    monkeypatch.setattr(database, "engine", old)

    database.run_lightweight_migrations()
    database.run_lightweight_migrations()  # 두 번 실행해도 안전

    assert {"member_type", "bank", "account_number", "account_holder"} <= {
        c["name"] for c in inspect(old).get_columns("users")
    }
    assert {"kind", "court_fee", "ball_fee", "guest_fee"} <= {
        c["name"] for c in inspect(old).get_columns("gatherings")
    }
    with old.connect() as conn:
        assert conn.execute(text("SELECT member_type FROM users")).scalar() == "MEMBER"
        assert conn.execute(text("SELECT kind, guest_fee FROM gatherings")).one() == ("FLASH", 0)


def test_booker_is_deactivated_not_deleted(club):
    """코트 예약 기록이 있는 회원은 삭제 대신 탈퇴 처리 → 예약·지급 내역이 남는다."""
    club.add_members("kim")
    gid = club.create(kind="club_regular",
                      court_bookings=[{"booker_id": club.ids["kim"], "amount": 10000}]).json()["id"]
    r = club.c.delete(f"/admin/users/{club.ids['kim']}", headers=club.admin)
    assert r.json()["result"] == "deactivated"
    assert [b["booker"]["name"] for b in club.detail(gid)["court_bookings"]] == ["kim"]
