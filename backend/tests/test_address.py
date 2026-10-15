"""코트 주소(선택): 지도 버튼이 먼저 쓰는 주소. 한 번 적으면 같은 장소의 다른 일정에도 들어간다."""
import io
from datetime import datetime

import openpyxl

from app import schedule_import as S

ADDR = "경기 안산시 상록구 수암동 123"


def test_address_shared_by_same_place(club):
    a = club.create(kind="flash", location="수암꿈나무", event_date="2099-01-10").json()
    assert a["address"] is None
    # 주소를 적어 만들면, 같은 장소(띄어쓰기 무시)인데 주소가 없던 일정에도 들어간다
    b = club.create(kind="flash", location="수암 꿈나무", address=f"  {ADDR} ", event_date="2099-01-12").json()
    assert b["address"] == ADDR
    assert club.detail(a["id"])["address"] == ADDR
    # 다음 일정은 주소를 비워도 같은 장소의 주소가 들어간다
    c = club.create(kind="flash", location="수암꿈나무", event_date="2099-01-19").json()
    assert c["address"] == ADDR
    # 다른 장소는 그대로
    assert club.create(kind="flash", location="시민 테니스장").json()["address"] is None

    # 수정으로 주소를 바꾸면, 주소가 비어 있던 같은 장소 일정에 채운다 (이미 있는 주소는 그대로)
    d = club.create(kind="flash", location="구립 코트", event_date="2099-01-20").json()
    e = club.create(kind="flash", location="구립 코트", event_date="2099-01-21").json()
    r = club.c.patch(f"/gatherings/{d['id']}", json={"address": "서울 어딘가 1"}, headers=club.admin)
    assert r.json()["address"] == "서울 어딘가 1"
    assert club.detail(e["id"])["address"] == "서울 어딘가 1"
    # 지우기
    assert club.c.patch(f"/gatherings/{d['id']}", json={"address": ""}, headers=club.admin).json()["address"] is None


def test_court_sheet_address_column(club):
    content = club.c.get("/gatherings/import/template", headers=club.admin).content
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb["템플릿"]
    assert [c.value for c in ws[1]] == S.TEMPLATE_HEADERS and S.TEMPLATE_HEADERS[-1] == "주소(선택)"
    club.add_members("seo")
    rows = [
        [datetime(2099, 1, 17), "10:00~12:00", 3, "장미주", "seo", 24000, None, "오테식 정모", None, "수암꿈나무", None, ADDR],
        [datetime(2099, 1, 24), "10:00~12:00", 4, "장미주", "seo", 24000, None, "오테식 정모", None, "수암꿈나무", None, None],
    ]
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    files = {"file": ("s.xlsx", bio.getvalue(), "application/octet-stream")}
    res = club.c.post("/gatherings/import", files=files, headers=club.admin).json()
    assert res["created"] == 2
    listed = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.admin).json()
    assert [g["address"] for g in sorted(listed, key=lambda g: g["event_date"])] == [ADDR, ADDR]
