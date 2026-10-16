"""운영진 미리 공개: 금요일 오전 10시 전에 일정을 정회원·게스트에게 공개 (게스트 투표는 그대로 3일 전)."""
import io
from datetime import datetime

import openpyxl

# 지금(conftest): 2099-01-12(월) 오전 9시 → 다음 주 일정은 1/16(금) 오전 10시 공개 예정
NEXT_WED = "2099-01-21"
NEXT_SAT = "2099-01-24"
AFTER = "2099-01-28"  # 그다음 주


def _visible(club, name):
    r = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.headers[name])
    return {g["event_date"] for g in r.json()}


def test_open_one_early_and_cancel(club, fixed_now):
    club.add_members("amy", "gus", "off", "mem")
    club.set_type("gus", "guest")
    club.set_type("off", "officer")
    wed = club.gathering(fee=0, date=NEXT_WED)
    assert NEXT_WED not in _visible(club, "amy")

    # 정회원은 미리 공개할 수 없다, 임원진은 된다
    assert club.c.post(f"/gatherings/{wed}/open", headers=club.h("mem")).status_code == 403
    r = club.c.post(f"/gatherings/{wed}/open", headers=club.h("off"))
    assert r.status_code == 200
    d = r.json()
    assert d["opened_early"] is True and d["open_to_members"] is True
    assert d["member_open_at"] == "2099-01-12T09:00:00" and d["scheduled_open_at"] == "2099-01-16T10:00:00"
    # 게스트 투표는 그대로 3일 전(1/18 일 0시)
    assert d["guest_vote_open_at"] == "2099-01-18T00:00:00" and d["guest_vote_open"] is False

    # 정회원은 보고 투표, 게스트는 보기만
    assert NEXT_WED in _visible(club, "amy") and NEXT_WED in _visible(club, "gus")
    assert club.vote(wed, "amy").status_code == 200
    assert club.vote(wed, "gus").status_code == 403

    # 미리 공개 취소 → 다시 금요일 10시까지 닫힘 (이미 한 투표는 남는다)
    r = club.c.delete(f"/gatherings/{wed}/open", headers=club.admin)
    assert r.json()["opened_early"] is False and r.json()["open_to_members"] is False
    assert NEXT_WED not in _visible(club, "amy")
    # 정해진 시각이 지나면 opened_early 표시는 사라진다
    club.c.post(f"/gatherings/{wed}/open", headers=club.admin)
    fixed_now["now"] = datetime(2099, 1, 16, 10, 0)
    d = club.detail(wed)
    assert d["opened_early"] is False and d["open_to_members"] is True


def test_open_range_early(club, fixed_now):
    club.add_members("amy", "off")
    club.set_type("off", "officer")
    wed = club.gathering(fee=0, date=NEXT_WED)
    sat = club.gathering(fee=0, date=NEXT_SAT)
    later = club.gathering(fee=0, date=AFTER)
    canceled = club.gathering(fee=0, date=NEXT_SAT)
    club.c.patch(f"/gatherings/{canceled}", json={"status": "canceled"}, headers=club.admin)

    body = {"date_from": "2099-01-19", "date_to": "2099-01-25"}
    assert club.c.post("/gatherings/open", json=body, headers=club.h("amy")).status_code == 403
    r = club.c.post("/gatherings/open", json=body, headers=club.h("off"))
    assert r.status_code == 200 and r.json()["opened"] == 2
    assert {NEXT_WED, NEXT_SAT} <= _visible(club, "amy") and AFTER not in _visible(club, "amy")
    assert club.detail(later)["open_to_members"] is False
    # 다시 눌러도 이미 열린 건 세지 않는다
    assert club.c.post("/gatherings/open", json=body, headers=club.admin).json()["opened"] == 0
    assert all(club.detail(g)["open_to_members"] for g in (wed, sat))


def test_create_and_import_open_now(club, fixed_now):
    club.add_members("amy")
    r = club.create(kind="club_regular", event_date=NEXT_WED, open_now=True)
    assert r.status_code == 201 and r.json()["opened_early"] is True
    assert NEXT_WED in _visible(club, "amy")
    # 정회원은 바로 공개를 고를 수 없다 (일반 벙개도)
    assert club.create(as_="amy", kind="flash", event_date=NEXT_SAT, open_now=True).status_code == 403

    wb = openpyxl.Workbook()
    wb.active.append(["날짜", "제목", "종류"])
    wb.active.append([NEXT_SAT, "정모", "오테식 정모"])
    bio = io.BytesIO()
    wb.save(bio)
    files = {"file": ("m.xlsx", bio.getvalue(), "application/octet-stream")}
    r = club.c.post("/gatherings/import", files=files, data={"open_now": "true"}, headers=club.admin).json()
    assert r["created"] == 1
    assert club.detail(r["items"][0]["id"])["opened_early"] is True
    assert NEXT_SAT in _visible(club, "amy")
