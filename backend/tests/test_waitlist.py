"""참석 대기열: 미정 없음, 정원이 차면 대기, 자리가 나면 순서대로 참석."""
from datetime import date, timedelta


def status_of(club, gid, name):
    d = club.detail(gid)
    for p in d["participants"]:
        if p["user"]["username"] == name:
            return p["status"]
    return None


def test_full_gathering_puts_new_votes_on_waitlist_in_order(club):
    club.add_members("amy", "ben", "cal", "dan", "eve")
    gid = club.gathering(fee=0, max_participants=2)
    assert club.vote(gid, "amy").json()["status"] == "attending"
    assert club.vote(gid, "ben").json()["status"] == "attending"
    r = club.vote(gid, "cal")
    assert r.status_code == 200 and r.json()["status"] == "waiting"
    assert club.vote(gid, "dan").json()["status"] == "waiting"
    # 다시 참석을 눌러도 대기 순서는 그대로
    club.vote(gid, "cal")
    d = club.detail(gid)
    assert (d["attendance"]["attending"], d["attendance"]["waiting"]) == (2, 2)

    # 참석자가 불참하면 먼저 대기한 사람(cal)이 참석이 된다
    club.vote(gid, "ben", "absent")
    assert status_of(club, gid, "cal") == "attending"
    assert status_of(club, gid, "dan") == "waiting"
    # 새로 온 사람은 대기자 뒤로
    assert club.vote(gid, "eve").json()["status"] == "waiting"

    # 참석 취소(투표 삭제)도 자리를 내준다
    club.c.delete(f"/gatherings/{gid}/attendance", headers=club.headers["amy"])
    assert status_of(club, gid, "dan") == "attending"
    assert status_of(club, gid, "eve") == "waiting"

    # 정원을 늘리면 대기자가 올라간다
    club.c.patch(f"/gatherings/{gid}", json={"max_participants": 3}, headers=club.admin)
    assert status_of(club, gid, "eve") == "attending"


def test_no_more_maybe_and_unlimited_capacity(club):
    club.add_members("amy")
    gid = club.gathering(fee=0)
    assert club.vote(gid, "amy", "maybe").status_code == 422
    assert club.vote(gid, "amy").json()["status"] == "attending"  # 정원이 없으면 바로 참석


def test_lock_blocks_attendee_leaving_but_waiting_can_leave(club):
    club.add_members("amy", "ben", "cal")
    soon = (date.today() + timedelta(days=2)).isoformat()
    gid = club.gathering(fee=0, date=soon, max_participants=1)
    club.vote(gid, "amy")
    assert club.vote(gid, "ben").json()["status"] == "waiting"
    # 3일 전부터 참석자는 스스로 불참·취소 불가
    assert club.vote(gid, "amy", "absent").status_code == 403
    assert club.c.delete(f"/gatherings/{gid}/attendance", headers=club.headers["amy"]).status_code == 403
    # 대기자는 언제든 대기 취소 가능, 투표 안 한 사람도 불참 표시 가능
    assert club.vote(gid, "ben", "absent").json()["status"] == "absent"
    assert club.vote(gid, "cal", "absent").status_code == 200
    # 운영진이 불참 처리하면 대기자가 올라간다
    club.vote(gid, "ben")
    r = club.c.put(f"/gatherings/{gid}/participants/{club.ids['amy']}/attendance",
                   json={"status": "absent"}, headers=club.admin)
    assert r.status_code == 200 and r.json()["status"] == "absent"
    assert status_of(club, gid, "ben") == "attending"
    # 일반 회원은 다른 사람의 참석을 바꿀 수 없다
    r = club.c.put(f"/gatherings/{gid}/participants/{club.ids['ben']}/attendance",
                   json={"status": "absent"}, headers=club.headers["cal"])
    assert r.status_code == 403


def test_waiting_members_are_not_charged_until_promoted(club):
    club.add_members("amy", "ben", "cal")
    gid = club.create(kind="flash", court_fee=30000, max_participants=2).json()["id"]
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    club.vote(gid, "cal")
    d = club.detail(gid)
    assert d["per_person"] == 15000
    assert {line["user"]["username"] for line in d["payment"]["dues"]} == {"amy", "ben"}
    assert club.pay(gid, "cal").status_code in (400, 409)  # 대기자는 입금 처리 대상이 아님
    club.vote(gid, "amy", "absent")
    d = club.detail(gid)
    assert {line["user"]["username"] for line in d["payment"]["dues"]} == {"ben", "cal"}


def test_deleted_or_withdrawn_member_frees_seat(club):
    club.add_members("amy", "ben", "cal", "dan")
    # 기록이 없는 회원은 완전 삭제 → 자리가 나서 대기자 승격
    g1 = club.gathering(fee=0, max_participants=1)
    club.vote(g1, "amy")
    club.vote(g1, "ben")
    assert club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin).json()["result"] == "deleted"
    assert status_of(club, g1, "ben") == "attending"

    # 경기 기록이 있는 회원은 탈퇴 처리 → 앞으로의 모임은 불참, 대기자 승격
    g2 = club.gathering(fee=0, max_participants=1)
    club.vote(g2, "cal")
    club.vote(g2, "dan")
    match = {"match_type": "singles", "played_at": "2026-10-01", "team1_score": 6, "team2_score": 3,
             "players": [{"user_id": club.ids["cal"], "team": 1}, {"user_id": club.ids["ben"], "team": 2}]}
    club.c.post("/matches", json=match, headers=club.admin)
    assert club.c.delete(f"/admin/users/{club.ids['cal']}", headers=club.admin).json()["result"] == "deactivated"
    assert status_of(club, g2, "dan") == "attending"
