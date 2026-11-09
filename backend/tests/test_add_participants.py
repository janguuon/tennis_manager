"""운영진이 모임에 참가자를 넣는다: 고른 순서대로, 정원이 차면 대기, 운영진만."""


def _add(club, gid, names, as_=None):
    return club.c.post(
        f"/gatherings/{gid}/participants", json={"user_ids": [club.ids[n] for n in names]}, headers=club.h(as_)
    )


def _status(club, gid):
    return {p["user"]["name"]: p["status"] for p in club.c.get(f"/gatherings/{gid}/participants", headers=club.admin).json()}


def test_staff_adds_in_order_then_waiting(club):
    club.add_members("aaa", "bbb", "ccc", "ddd", "off", "kim")
    club.set_type("off", "officer")
    gid = club.create(title="벙개", max_participants=3).json()["id"]
    club.vote(gid, "aaa")
    club.vote(gid, "ddd", "absent")  # 불참 투표했던 사람도 넣을 수 있다

    r = _add(club, gid, ["ddd", "bbb", "ccc", "aaa", "bbb"], as_="off")
    assert r.status_code == 200, r.text
    # 같은 사람은 한 번, 이미 참석한 aaa 는 그대로, 고른 순서대로 → 3번째부터 대기
    assert [(p["user"]["name"], p["status"]) for p in r.json()] == [
        ("ddd", "attending"), ("bbb", "attending"), ("ccc", "waiting"), ("aaa", "attending"),
    ]
    assert _status(club, gid) == {"aaa": "attending", "ddd": "attending", "bbb": "attending", "ccc": "waiting"}

    # 정회원은 못 넣는다 (자기 벙개여도)
    own = club.create("kim", title="김 벙개").json()["id"]
    assert _add(club, own, ["aaa"], as_="kim").status_code == 403
    assert _add(club, own, ["aaa"]).status_code == 200  # 관리자


def test_who_can_be_added(club):
    club.add_members("aaa", "gst")
    club.set_type("gst", "guest")
    gid = club.create(title="벙개").json()["id"]
    # 가입한 게스트도 넣을 수 있다 (게스트 투표 시각 전이어도 운영진이)
    assert _add(club, gid, ["gst"]).json()[0]["status"] == "attending"
    # 이름만 적어 초대한 게스트·없는 회원은 안 된다
    invited = club.c.post(f"/gatherings/{gid}/guests", json={"name": "손님", "gender": "male"}, headers=club.admin).json()
    r = club.c.post(f"/gatherings/{gid}/participants", json={"user_ids": [invited["user"]["id"]]}, headers=club.admin)
    assert r.status_code == 400 and "손님" in r.json()["detail"]
    assert club.c.post(f"/gatherings/{gid}/participants", json={"user_ids": [9999]}, headers=club.admin).status_code == 400
    assert club.c.post(f"/gatherings/{gid}/participants", json={"user_ids": []}, headers=club.admin).status_code == 422
    # 취소된 모임에는 못 넣는다
    club.c.post(f"/gatherings/{gid}/cancel", json={"reason": "우천"}, headers=club.admin)
    assert _add(club, gid, ["aaa"]).status_code == 400
