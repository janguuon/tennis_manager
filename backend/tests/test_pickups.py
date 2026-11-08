"""픽업 요청: 참석자만 요청·수락, 참석이 바뀌면 정리, 끝났거나 취소된 모임은 숨김."""

REQ = {"meet_place": " 수원역  4번 출구 ", "meet_time": "19:30", "going": True, "coming_back": False, "note": "라켓 가방 큼"}


def _request(club, gid, name, body=None):
    return club.c.post(f"/gatherings/{gid}/pickups", json=body or REQ, headers=club.h(name))


def _accept(club, pid, name):
    return club.c.post(f"/pickups/{pid}/driver", headers=club.h(name))


def _open_count(club, gid, name=None):
    rows = club.c.get("/gatherings?date_from=2099-01-01&date_to=2099-01-31", headers=club.h(name)).json()
    return next(g["pickup_open"] for g in rows if g["id"] == gid)


def test_request_accept_release(club):
    club.add_members("aaa", "bbb", "ccc")
    gid = club.gathering(0)

    # 참석으로 투표한 사람만 요청한다
    assert _request(club, gid, "aaa").status_code == 403
    club.vote(gid, "aaa")
    r = _request(club, gid, "aaa")
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["meet_place"] == "수원역 4번 출구" and p["meet_time"] == "19:30:00" and p["driver"] is None
    assert p["requester"]["name"] == "aaa" and "phone" not in p["requester"]
    assert _request(club, gid, "aaa").status_code == 400  # 모임당 한 건
    assert _open_count(club, gid) == 1

    # 갈 때·올 때 중 하나는 꼭, 만날 곳·시각은 선택 (짝이 된 뒤 단톡방에서 정해도 된다)
    bad = club.c.put(f"/pickups/{p['id']}", json={**REQ, "going": False}, headers=club.h("aaa"))
    assert bad.status_code == 422 and "갈 때·올 때" in bad.text
    r = club.c.put(f"/pickups/{p['id']}", json={"meet_place": "  ", "going": True}, headers=club.h("aaa"))
    assert r.status_code == 200 and r.json()["meet_place"] is None and r.json()["meet_time"] is None
    assert club.c.put(f"/pickups/{p['id']}", json=REQ, headers=club.h("aaa")).json()["meet_place"] == "수원역 4번 출구"

    # 수락: 참석자만, 본인 요청은 안 되고, 먼저 수락한 사람이 있으면 안 된다
    assert _accept(club, p["id"], "bbb").status_code == 403
    assert _accept(club, p["id"], "aaa").status_code == 400
    club.vote(gid, "bbb")
    club.vote(gid, "ccc")
    r = _accept(club, p["id"], "bbb")
    assert r.status_code == 200 and r.json()["driver"]["name"] == "bbb" and r.json()["matched_at"]
    r = _accept(club, p["id"], "ccc")
    assert r.status_code == 400 and "bbb님이 태워 가기로" in r.json()["detail"]
    assert _open_count(club, gid) == 0
    pickups = club.detail(gid)["pickups"]
    assert [(x["requester"]["name"], x["driver"]["name"]) for x in pickups] == [("aaa", "bbb")]

    # 고치기는 요청자만 (운전자는 그대로)
    assert club.c.put(f"/pickups/{p['id']}", json=REQ, headers=club.h("ccc")).status_code == 403
    r = club.c.put(f"/pickups/{p['id']}", json={**REQ, "coming_back": True, "meet_time": None}, headers=club.h("aaa"))
    assert r.json()["coming_back"] and r.json()["meet_time"] is None and r.json()["driver"]["name"] == "bbb"

    # 못 가게 됐어요: 운전자·운영진만
    assert club.c.delete(f"/pickups/{p['id']}/driver", headers=club.h("ccc")).status_code == 403
    r = club.c.delete(f"/pickups/{p['id']}/driver", headers=club.h("bbb"))
    assert r.status_code == 200 and r.json()["driver"] is None
    assert _open_count(club, gid, "ccc") == 1

    # 지우기: 요청자·운영진만
    assert club.c.delete(f"/pickups/{p['id']}", headers=club.h("ccc")).status_code == 403
    assert club.c.delete(f"/pickups/{p['id']}", headers=club.admin).status_code == 204
    assert club.detail(gid)["pickups"] == []


