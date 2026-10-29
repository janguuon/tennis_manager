"""임원진 직함(회장·부회장·고문·경기이사·총무·부총무): 정하기, 권한, 회원 목록 순서."""
from datetime import datetime

from app.database import SessionLocal
from app.models import User

TITLES = ["president", "vice_president", "advisor", "match_director", "treasurer", "vice_treasurer"]


def test_admin_sets_officer_titles(club):
    club.add_members("amy")
    url = f"/admin/users/{club.ids['amy']}/member-type"
    for t in TITLES:
        r = club.c.put(url, json={"member_type": t}, headers=club.admin)
        assert r.status_code == 200 and r.json()["member_type"] == t
    # 직함은 관리자만 정한다 (임원진이어도)
    assert club.c.put(url, json={"member_type": "president"}, headers=club.headers["amy"]).status_code == 403
    assert club.c.put(url, json={"member_type": "chairman"}, headers=club.admin).status_code == 422

    # 가입을 승인하면서 정할 수도 있다
    club.c.post("/auth/signup", json={"gender": "male", "username": "ben", "password": "1234", "name": "ben"})
    [s] = club.c.get("/admin/signups/pending", headers=club.admin).json()
    r = club.c.post(f"/admin/signups/{s['id']}/approve?member_type=vice_president", headers=club.admin)
    assert r.json()["member_type"] == "vice_president"


def test_titles_are_officers_but_only_treasurer_settles(club):
    names = ["pre", "vic", "adv", "mat", "tre", "vtr"]
    club.add_members(*names, "mem")
    for n, t in zip(names, TITLES):
        club.set_type(n, t)
    for n in names:
        # 임원진 권한: 클럽 소식 올리기, 오테식 정모 만들기
        assert club.c.post("/notices", json={"title": f"{n} 소식"}, headers=club.h(n)).status_code == 201, n
        assert club.create(as_=n, kind="club_regular").status_code == 201, n
        # 코트비 지급(정산)은 총무만 (회칙 제8조)
        assert club.c.get("/court-bookings", headers=club.h(n)).status_code == (200 if n == "tre" else 403), n
    assert club.c.post("/notices", json={"title": "정회원 소식"}, headers=club.h("mem")).status_code == 403


def test_member_list_orders_titles_then_join_date_then_guests(club):
    club.add_members("gu1", "m_b", "mat", "m_a", "pre", "off", "vtr", "adv", "tre", "vic", "gu2")
    for n, t in [
        ("gu1", "guest"),
        ("gu2", "guest"),
        ("mat", "match_director"),
        ("pre", "president"),
        ("off", "officer"),
        ("vtr", "vice_treasurer"),
        ("tre", "treasurer"),
        ("vic", "vice_president"),
        ("adv", "advisor"),
    ]:
        club.set_type(n, t)
    # m_a는 늦게 신청했지만 더 먼저 가입한 회원 (정회원은 가입 시기순)
    with SessionLocal() as db:
        db.get(User, club.ids["m_a"]).created_at = datetime(2020, 1, 1)
        db.commit()

    for who in ("m_b", "pre"):
        names = [u["username"] for u in club.c.get("/users", headers=club.h(who)).json()]
        assert names == ["pre", "vic", "adv", "mat", "tre", "vtr", "off", "m_a", "admin1", "m_b", "gu1", "gu2"]

