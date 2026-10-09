"""일정 공개 시점: 임원진 즉시 · 정회원 그 주 월요일 0시 · 게스트 3일 전 0시."""
from datetime import datetime

# 2099-01-12(월) 주: 금요일 모임 / 다음 주 수요일 모임 / 다음 주 월요일 모임
THIS_FRI = "2099-01-16"
NEXT_WED = "2099-01-21"
NEXT_MON = "2099-01-19"


def _visible(club, name, date_from="2099-01-01", date_to="2099-01-31"):
    r = club.c.get(f"/gatherings?date_from={date_from}&date_to={date_to}", headers=club.headers[name])
    return {g["event_date"] for g in r.json()}


def test_members_see_week_from_monday(club, fixed_now):
    club.add_members("amy", "ben")
    club.set_type("ben", "officer")
    fri = club.gathering(fee=0, date=THIS_FRI)
    wed = club.gathering(fee=0, date=NEXT_WED)

    # 월요일 오전: 정회원은 이번 주만, 임원진·관리자는 다음 주까지
    assert _visible(club, "amy") == {THIS_FRI}
    assert _visible(club, "ben") == {THIS_FRI, NEXT_WED}
    admin_view = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.admin).json()
    assert {g["event_date"] for g in admin_view} == {THIS_FRI, NEXT_WED}

    # 공개 전 일정은 상세·투표도 막힌다
    r = club.c.get(f"/gatherings/{wed}", headers=club.headers["amy"])
    assert r.status_code == 403 and "1월 19일(월) 0시" in r.json()["detail"]
    assert club.vote(wed, "amy").status_code == 403
    assert club.vote(wed, "ben").status_code == 200  # 임원진은 미리 투표 가능
    assert club.vote(fri, "amy").status_code == 200

    # 다음 주 월요일 0시가 되면 정회원에게 열린다
    fixed_now["now"] = datetime(2099, 1, 19, 0, 0)
    assert NEXT_WED in _visible(club, "amy")
    assert club.vote(wed, "amy").status_code == 200


def test_guests_open_three_days_before(club, fixed_now):
    club.add_members("gus")
    club.set_type("gus", "guest")
    fri = club.gathering(fee=0, date=THIS_FRI)

    # 월요일: 정회원에게는 열렸지만 게스트는 3일 전(화 0시)부터
    assert _visible(club, "gus") == set()
    r = club.vote(fri, "gus")
    assert r.status_code == 403 and "1월 13일(화) 0시" in r.json()["detail"]

    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    assert _visible(club, "gus") == {THIS_FRI}
    assert club.vote(fri, "gus").status_code == 200

    d = club.detail(fri)
    assert d["member_open_at"] == "2099-01-12T00:00:00"
    assert d["guest_open_at"] == "2099-01-13T00:00:00"
    assert d["open_to_members"] is True and d["open_to_guests"] is True


def test_guest_never_before_members(club, fixed_now):
    """월요일 모임: 3일 전(금)이 아니라 정회원과 같은 그 주 월요일 0시에 열린다."""
    club.add_members("gus")
    club.set_type("gus", "guest")
    mon = club.gathering(fee=0, date=NEXT_MON)

    fixed_now["now"] = datetime(2099, 1, 17, 12, 0)  # 토요일
    assert _visible(club, "gus") == set()
    d = club.detail(mon)
    assert d["guest_open_at"] == d["member_open_at"] == "2099-01-19T00:00:00"
    assert d["open_to_members"] is False

    fixed_now["now"] = datetime(2099, 1, 19, 0, 0)
    assert _visible(club, "gus") == {NEXT_MON}


def test_guest_takes_only_remaining_seats(club, fixed_now):
    club.add_members("amy", "ben", "gus")
    club.set_type("gus", "guest")
    fri = club.gathering(fee=0, date=THIS_FRI, max_participants=2)
    assert club.vote(fri, "amy").status_code == 200
    assert club.vote(fri, "ben").status_code == 200

    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    r = club.vote(fri, "gus")
    assert r.status_code == 409  # 정회원이 이미 정원을 채움


def test_approve_as_guest_and_change_type(club):
    club.c.post("/auth/signup", json={"username": "newbie", "password": "1234", "name": "새친구"})
    pending = club.c.get("/admin/signups/pending", headers=club.admin).json()
    uid = pending[0]["id"]
    r = club.c.post(f"/admin/signups/{uid}/approve?member_type=guest", headers=club.admin)
    assert r.json()["member_type"] == "guest"

    r = club.c.put(f"/admin/users/{uid}/member-type", json={"member_type": "member"}, headers=club.admin)
    assert r.json()["member_type"] == "member"

    club.add_members("amy")
    r = club.c.put(f"/admin/users/{uid}/member-type", json={"member_type": "officer"}, headers=club.headers["amy"])
    assert r.status_code == 403


def test_monthly_summary_hides_unopened(club, fixed_now):
    club.add_members("amy", "ben")
    club.set_type("ben", "officer")
    wed = club.gathering(fee=10000, date=NEXT_WED)
    club.vote(wed, "ben")
    month = "2099-01"
    amy = club.c.get(f"/gatherings/payments/summary?month={month}", headers=club.headers["amy"]).json()
    ben = club.c.get(f"/gatherings/payments/summary?month={month}", headers=club.headers["ben"]).json()
    assert [g["id"] for g in amy["gatherings"]] == []
    assert [g["id"] for g in ben["gatherings"]] == [wed]
