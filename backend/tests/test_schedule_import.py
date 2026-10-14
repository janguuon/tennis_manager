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
        club.c.post("/auth/signup", json={"username": username, "password": "1234", "name": name})
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
        # 7행: 가입하지 않은 코트요정 → 실패
        [datetime(2099, 1, 26), "10:00~12:00", 4, "장미주", "홍길동", 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        # 8행: 날짜만 미리 채워 둔 행 → 무시
        [D],
        # 9·10행: 같은 모임인데 10행에 코트비가 없음 → 둘 다 등록하지 않음
        [datetime(2099, 1, 27), "18:00~20:00", 1, "장미주", "서승우", 20000, None, "오테식 벙개", None, "시민 테니스장", None],
        [datetime(2099, 1, 27), "18:00~20:00", 2, "김다빈", "서승우", None, None, "오테식 벙개", None, "시민 테니스장", None],
    ]
    r = _upload(club, _sheet(rows))
    assert r["created"] == 2
    assert r["skipped"] == 1 and r["skips"][0]["row"] == 5
    # 새로 등록된 일정 목록 (카톡 알림 문구용, 날짜 순)
    assert [(i["title"], i["event_date"], i["start_time"][:5], i["location"], i["court_numbers"]) for i in r["items"]] == [
        ("오테식 정모", "2099-01-17", "10:00", "시민 테니스장", "3, 5"),
        ("일반 벙개", "2099-01-20", "19:00", "구립 테니스장", "2"),
    ]
    assert [i["kind"] for i in r["items"]] == ["club_regular", "flash"]
    failed_rows = sorted(e["row"] for e in r["errors"])
    assert failed_rows == [6, 7, 9, 10]
    assert "코트요정" in next(e for e in r["errors"] if e["row"] == 6)["error"]
    assert "홍길동" in next(e for e in r["errors"] if e["row"] == 7)["error"]
    assert "같은 모임" in next(e for e in r["errors"] if e["row"] == 9)["error"]

    listed = {g["title"]: g for g in _month(club)}
    club_g = listed["오테식 정모"]
    assert (club_g["event_date"], club_g["start_time"][:5], club_g["end_time"][:5]) == ("2099-01-17", "10:00", "12:00")
    assert (club_g["court_numbers"], club_g["court_count"], club_g["location"]) == ("3, 5", 2, "시민 테니스장")
    assert club_g["court_fairy"] == "서승우, 오장원"
    assert (club_g["max_participants"], club_g["guest_fee"], club_g["description"]) == (16, 5000, "주차 2시간")
    # 코트비는 코트요정 앞으로 지급 대기, 예약자명은 코트 칸에
    detail = club.c.get(f"/gatherings/{club_g['id']}", headers=club.admin).json()
    assert sorted((b["booker"]["name"], b["amount"], b["court_label"]) for b in detail["court_bookings"]) == [
        ("서승우", 24000, "3번 · 예약 장미주"), ("오장원", 24000, "5번 · 예약 김다빈"),
    ]

    # 일반 벙개: 코트비 + 캔볼비 n빵, 첫 코트요정이 벙주
    flash = listed["일반 벙개"]
    assert (flash["kind"], flash["court_fee"], flash["ball_fee"], flash["fee"]) == ("flash", 20000, 6000, 26000)
    assert flash["created_by"] == club.ids["ohj"]
    assert (flash["bank"], flash["account_number"]) == ("카카오", "3333-01")
    # 일반 벙개에 적은 최대 인원은 그대로
    assert flash["max_participants"] == 8

    # 같은 파일을 다시 올리면 이미 등록된 일정은 건너뛴다
    again = _upload(club, _sheet(rows))
    assert again["created"] == 0 and again["items"] == []
    already = [s for s in again["skips"] if "이미 등록된" in s["message"]]
    assert sorted(s["row"] for s in already) == [2, 4]
    assert len(_month(club)) == 2


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

    # 양식 다운로드: 템플릿 시트 + 드롭다운(시간·사용 여부·회원 이름)
    content = club.c.get("/gatherings/import/template", headers=club.admin).content
    wb = openpyxl.load_workbook(io.BytesIO(content))
    assert wb.sheetnames[0] == "템플릿" and "회원목록" in wb.sheetnames
    ws = wb["템플릿"]
    assert [c.value for c in ws[1]] == S.TEMPLATE_HEADERS
    validations = ws.data_validations.dataValidation
    formulas = [dv.formula1 for dv in validations]
    assert any("10:00~12:00" in f for f in formulas) and any("오테식 정모" in f for f in formulas)
    assert any("회원목록" in f for f in formulas)
    # 날짜 칸은 날짜 검사(구글 시트 달력), 모든 검사는 2~101행(100행)
    assert any(dv.type == "date" and str(dv.sqref) == "A2:A101" for dv in validations)
    assert {str(dv.sqref).split(":")[1][1:] for dv in validations} == {"101"}
    # 미리 채운 값이 없다
    assert all(c.value is None for row in ws.iter_rows(min_row=2) for c in row)
    assert "김다빈" in [c.value for c in wb["회원목록"]["A"]]
    # 받은 양식 그대로 올려도(데이터 없음) 아무것도 등록되지 않는다
    assert _upload(club, content)["created"] == 0
