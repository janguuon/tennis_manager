"""일정 공개 시점: 임원진 즉시 · 정회원·게스트 전주 금요일 오전 10시(다음 주 월~일) · 게스트 투표는 3일 전 0시."""
from datetime import date, datetime

# 2099-01-12(월) 주: 금요일 모임 / 다음 주 수요일 모임 / 다음 주 월요일 모임
THIS_FRI = "2099-01-16"
NEXT_WED = "2099-01-21"
NEXT_MON = "2099-01-19"


def _visible(club, name, date_from="2099-01-01", date_to="2099-01-31"):
    r = club.c.get(f"/gatherings?date_from={date_from}&date_to={date_to}", headers=club.headers[name])
    return {g["event_date"] for g in r.json()}


def test_members_see_next_week_from_friday_10am(club, fixed_now):
    club.add_members("amy", "ben")
    club.set_type("ben", "officer")
    fri = club.gathering(fee=0, date=THIS_FRI)
    wed = club.gathering(fee=0, date=NEXT_WED)

    # 월요일 오전: 정회원은 이번 주만(지난 금요일 10시에 열림), 임원진·관리자는 다음 주까지
    assert _visible(club, "amy") == {THIS_FRI}
    assert _visible(club, "ben") == {THIS_FRI, NEXT_WED}
    admin_view = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.admin).json()
    assert {g["event_date"] for g in admin_view} == {THIS_FRI, NEXT_WED}

    # 공개 전 일정은 상세·투표도 막힌다
    r = club.c.get(f"/gatherings/{wed}", headers=club.headers["amy"])
    assert r.status_code == 403 and "1월 16일(금) 오전 10시" in r.json()["detail"]
    assert club.vote(wed, "amy").status_code == 403
    assert club.vote(wed, "ben").status_code == 200  # 임원진은 미리 투표 가능
    assert club.vote(fri, "amy").status_code == 200

    # 금요일 오전 10시 직전까지는 닫혀 있고, 10시가 되면 다음 주(월~일) 일정이 열린다
    fixed_now["now"] = datetime(2099, 1, 16, 9, 59)
    assert NEXT_WED not in _visible(club, "amy")
    fixed_now["now"] = datetime(2099, 1, 16, 10, 0)
    assert NEXT_WED in _visible(club, "amy")
    assert club.vote(wed, "amy").status_code == 200


def test_guests_see_with_members_but_vote_three_days_before(club, fixed_now):
    club.add_members("gus")
    club.set_type("gus", "guest")
    fri = club.gathering(fee=0, date=THIS_FRI)

    # 월요일: 일정은 정회원과 함께 보이지만(지난 금요일 10시 공개), 투표는 3일 전(화 0시)부터
    assert _visible(club, "gus") == {THIS_FRI}
    assert club.c.get(f"/gatherings/{fri}", headers=club.headers["gus"]).status_code == 200
    r = club.vote(fri, "gus")
    assert r.status_code == 403 and "게스트 투표는 1월 13일(화) 0시부터" in r.json()["detail"]

    d = club.detail(fri)
    assert d["member_open_at"] == "2099-01-09T10:00:00"
    assert d["guest_vote_open_at"] == "2099-01-13T00:00:00"
    assert d["open_to_members"] is True and d["guest_vote_open"] is False

    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    assert club.vote(fri, "gus").status_code == 200
    assert club.detail(fri)["guest_vote_open"] is True


def test_guest_never_before_members(club, fixed_now):
    """월요일 모임: 3일 전(금) 0시가 아니라 일정이 열리는 금요일 오전 10시에 보이고 투표도 열린다."""
    club.add_members("gus")
    club.set_type("gus", "guest")
    mon = club.gathering(fee=0, date=NEXT_MON)

    fixed_now["now"] = datetime(2099, 1, 16, 9, 0)  # 금요일 오전 9시
    assert _visible(club, "gus") == set()
    d = club.detail(mon)
    assert d["guest_vote_open_at"] == d["member_open_at"] == "2099-01-16T10:00:00"
    assert d["open_to_members"] is False

    fixed_now["now"] = datetime(2099, 1, 16, 10, 0)
    assert _visible(club, "gus") == {NEXT_MON}
    assert club.vote(mon, "gus").status_code == 200


def test_guest_takes_only_remaining_seats(club, fixed_now):
    club.add_members("amy", "ben", "gus")
    club.set_type("gus", "guest")
    fri = club.gathering(fee=0, date=THIS_FRI, max_participants=2)
    assert club.vote(fri, "amy").status_code == 200
    assert club.vote(fri, "ben").status_code == 200

    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    r = club.vote(fri, "gus")
    assert r.json()["status"] == "waiting"  # 정회원이 이미 정원을 채움 → 대기


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


def test_open_time_text():
    from app.visibility import format_open_at, member_open_at

    assert member_open_at(date(2026, 10, 19)) == datetime(2026, 10, 16, 10, 0)  # 월 → 전주 금
    assert member_open_at(date(2026, 10, 25)) == datetime(2026, 10, 16, 10, 0)  # 일 → 같은 금
    assert member_open_at(date(2026, 10, 18)) == datetime(2026, 10, 9, 10, 0)  # 이번 주 일 → 지난 금
    assert format_open_at(datetime(2026, 10, 16, 10, 0)) == "10월 16일(금) 오전 10시"
    assert format_open_at(datetime(2026, 10, 13, 0, 0)) == "10월 13일(화) 0시"
    assert format_open_at(datetime(2026, 10, 13, 15, 30)) == "10월 13일(화) 오후 3시 30분"
