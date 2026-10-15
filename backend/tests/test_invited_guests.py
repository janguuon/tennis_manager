"""이름만 적어 초대하는 게스트: 게스트와 같은 자리·대기·게스트비, 게스트 투표 시각부터, 초대 취소."""
from datetime import date, datetime, timedelta

# conftest.fixed_now: 2099-01-12(월) 09:00 → 01-15(목) 모임은 게스트 투표가 열려 있고 01-16(금) 모임은 아직(01-13 0시)
THU = "2099-01-15"
FRI = "2099-01-16"


def _invite(club, gid, who, name="홍길동", **extra):
    return club.c.post(f"/gatherings/{gid}/guests", json={"name": name, **extra}, headers=club.h(who))


def _people(club, gid):
    return {p["user"]["name"]: p for p in club.detail(gid)["participants"]}


def test_attendee_invites_guest_who_takes_a_seat(club, fixed_now):
    club.add_members("amy", "ben")
    g = club.create(kind="club_regular", event_date=THU, max_participants=2, bank="국민", account_number="1").json()
    club.vote(g["id"], "amy")

    r = _invite(club, g["id"], "amy", "  홍  길동 ", gender="male")
    assert r.status_code == 201
    guest = r.json()
    assert guest["status"] == "attending"
    assert (guest["user"]["name"], guest["user"]["member_type"], guest["user"]["invited_by_name"]) == (
        "홍 길동", "guest", "amy",
    )
    # 회원 명단에는 나오지 않는다
    names = {u["name"] for u in club.c.get("/users", headers=club.h("amy")).json()}
    assert "홍 길동" not in names
    # 오테식 모임: 초대 게스트도 게스트비를 낸다
    pay = club.detail(g["id"])["payment"]
    assert [(x["user"]["name"], x["amount"]) for x in pay["dues"]] == [("홍 길동", 5000)]
    # 정원(2명)이 찼으니 다음 초대는 대기
    assert _invite(club, g["id"], "amy", "김철수").json()["status"] == "waiting"
    # 회원도 대기로 (정원이 찼다)
    assert club.vote(g["id"], "ben").json()["status"] == "waiting"


def test_who_and_when_can_invite(club, fixed_now):
    club.add_members("amy", "ben", "off", "gus")
    club.set_type("off", "officer")
    club.set_type("gus", "guest")
    thu = club.gathering(fee=0, date=THU)
    fri = club.gathering(fee=0, date=FRI)
    club.vote(thu, "amy")
    club.vote(fri, "amy")

    assert _invite(club, thu, "ben").status_code == 403  # 참석하지 않은 회원
    assert club.vote(thu, "gus").status_code == 200
    assert _invite(club, thu, "gus").status_code == 403  # 게스트는 보기와 투표만
    # 게스트 투표 전(금요일 모임은 화요일 0시부터)에는 운영진만
    r = _invite(club, fri, "amy")
    assert r.status_code == 403 and "1월 13일(화) 0시부터" in r.json()["detail"]
    assert _invite(club, fri, "off").status_code == 201
    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    assert _invite(club, fri, "amy").status_code == 201
    # 이름은 꼭
    assert _invite(club, thu, "amy", "   ").status_code == 422


def test_cancel_invite(club):
    """초대한 회원·운영진이 취소, 3일 전부터 참석 중인 게스트는 운영진만. 빠지면 대기자가 올라간다."""
    club.add_members("amy", "ben", "cal", "off")
    club.set_type("off", "officer")
    far = (date.today() + timedelta(days=10)).isoformat()
    soon = (date.today() + timedelta(days=1)).isoformat()
    gid = club.gathering(fee=0, date=far, max_participants=2)
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    guest = _invite(club, gid, "amy").json()["user"]
    assert _people(club, gid)["홍길동"]["status"] == "waiting"
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("ben")).status_code == 403
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("amy")).status_code == 204
    assert "홍길동" not in _people(club, gid)

    # 내일 모임: 참석 중인 초대 게스트는 운영진만 취소, 대기자가 올라간다
    gid = club.gathering(fee=0, date=soon, max_participants=2)
    club.vote(gid, "amy")
    guest = _invite(club, gid, "amy").json()["user"]
    club.vote(gid, "cal")
    assert _people(club, gid)["cal"]["status"] == "waiting"
    r = club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("amy"))
    assert r.status_code == 403 and "운영진" in r.json()["detail"]
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("off")).status_code == 204
    assert _people(club, gid)["cal"]["status"] == "attending"
    # 가입한 회원은 이 경로로 뺄 수 없다
    r = club.c.delete(f"/gatherings/{gid}/guests/{club.ids['cal']}", headers=club.h("off"))
    assert r.status_code == 404