def test_attendance_change_cleans_up(club):
    club.add_members("aaa", "bbb", "ccc")
    gid = club.gathering(0)
    for n in ("aaa", "bbb", "ccc"):
        club.vote(gid, n)
    pa = _request(club, gid, "aaa").json()["id"]
    pc = _request(club, gid, "ccc").json()["id"]
    _accept(club, pa, "bbb")
    _accept(club, pc, "bbb")  # 한 운전자가 여러 명

    # 운전자가 불참으로 바꾸면 맡았던 요청이 다시 찾는 중
    club.vote(gid, "bbb", "absent")
    assert [x["driver"] for x in club.detail(gid)["pickups"]] == [None, None]

    # 요청자가 불참이 되거나 투표를 취소하면 요청이 지워진다
    club.vote(gid, "aaa", "absent")
    assert [x["id"] for x in club.detail(gid)["pickups"]] == [pc]
    assert club.c.delete(f"/gatherings/{gid}/attendance", headers=club.h("ccc")).status_code == 204
    assert club.detail(gid)["pickups"] == []

    # 운영진이 참석을 취소해 줘도 같다
    club.vote(gid, "aaa")
    club.vote(gid, "bbb")
    pa = _request(club, gid, "aaa").json()["id"]
    _accept(club, pa, "bbb")
    club.c.put(f"/gatherings/{gid}/participants/{club.ids['bbb']}/attendance", json={"status": "absent"}, headers=club.admin)
    assert club.detail(gid)["pickups"][0]["driver"] is None


def test_waiting_cannot_request_and_guest_can(club):
    club.add_members("aaa", "bbb", "gst")
    club.set_type("gst", "guest")
    gid = club.gathering(0, max_participants=1)
    club.vote(gid, "aaa")
    club.vote(gid, "bbb")  # 정원이 차서 대기
    assert _request(club, gid, "bbb").status_code == 403

    # 게스트도 참석이면 요청할 수 있다
    gid2 = club.gathering(0)
    assert club.vote(gid2, "gst").json()["status"] == "attending"
    assert _request(club, gid2, "gst").status_code == 201


def test_hidden_when_canceled_and_restored(club):
    club.add_members("aaa")
    gid = club.gathering(0)
    club.vote(gid, "aaa")
    pid = _request(club, gid, "aaa").json()["id"]

    club.c.post(f"/gatherings/{gid}/cancel", json={"reason": "우천"}, headers=club.admin)
    assert club.detail(gid)["pickups"] == [] and _open_count(club, gid) == 0
    assert _accept(club, pid, "aaa").status_code == 400
    club.c.delete(f"/gatherings/{gid}/cancel", headers=club.admin)
    assert [x["id"] for x in club.detail(gid)["pickups"]] == [pid]

    # 모임을 지우면 요청도 함께
    assert club.c.delete(f"/gatherings/{gid}", headers=club.admin).status_code == 204
    assert club.c.delete(f"/pickups/{pid}", headers=club.admin).status_code == 404


def test_member_delete_releases_pickups(club):
    club.add_members("aaa", "bbb", "ccc")
    gid = club.gathering(0)
    for n in ("aaa", "bbb", "ccc"):
        club.vote(gid, n)
    pa = _request(club, gid, "aaa").json()["id"]
    _request(club, gid, "ccc")
    _accept(club, pa, "ccc")

    # 기록이 없어 완전히 지워지는 회원(ccc): 요청은 지우고, 태워 가기로 한 요청은 다시 찾는 중
    r = club.c.delete(f"/admin/users/{club.ids['ccc']}", headers=club.admin)
    assert r.status_code == 200 and r.json()["result"] == "deleted"
    assert [(x["requester"]["name"], x["driver"]) for x in club.detail(gid)["pickups"]] == [("aaa", None)]
