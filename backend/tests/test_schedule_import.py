"""엑셀 일정 자동 등록 (코트 예약 시트): 필수 칸, 묶기, 중복 건너뛰기, 양식 다운로드."""
import io
from datetime import date, datetime, time

import openpyxl

from app import schedule_import as S

# 실제 양식의 헤더 그대로 (띄어쓰기·"(선택)" 포함)
HEADER = ["날 짜", "시 간", "코트 번호", "예약자명", "코트요정", "코트비", "캔볼비(선택)",
          "사용 여부", "최대 인원(선택)", "장소", " 비 고"]
D = datetime(2099, 1, 17)


def _sheet(rows: list[list]) -> bytes:
    """첫 시트는 빈 '시트4', 두 번째가 '템플릿' — 받은 양식과 같은 구성."""
    wb = openpyxl.Workbook()
    wb.active.title = "시트4"
    ws = wb.create_sheet("템플릿")
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _upload(club, data: bytes, as_=None) -> dict:
    files = {"file": ("schedule.xlsx", data, "application/octet-stream")}
    return club.c.post("/gatherings/import", files=files, headers=club.h(as_)).json()


def _people(club, **names):
    """username=이름 으로 가입·승인."""
    for username, name in names.items():
        club.c.post("/auth/signup", json={"gender": "male", "username": username, "password": "1234", "name": name})
    for p in club.c.get("/admin/signups/pending", headers=club.admin).json():
        club.c.post(f"/admin/signups/{p['id']}/approve", headers=club.admin)
    for username in names:
        club.headers[username] = club._login(username)
        club.ids[username] = club.c.get("/users/me", headers=club.headers[username]).json()["id"]


def _month(club, month="2099-01"):
    return club.c.get(f"/gatherings?date_from={month}-01&date_to={month}-31", headers=club.admin).json()


# --- 순수 함수 ----------------------------------------------------------------
def test_headers_and_parsers():
    assert S.is_court_sheet(tuple(HEADER))
    assert not S.is_court_sheet(("날짜", "제목", "종류"))
    cols = S.column_map(tuple(HEADER))
    assert cols["event_date"] == 0 and cols["ball_fee"] == 6 and cols["note"] == 10

    assert S.parse_time_range("10:00~12:00") == (time(10), time(12))
    assert S.parse_time_range(" 19:00 - 21:00 ") == (time(19), time(21))
    assert S.parse_time_range("9시~11시") == (time(9), time(11))
    assert S.parse_court(3) == "3" and S.parse_court(3.0) == "3"
    assert S.parse_court("3번 코트") == "3" and S.parse_court("3, 5") == "3, 5"
    assert S.parse_date("2099.1.17") == date(2099, 1, 17)
    assert S.parse_amount("24,000", "코트비", True) == 24000


def test_parse_row_cases():
    cols = S.column_map(tuple(HEADER))
    # 날짜만 미리 채워 둔 행은 빈 행
    assert S.parse_row(2, (D,), cols) is None
    # 모임이 아닌 사용 여부는 다른 칸이 비어도 건너뛴다
    skip = S.parse_row(3, (D, "10:00~12:00", None, None, None, None, None, "우천 취소"), cols)
    assert isinstance(skip, S.RowSkip) and "우천 취소" in skip.message
    # 필수 칸이 비면 어떤 칸인지 알려 주고, 어느 모임인지(key)는 남긴다
    bad = S.parse_row(4, (D, "10:00~12:00", 3, "장미주", None, 24000, None, "오테식 정모", None, "시민 테니스장"), cols)
    assert isinstance(bad, S.RowProblem) and "코트요정" in bad.message and bad.key is not None
    wrong = S.parse_row(5, (D, "아침", 3, "장미주", "서승우", "이만원", None, "오테식 정모", None, "시민"), cols)
    assert isinstance(wrong, S.RowProblem) and "시간" in wrong.message and "코트비" in wrong.message
    # 코트비 0원(무료 코트)은 된다. 비우면 0을 적으라고 안내
    free = S.parse_row(6, (D, "10:00~12:00", 3, "장미주", "서승우", 0, None, "오테식 정모", None, "시민"), cols)
    assert isinstance(free, S.SheetRow) and free.court_fee == 0
    blank = S.parse_row(7, (D, "10:00~12:00", 3, "장미주", "서승우", None, None, "오테식 정모", None, "시민"), cols)
    assert isinstance(blank, S.RowProblem) and "0을 적어" in blank.message
    minus = S.parse_row(8, (D, "10:00~12:00", 3, "장미주", "서승우", -1, None, "오테식 정모", None, "시민"), cols)
    assert isinstance(minus, S.RowProblem) and "0 이상" in minus.message


