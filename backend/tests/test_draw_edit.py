"""현장에서 대진 바꾸기: 참석자가 자리를 바꾸거나 쉬던 사람을 넣는다."""

SLOTS = ["team1_player1", "team1_player2", "team2_player1", "team2_player2"]


def setup(club, names, courts=2, genders=None):
    club.add_members(*names)
    for n, g in (genders or {}).items():
        club.c.patch("/users/me", json={"gender": g}, headers=club.h(n))
    gid = club.create(kind="club_regular", court_count=courts).json()["id"]
    for n in names:
        club.vote(gid, n)
    return gid


def generate(club, gid, **body):
    body = {"rounds": 1, **body}
    return club.c.post(f"/gatherings/{gid}/draws/generate", json=body, headers=club.admin).json()


def change(club, dm_id, slot, user_id, as_):
    return club.c.post(f"/draw-matches/{dm_id}/slot", json={"slot": slot, "user_id": user_id},
                       headers=club.h(as_))


def who(club, uid):
    return next(n for n, i in club.ids.items() if i == uid)


def test_swap_with_player_in_another_match(club):
    gid = setup(club, ("aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh"))
    draw = generate(club, gid)
    m1, m2 = draw["matches"]
    mover = m1["slot_ids"][0]           # 1코트 팀1 1번
    displaced = m2["slot_ids"][2]       # 2코트 팀2 1번
    # 참석자 누구나(여기선 다른 참석자) 바꿀 수 있다
    r = change(club, m2["id"], "team2_player1", mover, as_=who(club, m1["slot_ids"][3]))
    assert r.status_code == 200
    after = {m["id"]: m["slot_ids"] for m in r.json()["matches"]}
    assert after[m2["id"]][2] == mover
    assert after[m1["id"]][0] == displaced  # 서로 자리를 바꿨다
    # 한 라운드에 같은 사람이 두 번 들어가지 않는다
    flat = [u for ids in after.values() for u in ids]
    assert len(flat) == len(set(flat)) == 8


def test_put_in_resting_player_and_swap_within_match(club):
    gid = setup(club, ("aaa", "bbb", "ccc", "ddd", "eee"), courts=1)
    (m,) = generate(club, gid)["matches"]
    resting = next(i for n, i in club.ids.items() if i not in m["slot_ids"])
    out = m["slot_ids"][1]
    r = change(club, m["id"], "team1_player2", resting, as_=who(club, resting))
    ids = r.json()["matches"][0]["slot_ids"]
    assert ids[1] == resting and out not in ids  # 원래 선수는 쉰다

    # 같은 경기 안에서 팀을 바꾸면 두 자리를 맞바꾼다
    a, c = ids[0], ids[2]
    ids2 = change(club, m["id"], "team2_player1", a, as_=None).json()["matches"][0]["slot_ids"]
    assert (ids2[0], ids2[2]) == (c, a)


def test_permissions_and_rules(club):
    gid = setup(club, ("aaa", "bbb", "ccc", "ddd"), courts=1)
    club.add_members("out1", "away")
    club.vote(gid, "away", "absent")
    (m,) = generate(club, gid)["matches"]
    # 참석하지 않은 회원은 바꿀 수 없고, 참석자가 아닌 사람을 넣을 수도 없다
    assert change(club, m["id"], "team1_player1", m["slot_ids"][2], as_="away").status_code == 403
    assert change(club, m["id"], "team1_player1", club.ids["out1"], as_="aaa").status_code == 400
    # 결과가 입력된 경기는 바꿀 수 없다
    club.c.post(f"/draw-matches/{m['id']}/result", json={"team1_score": 6, "team2_score": 2}, headers=club.admin)
    r = change(club, m["id"], "team1_player1", m["slot_ids"][2], as_="aaa")
    assert r.status_code == 409


def test_match_type_follows_new_lineup(club):
    genders = {"mm1": "male", "mm2": "male", "ww1": "female", "ww2": "female"}
    gid = setup(club, tuple(genders), courts=1, genders=genders)
    (m,) = generate(club, gid)["matches"]
    assert m["match_type"] == "mixed_doubles"
    ids = m["slot_ids"]  # [남, 여 | 남, 여] 구성
    man_team2 = next(u for u in ids[2:] if who(club, u).startswith("mm"))
    woman_team1 = next(u for u in ids[:2] if who(club, u).startswith("ww"))
    slot_of_woman = SLOTS[ids.index(woman_team1)]
    # 팀1 여자 자리에 팀2 남자를 넣으면 남남 vs 여여 → 잡복
    r = change(club, m["id"], slot_of_woman, man_team2, as_="mm1").json()
    assert r["matches"][0]["match_type"] == "open_doubles"
