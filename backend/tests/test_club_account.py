"""모임 통장: 관리자·총무가 정하고, 오테식 모임은 계좌가 비어 있으면 모임 통장으로 채운다."""
import io
from datetime import date, timedelta

import openpyxl

# 테스트용 가짜 계좌 (실제 모임 통장은 코드에 두지 않는다)
ACCOUNT = {"bank": "카카오뱅크", "account_number": "0000-00-0000", "account_holder": "홍총무"}


def put_account(club, as_=None, **body):
    return club.c.put("/club/account", json={**ACCOUNT, **body}, headers=club.h(as_))


def account_of(club, gid):
    d = club.detail(gid)
    return (d["bank"], d["account_number"], d["account_holder"])


def test_only_admin_and_treasurer_set_it_everyone_reads(club):
    club.add_members("mem", "off", "tre")
    club.set_type("off", "officer")
    club.set_type("tre", "treasurer")
    assert club.c.get("/club/account", headers=club.h("mem")).json() is None

    assert put_account(club, "mem").status_code == 403
    assert put_account(club, "off").status_code == 403
    r = put_account(club, "tre", account_number=" 0000-00-0000 ")
    assert r.status_code == 200 and r.json()["account"]["account_number"] == "0000-00-0000"
    assert club.c.get("/club/account", headers=club.h("mem")).json() == ACCOUNT
    assert put_account(club, account_number="  ").status_code == 422


def test_club_gatherings_get_the_club_account(club):
    put_account(club)
    # 계좌를 비워 두면 오테식 모임은 모임 통장
    gid = club.create(kind="club_regular").json()["id"]
    assert account_of(club, gid) == tuple(ACCOUNT.values())
    # 직접 적은 계좌는 그대로
    other = club.create(kind="club_flash", bank="국민", account_number="111", account_holder="김").json()["id"]
    assert account_of(club, other) == ("국민", "111", "김")
    # 일반 벙개는 채우지 않는다
    flash = club.create(kind="flash").json()["id"]
    assert account_of(club, flash) == (None, None, None)
    # 일반 벙개 → 오테식 모임으로 바꾸면 모임 통장
    club.c.patch(f"/gatherings/{flash}", json={"kind": "club_flash"}, headers=club.admin)
    assert account_of(club, flash) == tuple(ACCOUNT.values())


def test_apply_to_upcoming(club):
    today = date.today()
    past = club.create(kind="club_regular", event_date=str(today - timedelta(days=3))).json()["id"]
    soon = club.create(kind="club_regular", event_date=str(today + timedelta(days=3)),
                       bank="옛은행", account_number="999").json()["id"]
    flash = club.create(kind="flash", event_date=str(today + timedelta(days=3))).json()["id"]
    canceled = club.create(kind="club_flash", event_date=str(today + timedelta(days=5))).json()["id"]
    club.c.patch(f"/gatherings/{canceled}", json={"status": "canceled"}, headers=club.admin)

    r = put_account(club)
    assert r.json()["updated"] == 1  # 다가오는 오테식 모임만
    assert account_of(club, soon) == tuple(ACCOUNT.values())
    assert account_of(club, past)[1] != ACCOUNT["account_number"]
    assert account_of(club, flash) == (None, None, None)
    assert account_of(club, canceled)[1] != ACCOUNT["account_number"]

    # 다가오는 모임에 적용하지 않기
    r = put_account(club, account_number="1234", apply_upcoming=False)
    assert r.json()["updated"] == 0
    assert account_of(club, soon)[1] == ACCOUNT["account_number"]


def test_without_club_account_uses_latest_club_gathering(club):
    # 예전 방식: 모임 통장을 정하지 않았으면 가장 최근 오테식 모임의 계좌
    club.create(kind="club_regular", bank="신한", account_number="222", account_holder="이")
    gid = club.create(kind="club_flash").json()["id"]
    assert account_of(club, gid) == ("신한", "222", "이")


def test_excel_import_uses_club_account(club):
    put_account(club)
    wb = openpyxl.Workbook()
    wb.active.append(["날짜", "제목", "종류"])
    wb.active.append(["2099-01-10", "정모", "오테식 정모"])
    wb.active.append(["2099-01-11", "벙개", "일반 벙개"])
    bio = io.BytesIO()
    wb.save(bio)
    files = {"file": ("m.xlsx", bio.getvalue(), "application/octet-stream")}
    items = club.c.post("/gatherings/import", files=files, headers=club.admin).json()["items"]
    regular, flash = (i["id"] for i in items)
    assert account_of(club, regular) == tuple(ACCOUNT.values())
    assert account_of(club, flash) == (None, None, None)