# --- API ----------------------------------------------------------------------
def test_court_sheet_import_end_to_end(club):
    # 코트요정(서승우·오장원)은 회원, 예약자명(장미주·김다빈)은 예약에 쓴 이름이라 회원이 아니어도 된다
    _people(club, seo="서승우", ohj="오장원")
    club.c.patch("/users/me", json={"bank": "카카오", "account_number": "3333-01", "account_holder": "오장원"},
                 headers=club.h("ohj"))
    rows = [
        # 2·3행: 같은 날짜·시간·장소·종류 → 3·5번 코트 정모 하나, 예약자 두 명
        [D, "10:00~12:00", 3, "장미주 ", "서승우", 24000, 4000, "오테식 정모", 16, "시민 테니스장", None],
        [D, "10:00~12:00", "5번", "김다빈", "오장원", "24,000", None, "오테식 정모", None, "시민  테니스장", "주차 2시간"],
        # 4행: 일반 벙개 → 첫 예약자가 벙주, 코트비+캔볼비 n빵
        [datetime(2099, 1, 20), "19:00~21:00", 2, "김다빈", "오장원", 20000, 6000, "일반 벙개", 8, "구립 테니스장", None],
        # 5행: 우천 취소 → 건너뜀
        [datetime(2099, 1, 24), "14:00~16:00", None, None, None, None, None, "우천 취소", None, None, None],
        # 6행: 코트요정 빠짐 → 실패
        [datetime(2099, 1, 25), "10:00~12:00", 4, "장미주", None, 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        # 7행: 가입하지 않은 코트요정·예약자명 → 적은 이름 그대로 등록
        [datetime(2099, 1, 26), "10:00~12:00", 4, "목록에없는예약자", "홍길동", 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        # 8행: 날짜만 미리 채워 둔 행 → 무시
        [D],
        # 9·10행: 같은 모임인데 10행에 코트비가 없음 → 둘 다 등록하지 않음
        [datetime(2099, 1, 27), "18:00~20:00", 1, "장미주", "서승우", 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        [datetime(2099, 1, 27), "18:00~20:00", 2, "김다빈", "서승우", None, None, "오테식 벙개", None, "시민 테니스장", None],
    ]
    r = _upload(club, _sheet(rows))
    assert r["created"] == 3
    assert r["skipped"] == 1 and r["skips"][0]["row"] == 5
    # 새로 등록된 일정 목록 (카톡 알림 문구용, 날짜 순)
    assert [(i["title"], i["event_date"], i["start_time"][:5], i["location"], i["court_numbers"]) for i in r["items"]] == [
        ("오테식 정모", "2099-01-17", "10:00", "시민 테니스장", "3, 5"),
        ("일반 벙개", "2099-01-20", "19:00", "구립 테니스장", "2"),
        ("오테식 벙개", "2099-01-26", "10:00", "시민 테니스장", "4"),
    ]
    assert [i["kind"] for i in r["items"]] == ["club_regular", "flash", "club_flash"]
    # 한 건 등록과 같은 알림 문구가 나오도록 공개·게스트 투표 시각도 같이 (모임 화면 값과 같다)
    keys = ("member_open_at", "guest_vote_open_at", "open_to_members", "guest_vote_open")
    for i in r["items"]:
        g = club.detail(i["id"])
        assert {k: i[k] for k in keys} == {k: g[k] for k in keys}
    assert r["items"][0]["open_to_members"] is True and r["items"][0]["guest_vote_open"] is False
    failed_rows = sorted(e["row"] for e in r["errors"])
    assert failed_rows == [6, 9, 10]
    assert "코트요정" in next(e for e in r["errors"] if e["row"] == 6)["error"]
    assert "같은 모임" in next(e for e in r["errors"] if e["row"] == 9)["error"]
    # 회원인지 아닌지는 따로 알리지 않는다
    assert r["notices"] == []

    listed = {g["title"]: g for g in _month(club)}
    # 회원이 아닌 코트요정(홍길동)·예약자명도 적은 그대로: 정산 내역은 이름만, 계좌 없음
    named = listed["오테식 벙개"]
    assert named["court_fairy"] == "홍길동"
    [b] = club.c.get(f"/gatherings/{named['id']}", headers=club.admin).json()["court_bookings"]
    assert (b["booker"], b["booker_name"], b["amount"], b["court_label"], b["account"]) == (
        None, "홍길동", 20000, "4번 · 예약 목록에없는예약자", None,
    )
    club_g = listed["오테식 정모"]
    assert (club_g["event_date"], club_g["start_time"][:5], club_g["end_time"][:5]) == ("2099-01-17", "10:00", "12:00")
    assert (club_g["court_numbers"], club_g["court_count"], club_g["location"]) == ("3, 5", 2, "시민 테니스장")
    assert club_g["court_fairy"] == "서승우, 오장원"
    # 예약자명은 코트와 함께 모임에 남아 회원 모두가 본다
    assert club_g["court_reservers"] == "3번 장미주, 5번 김다빈"
    assert named["court_reservers"] == "4번 목록에없는예약자"
    assert (club_g["max_participants"], club_g["guest_fee"], club_g["description"]) == (16, 5000, "주차 2시간")
    # 코트비는 코트요정 앞으로 지급 대기, 예약자명은 코트 칸에
    detail = club.c.get(f"/gatherings/{club_g['id']}", headers=club.admin).json()
    assert sorted((b["booker_name"], b["amount"], b["court_label"]) for b in detail["court_bookings"]) == [
        ("서승우", 24000, "3번 · 예약 장미주"), ("오장원", 24000, "5번 · 예약 김다빈"),
    ]

    # 일반 벙개: 코트비 + 캔볼비 n빵, 첫 코트요정이 벙주
    flash = listed["일반 벙개"]
    assert (flash["kind"], flash["court_fee"], flash["ball_fee"], flash["fee"]) == ("flash", 20000, 6000, 26000)
    assert flash["created_by"] == club.ids["ohj"]
    assert (flash["bank"], flash["account_number"]) == ("카카오", "3333-01")
    # 일반 벙개에 적은 최대 인원은 그대로, 예약자명도 남는다
    assert flash["max_participants"] == 8
    assert flash["court_reservers"] == "2번 김다빈"
    member_view = club.c.get(f"/gatherings/{club_g['id']}", headers=club.h("seo")).json()
    assert member_view["court_reservers"] == "3번 장미주, 5번 김다빈"

    # 같은 파일을 다시 올리면 이미 등록된 일정은 건너뛴다
    again = _upload(club, _sheet(rows))
    assert again["created"] == 0 and again["items"] == []
    already = [s for s in again["skips"] if "이미 등록된" in s["message"]]
    assert sorted(s["row"] for s in already) == [2, 4, 7]
    assert len(_month(club)) == 3


def test_free_court_zero_fee(club):
    """코트비 0원: 오테식 모임은 등록되지만 0원 코트는 지급 내역 없음, 일반 벙개는 캔볼비만 n빵."""
    _people(club, seo="서승우", ohj="오장원")
    rows = [
        [D, "10:00~12:00", 3, "장미주", "서승우", 0, None, "오테식 정모", None, "시민 테니스장", None],
        [D, "10:00~12:00", 5, "김다빈", "오장원", 24000, None, "오테식 정모", None, "시민 테니스장", None],
        [datetime(2099, 1, 20), "19:00~21:00", 2, "김다빈", "오장원", 0, 6000, "일반 벙개", None, "구립 테니스장", None],
        [datetime(2099, 1, 21), "19:00~21:00", 2, "김다빈", "오장원", "0원", None, "일반 벙개", None, "구립 테니스장", None],
    ]
    r = _upload(club, _sheet(rows))
    assert (r["created"], r["failed"]) == (3, 0)
    listed = {g["event_date"]: g for g in _month(club)}
    club_g = club.c.get(f"/gatherings/{listed['2099-01-17']['id']}", headers=club.admin).json()
    assert club_g["court_fairy"] == "서승우, 오장원"
    assert [(b["booker"]["name"], b["amount"]) for b in club_g["court_bookings"]] == [("오장원", 24000)]
    assert (listed["2099-01-20"]["court_fee"], listed["2099-01-20"]["fee"]) == (0, 6000)
    assert listed["2099-01-21"]["fee"] == 0  # 무료 벙개


def test_blank_capacity_defaults_to_six_per_court(club):
    """회칙 제10조: 최대 인원을 비운 오테식 모임은 코트 수 × 6명 → 다 차면 대기."""
    _people(club, seo="서승우")
    rows = [
        [D, "10:00~12:00", 3, "장미주", "서승우", 24000, None, "오테식 정모", None, "시민 테니스장", None],
        [D, "10:00~12:00", 5, "김다빈", "서승우", 24000, None, "오테식 정모", None, "시민 테니스장", None],
        # 정회원에게 이미 공개된 주(FAR_DATE)의 벙개
        [datetime(2099, 1, 15), "18:00~20:00", 1, "장미주", "서승우", 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        [datetime(2099, 1, 21), "19:00~21:00", 2, "김다빈", "서승우", 20000, None, "일반 벙개", None, "구립 테니스장", None],
    ]
    assert _upload(club, _sheet(rows))["created"] == 3
    cap = {g["title"]: g["max_participants"] for g in _month(club)}
    assert cap == {"오테식 정모": 12, "오테식 벙개": 6, "일반 벙개": None}

    # 6명이 차면 7번째는 대기
    gid = next(g["id"] for g in _month(club) if g["title"] == "오테식 벙개")
    names = ("aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg")
    club.add_members(*names)
    got = [club.vote(gid, n).json()["status"] for n in names]
    assert got == ["attending"] * 6 + ["waiting"]


def test_member_cannot_import_club_rows_and_template(club):
    _people(club, kim="김다빈")
    rows = [
        [D, "10:00~12:00", 3, "장미주", "김다빈", 24000, None, "오테식 정모", None, "시민 테니스장", None],
        [D, "19:00~21:00", 2, "장미주", "김다빈", 20000, None, "일반 벙개", None, "시민 테니스장", None],
    ]
    r = _upload(club, _sheet(rows), as_="kim")
    assert r["created"] == 1 and r["errors"][0]["row"] == 2

    # 양식 다운로드: 템플릿 시트 + 드롭다운(시간·사용 여부·예약자명·코트요정)
    content = club.c.get("/gatherings/import/template", headers=club.admin).content
    wb = openpyxl.load_workbook(io.BytesIO(content))
    assert wb.sheetnames[0] == "템플릿" and "목록" in wb.sheetnames
    ws = wb["템플릿"]
    assert [c.value for c in ws[1]] == S.TEMPLATE_HEADERS
    validations = ws.data_validations.dataValidation
    formulas = [dv.formula1 for dv in validations]
    assert any("10:00~12:00" in f for f in formulas) and any("오테식 정모" in f for f in formulas)
    # 예약자명(D) = 정해 둔 예약 이름 목록, 코트요정(E) = 회원 이름 목록 (목록에 없는 이름도 적을 수 있다)
    lists = {str(dv.sqref).split(":")[0]: dv for dv in validations}
    assert lists["D2"].formula1 == "='목록'!$A$1:$A$10" and lists["D2"].showErrorMessage is False
    assert lists["E2"].formula1.startswith("='목록'!$B$1:$B$") and lists["E2"].showErrorMessage is False
    # 날짜 칸은 날짜 검사(구글 시트 달력), 모든 검사는 2~101행(100행)
    assert any(dv.type == "date" and str(dv.sqref) == "A2:A101" for dv in validations)
    assert {str(dv.sqref).split(":")[1][1:] for dv in validations} == {"101"}
    # 미리 채운 값이 없다
    assert all(c.value is None for row in ws.iter_rows(min_row=2) for c in row)
    assert [c.value for c in wb["목록"]["A"]] == [
        "장미주", "김다빈", "이민석", "곽도언", "송승진", "서승우", "황규식", "김수현", "김응희", "안연숙",
    ]
    assert "김다빈" in [c.value for c in wb["목록"]["B"]]  # 가입한 회원
    # 받은 양식 그대로 올려도(데이터 없음) 아무것도 등록되지 않는다
    assert _upload(club, content)["created"] == 0


def test_unlisted_fairy_links_when_member_joins(club):
    """이름만 적어 둔 코트요정: 정산 탭에 이름으로 보이고, 그 이름으로 가입이 승인되면 그 회원에게 이어진다."""
    rows = [
        [D, "10:00~12:00", 3, "장미주", "새요정", 24000, None, "오테식 정모", None, "시민 테니스장", None],
        # 일반 벙개인데 회원인 코트요정이 없음 → 올린 사람이 벙주, 계좌는 비움
        [datetime(2099, 1, 20), "19:00~21:00", 2, "김다빈", "새요정", 20000, None, "일반 벙개", None, "구립 테니스장", None],
    ]
    r = _upload(club, _sheet(rows))
    # 회원 여부는 알리지 않고, 비어 있는 입금 계좌만 알려 준다
    assert r["created"] == 2
    assert r["notices"] == ["일반 벙개(1/20)는 입금 계좌가 비어 있어요. 모임 수정에서 계좌를 적어 주세요."]
    flash = next(g for g in _month(club) if g["kind"] == "flash")
    assert flash["bank"] is None and flash["court_fee"] == 20000

    unpaid = club.c.get("/court-bookings?pending=true", headers=club.admin).json()
    assert [(b["booker"], b["booker_name"]) for b in unpaid] == [(None, "새요정")]

    # 같은 이름으로 가입 → 승인되면 그 회원의 정산 내역이 된다 (계좌도 보인다)
    _people(club, fairy="새요정")
    club.c.patch("/users/me", json={"bank": "토스", "account_number": "1000-2", "account_holder": "새요정"},
                 headers=club.h("fairy"))
    [b] = club.c.get("/court-bookings?pending=true", headers=club.admin).json()
    assert b["booker"]["id"] == club.ids["fairy"] and b["booker_name"] == "새요정"
    assert b["account"]["account_number"] == "1000-2"
    assert [m["amount"] for m in club.c.get("/court-bookings/me", headers=club.h("fairy")).json()] == [24000]
    # 한 번에 지급
    r = club.c.put("/court-bookings/reimbursement", json={"booking_ids": [b["id"]]}, headers=club.admin)
    assert r.status_code == 200 and r.json()[0]["reimbursed"] is True


def test_migration_relaxes_old_court_booker(tmp_path):
    """예전 DB: court_bookings.booker_id 가 NOT NULL 이고 booker_name 이 없다 → 표를 새로 만들어도 내역은 그대로."""
    from sqlalchemy import create_engine, inspect, text

    from app.database import Base, run_lightweight_migrations

    eng = create_engine(f"sqlite:///{tmp_path}/old.db")
    Base.metadata.create_all(eng)
    with eng.begin() as conn:
        conn.execute(text("DROP TABLE court_bookings"))
        conn.execute(text(
            "CREATE TABLE court_bookings (id INTEGER PRIMARY KEY, gathering_id INTEGER NOT NULL REFERENCES gatherings(id), "
            "booker_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, court_label VARCHAR(50), "
            "reimbursed_at DATETIME, reimbursed_by INTEGER REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
        ))
        conn.execute(text("CREATE INDEX ix_court_bookings_gathering_id ON court_bookings (gathering_id)"))
        conn.execute(text("CREATE INDEX ix_court_bookings_booker_id ON court_bookings (booker_id)"))
        conn.execute(text("INSERT INTO court_bookings (id, gathering_id, booker_id, amount, court_label) VALUES (7, 1, 2, 24000, '3번')"))

    run_lightweight_migrations(eng)
    run_lightweight_migrations(eng)  # 두 번 돌려도 그대로

    cols = {c["name"]: c for c in inspect(eng).get_columns("court_bookings")}
    assert cols["booker_id"]["nullable"] and "booker_name" in cols
    assert {ix["name"] for ix in inspect(eng).get_indexes("court_bookings")} == {
        "ix_court_bookings_gathering_id", "ix_court_bookings_booker_id",
    }
    assert "court_bookings_old" not in inspect(eng).get_table_names()
    with eng.begin() as conn:
        assert conn.execute(text("SELECT id, booker_id, booker_name, amount, court_label FROM court_bookings")).all() == [
            (7, 2, None, 24000, "3번"),
        ]
        conn.execute(text("INSERT INTO court_bookings (gathering_id, booker_name, amount) VALUES (1, '새요정', 1000)"))


def test_reservers_text_groups_courts_by_name(club):
    """같은 사람이 잡은 코트는 묶고, 직접 등록·수정에서도 예약자명을 적을 수 있다."""
    from types import SimpleNamespace

    from app.routers.gatherings import _reservers_text

    rows = [SimpleNamespace(booker=b, court=c) for b, c in (("장미주", "3"), ("김다빈", "2"), ("장미주 ", "5"), ("이민석", "A코트"))]
    assert _reservers_text(rows) == "3·5번 장미주, 2번 김다빈, A코트 이민석"

    gid = club.create(kind="flash", court_reservers="3번 장미주").json()["id"]
    assert club.detail(gid)["court_reservers"] == "3번 장미주"
    r = club.c.patch(f"/gatherings/{gid}", json={"court_reservers": "3번 김수현"}, headers=club.admin)
    assert r.json()["court_reservers"] == "3번 김수현"
    r = club.c.patch(f"/gatherings/{gid}", json={"court_reservers": None}, headers=club.admin)
    assert r.json()["court_reservers"] is None
