"""대회: 청백전(팀장·인원 수·직접 넣기·나머지 랜덤 배정, 경기·점수)과 단식·복식 토너먼트(짝, 대진표, 부전승, 진출)."""
from collections import Counter


def _join(club, *names, gender="male"):
    """성별을 정해 가입·승인 (club.add_members 는 모두 남자)."""
    for n in names:
        club.c.post("/auth/signup", json={"gender": gender, "username": n, "password": "1234", "name": n})
    for s in club.c.get("/admin/signups/pending", headers=club.admin).json():
        club.c.post(f"/admin/signups/{s['id']}/approve", headers=club.admin)
    for n in names:
        club.headers[n] = club._login(n)
        club.ids[n] = club.c.get("/users/me", headers=club.headers[n]).json()["id"]


def _create(club, kind, as_=None, **body):
    r = club.c.post("/tournaments", json={"title": "가을 대회", "kind": kind, **body}, headers=club.h(as_))
    assert r.status_code == 201, r.text
    return r.json()


def _add(club, tid, *names, team=None):
    body = {"user_ids": [club.ids[n] for n in names]}
    if team:
        body["team"] = team
    r = club.c.post(f"/tournaments/{tid}/players", json=body, headers=club.admin)
    assert r.status_code == 200, r.text
    return r.json()


def _entry_of(t, club, name):
    return next(e for e in t["entries"] if club.ids[name] in [p["id"] for p in e["players"]])


def _teams(t):
    return {
        team: sorted(p["username"] for e in t["entries"] if e["team"] == team for p in e["players"])
        for team in ("blue", "white", None)
    }


def _patch_entry(club, t, name, as_=None, **body):
    e = _entry_of(t, club, name)
    return club.c.patch(f"/tournaments/{t['id']}/entries/{e['id']}", json=body, headers=club.h(as_))


def test_who_sees_and_runs_tournaments(club):
    club.add_members("off", "mem", "gus")
    club.set_type("off", "officer")
    club.set_type("gus", "guest")
    t = _create(club, "team_battle", as_="off")
    assert t["can_manage"] is True
    # 정회원은 보기만, 게스트는 대회 화면을 보지 않는다
    r = club.c.post("/tournaments", json={"title": "x", "kind": "singles"}, headers=club.h("mem"))
    assert r.status_code == 403
    assert club.c.get(f"/tournaments/{t['id']}", headers=club.h("mem")).json()["can_manage"] is False
    r = club.c.post(f"/tournaments/{t['id']}/players", json={"user_ids": [club.ids["mem"]]}, headers=club.h("mem"))
    assert r.status_code == 403
    assert club.c.get("/tournaments", headers=club.h("gus")).status_code == 403
    assert [x["title"] for x in club.c.get("/tournaments", headers=club.h("mem")).json()] == ["가을 대회"]
    # 운영진이 고치고 지운다
    r = club.c.patch(f"/tournaments/{t['id']}", json={"title": "청백전", "blue_size": 4}, headers=club.h("off"))
    assert (r.json()["title"], r.json()["blue_size"]) == ("청백전", 4)
    assert club.c.delete(f"/tournaments/{t['id']}", headers=club.h("mem")).status_code == 403
    assert club.c.delete(f"/tournaments/{t['id']}", headers=club.h("off")).status_code == 204
    assert club.c.get("/tournaments", headers=club.h("mem")).json() == []


def test_team_battle_captains_manual_then_random_fill(club):
    men = ["man1", "man2", "man3", "man4", "man5", "man6"]
    women = ["wom1", "wom2", "wom3", "wom4"]
    _join(club, *men)
    _join(club, *women, gender="female")
    t = _create(club, "team_battle", blue_size=5, white_size=5)
    t = _add(club, t["id"], *men, *women)
    assert _teams(t)[None] == sorted(men + women)

    # 팀장: 팀에 넣으면서 정한다. 한 명은 직접 청팀에
    t = _patch_entry(club, t, "man1", team="blue", is_captain=True).json()
    t = _patch_entry(club, t, "wom1", team="white", is_captain=True).json()
    t = _patch_entry(club, t, "man2", team="blue").json()
    # 팀이 없는 사람은 팀장이 될 수 없다
    assert _patch_entry(club, t, "man3", is_captain=True).status_code == 400

    r = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin)
    assert r.status_code == 200
    t = r.json()
    teams = _teams(t)
    assert len(teams["blue"]) == len(teams["white"]) == 5 and teams[None] == []
    assert {"man1", "man2"} <= set(teams["blue"]) and "wom1" in teams["white"]
    # 여자 4명이 한쪽에 몰리지 않는다
    assert sum(n in women for n in teams["blue"]) == sum(n in women for n in teams["white"]) == 2
    assert not _entry_of(t, club, "man2")["random_pick"] and _entry_of(t, club, "man3")["random_pick"]

    # 다시 돌려도 직접 넣은 사람과 팀장은 그대로
    for _ in range(3):
        t = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin).json()
        teams = _teams(t)
        assert {"man1", "man2"} <= set(teams["blue"]) and "wom1" in teams["white"]
        assert len(teams["blue"]) == len(teams["white"]) == 5
    captains = {e["team"]: e["players"][0]["username"] for e in t["entries"] if e["is_captain"]}
    assert captains == {"blue": "man1", "white": "wom1"}

    # 팀장을 바꾸면 그 팀의 전 팀장은 내려온다
    other = next(n for n in _teams(t)["blue"] if n not in ("man1", "man2"))
    t = _patch_entry(club, t, other, is_captain=True).json()
    assert {e["players"][0]["username"] for e in t["entries"] if e["is_captain"] and e["team"] == "blue"} == {other}
    # 팀을 옮기면 팀장이 풀린다
    t = _patch_entry(club, t, "wom1", team="blue").json()
    assert not _entry_of(t, club, "wom1")["is_captain"]


def test_random_fill_sizes(club):
    names = [f"pp{i}" for i in range(7)]
    _join(club, *names)
    # 인원 수를 정하지 않으면 반씩 (홀수면 한쪽이 한 명 더)
    t = _create(club, "team_battle")
    _add(club, t["id"], *names)
    t = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin).json()
    assert sorted(len(_teams(t)[k]) for k in ("blue", "white")) == [3, 4]

    # 한 팀만 정하면 다른 팀이 나머지를 받는다
    t = _create(club, "team_battle", blue_size=2)
    _add(club, t["id"], *names)
    t = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin).json()
    assert (len(_teams(t)["blue"]), len(_teams(t)["white"])) == (2, 5)

    # 둘 다 정하면 그만큼만, 남는 사람은 팀 없음으로
    t = _create(club, "team_battle", blue_size=2, white_size=3)
    _add(club, t["id"], *names)
    t = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin).json()
    assert [len(_teams(t)[k]) for k in ("blue", "white", None)] == [2, 3, 2]
    # 이미 다 찼으면 다시 돌릴 사람만 다시 (자리가 아예 없으면 안내)
    t = club.c.patch(f"/tournaments/{t['id']}", json={"blue_size": 1, "white_size": 1}, headers=club.admin).json()
    for n in names[:2]:
        _patch_entry(club, t, n, team="blue")
    for n in names[2:4]:
        t = _patch_entry(club, t, n, team="white").json()
    r = club.c.post(f"/tournaments/{t['id']}/teams/random", headers=club.admin)
    assert r.status_code == 400 and "인원 수를 늘려" in r.json()["detail"]


def test_team_battle_matches_and_scores(club):
    blue, white = ["blu1", "blu2", "blu3", "blu4", "blu5"], ["whi1", "whi2", "whi3", "whi4", "whi5"]
    _join(club, *blue, *white, "mem")
    t = _create(club, "team_battle")
    _add(club, t["id"], *blue, team="blue")
    t = _add(club, t["id"], *white, team="white")
    t = _patch_entry(club, t, "blu1", team="blue", is_captain=True).json()
    tid = t["id"]
    url = f"/tournaments/{tid}/matches"

    # 팀장이 직접 짠다 (팀이 맞아야), 팀장이 아닌 회원은 못 짠다
    body = {"blue_ids": [club.ids["blu1"], club.ids["blu2"]], "white_ids": [club.ids["whi1"], club.ids["whi2"]]}
    assert club.c.post(url, json=body, headers=club.h("blu3")).status_code == 403
    wrong = {"blue_ids": [club.ids["blu1"], club.ids["whi3"]], "white_ids": [club.ids["whi1"], club.ids["whi2"]]}
    assert club.c.post(url, json=wrong, headers=club.h("blu1")).status_code == 400
    uneven = {"blue_ids": [club.ids["blu1"]], "white_ids": [club.ids["whi1"], club.ids["whi2"]]}
    assert club.c.post(url, json=uneven, headers=club.h("blu1")).status_code == 400
    t = club.c.post(url, json=body, headers=club.h("blu1")).json()
    [first] = t["matches"]
    assert first["match_type"] == "mens_doubles"

    # 랜덤으로 한 라운드: 5 대 5 복식이면 두 판, 아직 안 뛴 사람이 먼저 들어간다
    r = club.c.post(f"{url}/random", json={"match_type": "doubles"}, headers=club.h("blu1"))
    assert r.status_code == 200
    t = r.json()
    rnd = [m for m in t["matches"] if m["id"] != first["id"]]
    assert len(rnd) == 2 and {m["round_number"] for m in rnd} == {2}
    played = {p["username"] for m in rnd for p in m["team1"] + m["team2"]}
    assert {"blu3", "blu4", "blu5", "whi3", "whi4", "whi5"} <= played
    assert all({p["username"][0] for p in m["team1"]} == {"b"} for m in rnd)
    assert all({p["username"][0] for p in m["team2"]} == {"w"} for m in rnd)

    # 점수: 그 경기 선수·팀장·운영진. 안 뛴 회원은 못 적는다
    res = f"{url}/{first['id']}/result"
    assert club.c.put(res, json={"team1_score": 6, "team2_score": 4}, headers=club.h("mem")).status_code == 403
    assert club.c.put(res, json={"team1_score": 0, "team2_score": 0}, headers=club.h("whi1")).status_code == 400
    t = club.c.put(res, json={"team1_score": 6, "team2_score": 4}, headers=club.h("whi1")).json()
    assert t["score"]["blue_wins"] == 1 and t["played"] == 1 and t["total"] == 3
    m2, m3 = rnd
    t = club.c.put(f"{url}/{m2['id']}/result", json={"team1_score": 3, "team2_score": 6}, headers=club.h("blu1")).json()
    t = club.c.put(f"{url}/{m3['id']}/result", json={"team1_score": 5, "team2_score": 5}, headers=club.admin).json()
    assert t["score"] == {"blue_wins": 1, "white_wins": 1, "draws": 1, "blue_games": 14, "white_games": 15}
    # 고치기·지우기
    t = club.c.put(res, json={"team1_score": 2, "team2_score": 6}, headers=club.h("whi2")).json()
    assert (t["score"]["blue_wins"], t["score"]["white_wins"]) == (0, 2)
    t = club.c.delete(res, headers=club.h("whi2")).json()
    assert t["played"] == 2
    assert club.c.delete(res, headers=club.h("whi2")).status_code == 404
    # 팀장이 경기를 뺀다
    t = club.c.delete(f"{url}/{m3['id']}", headers=club.h("blu1")).json()
    assert len(t["matches"]) == 2


def _bracket(club, tid):
    r = club.c.post(f"/tournaments/{tid}/bracket", headers=club.admin)
    assert r.status_code == 200, r.text
    return r.json()


def _result(club, t, m, s1, s2, as_=None):
    return club.c.put(
        f"/tournaments/{t['id']}/matches/{m['id']}/result",
        json={"team1_score": s1, "team2_score": s2},
        headers=club.h(as_),
    )


def _round(t, r):
    return [m for m in t["matches"] if m["round_number"] == r]


def test_singles_bracket_byes_advance_and_champion(club):
    names = ["aaa", "bbb", "ccc", "ddd", "eee"]
    _join(club, *names, "mem")
    t = _create(club, "singles")
    tid = t["id"]
    assert club.c.post(f"/tournaments/{tid}/bracket", headers=club.admin).status_code == 400  # 아무도 없음
    _add(club, tid, *names)
    t = _bracket(club, tid)
    # 5명 → 8강 자리: 1라운드 4경기 중 3경기가 부전승, 4강·결승
    assert t["rounds"] == 3 and [len(_round(t, r)) for r in (1, 2, 3)] == [4, 2, 1]
    byes = [m for m in _round(t, 1) if m["bye"]]
    assert len(byes) == 3 and all(m["winner"] == 1 for m in byes)
    assert t["total"] == 4 and t["played"] == 0
    # 부전승은 다음 라운드에 올라가 있다
    semi_players = [p["username"] for m in _round(t, 2) for p in m["team1"] + m["team2"]]
    assert len(semi_players) == 3
    assert club.c.post(f"/tournaments/{tid}/bracket", headers=club.admin).status_code == 409
    assert club.c.post(f"/tournaments/{tid}/players", json={"user_ids": [club.ids["mem"]]}, headers=club.admin).status_code == 409

    [real] = [m for m in _round(t, 1) if not m["bye"]]
    p1, p2 = real["team1"][0]["username"], real["team2"][0]["username"]
    assert _result(club, t, byes[0], 6, 0).status_code == 400  # 부전승엔 점수 없음
    assert _result(club, t, real, 6, 4, as_="mem").status_code == 403  # 안 뛴 회원
    assert _result(club, t, real, 5, 5, as_=p1).status_code == 400  # 토너먼트는 승부가 나야
    t = _result(club, t, real, 4, 6, as_=p1).json()
    semi = next(m for m in _round(t, 2) if m["position"] == real["position"] // 2)
    side = semi["team1"] if real["position"] % 2 == 0 else semi["team2"]
    assert [p["username"] for p in side] == [p2]
    # 아직 상대가 없는 결승엔 점수를 못 적는다
    [final] = _round(t, 3)
    assert _result(club, t, final, 6, 0).status_code == 400

    # 4강 → 결승
    for m in _round(t, 2):
        t = _result(club, t, m, 6, 3).json()
    [final] = _round(t, 3)
    assert final["can_score"] is True and len(final["team1"]) == len(final["team2"]) == 1
    finalist1 = final["team1"][0]["username"]
    t = _result(club, t, final, 6, 2).json()
    assert [p["username"] for p in t["champion"]] == [finalist1]
    listed = club.c.get("/tournaments", headers=club.h("mem")).json()[0]
    assert [p["username"] for p in listed["champion"]] == [finalist1]

    # 결승 결과가 있으면 4강 승자를 바꿀 수 없다 (같은 승자로 점수만 고치는 건 된다)
    s0 = _round(t, 2)[0]
    assert _result(club, t, s0, 3, 6).status_code == 409
    assert club.c.delete(f"/tournaments/{tid}/matches/{s0['id']}/result", headers=club.admin).status_code == 409
    assert _result(club, t, s0, 7, 5).status_code == 200
    # 결승 결과를 지우면 4강 승자를 바꿀 수 있고, 결승 자리도 바뀐다
    t = club.c.delete(f"/tournaments/{tid}/matches/{final['id']}/result", headers=club.admin).json()
    assert t["champion"] is None
    t = _result(club, t, s0, 3, 6).json()
    [final] = _round(t, 3)
    assert final["team1"][0]["username"] == _round(t, 2)[0]["team2"][0]["username"]

    # 대진표를 지우면 참가자는 남고 다시 추첨할 수 있다
    t = club.c.delete(f"/tournaments/{tid}/bracket", headers=club.admin).json()
    assert t["matches"] == [] and t["players"] == 5
    _add(club, tid, "mem")
    t = _bracket(club, tid)
    assert len(_round(t, 1)) == 4 and sum(m["bye"] for m in _round(t, 1)) == 2


def test_doubles_pairs_manual_random_and_bracket(club):
    men, women = ["man1", "man2", "man3", "man4"], ["wom1", "wom2", "wom3"]
    _join(club, *men)
    _join(club, *women, gender="female")
    t = _create(club, "doubles")
    tid = t["id"]
    t = _add(club, tid, *men, *women)
    assert len(t["entries"]) == 7

    # 직접 짝 (m1·m2)
    a, b = _entry_of(t, club, "man1"), _entry_of(t, club, "man2")
    t = club.c.post(f"/tournaments/{tid}/pairs", json={"entry_ids": [a["id"], b["id"]]}, headers=club.admin).json()
    manual = _entry_of(t, club, "man1")
    assert sorted(p["username"] for p in manual["players"]) == ["man1", "man2"] and not manual["random_pick"]
    # 이미 짝이 있는 사람과는 다시 묶지 않는다
    c = _entry_of(t, club, "man3")
    r = club.c.post(f"/tournaments/{tid}/pairs", json={"entry_ids": [manual["id"], c["id"]]}, headers=club.admin)
    assert r.status_code == 400

    # 나머지 랜덤: 남 2·여 3 → 혼복 짝 둘, 여자 한 명이 남는다
    for _ in range(3):
        t = club.c.post(f"/tournaments/{tid}/pairs/random", headers=club.admin).json()
        pairs = [e for e in t["entries"] if len(e["players"]) == 2]
        assert len(pairs) == 3
        assert sorted(p["username"] for p in _entry_of(t, club, "man1")["players"]) == ["man1", "man2"]
        mixed = [e for e in pairs if e["random_pick"]]
        assert all(sorted(p["gender"] for p in e["players"]) == ["female", "male"] for e in mixed)
    [alone] = [e for e in t["entries"] if len(e["players"]) == 1]
    r = club.c.post(f"/tournaments/{tid}/bracket", headers=club.admin)
    assert r.status_code == 400 and alone["players"][0]["name"] in r.json()["detail"]

    # 짝 풀기 → 둘 다 짝 없는 참가자로, 혼자 남은 사람은 빼고 대진표
    t = club.c.post(f"/tournaments/{tid}/entries/{manual['id']}/split", headers=club.admin).json()
    assert len([e for e in t["entries"] if len(e["players"]) == 1]) == 3
    t = club.c.delete(f"/tournaments/{tid}/entries/{alone['id']}", headers=club.admin).json()
    m1, m2 = _entry_of(t, club, "man1"), _entry_of(t, club, "man2")
    t = club.c.post(f"/tournaments/{tid}/pairs", json={"entry_ids": [m1["id"], m2["id"]]}, headers=club.admin).json()
    t = _bracket(club, tid)
    assert t["rounds"] == 2 and t["total"] == 2 and sum(m["bye"] for m in _round(t, 1)) == 1
    # 복식 경기는 두 명씩, 그 팀 두 사람 모두 점수를 적을 수 있다
    [real] = [m for m in _round(t, 1) if not m["bye"]]
    assert len(real["team1"]) == len(real["team2"]) == 2
    partner = real["team2"][1]["username"]
    assert _result(club, t, real, 2, 6, as_=partner).status_code == 200


def test_member_in_tournament_is_deactivated_then_purged(club):
    _join(club, "aaa", "bbb", "ccc")
    t = _create(club, "doubles")
    t = _add(club, t["id"], "aaa", "bbb", "ccc")
    a, b = _entry_of(t, club, "aaa"), _entry_of(t, club, "bbb")
    club.c.post(f"/tournaments/{t['id']}/pairs", json={"entry_ids": [a["id"], b["id"]]}, headers=club.admin)
    # 대회에 들어 있으면 지우지 않고 탈퇴 처리
    r = club.c.delete(f"/admin/users/{club.ids['aaa']}", headers=club.admin)
    assert r.json()["result"] == "deactivated"
    assert club.c.delete(f"/admin/users/{club.ids['aaa']}/purge", headers=club.admin).status_code == 200
    t = club.c.get(f"/tournaments/{t['id']}", headers=club.admin).json()
    # 짝은 남고 지운 회원 자리만 빈다
    assert Counter(len(e["players"]) for e in t["entries"]) == Counter({1: 2})
    assert {p["username"] for e in t["entries"] for p in e["players"]} == {"bbb", "ccc"}


def test_random_team_battle_round_avoids_mismatched_doubles(club):
    """랜덤 복식은 성별 구성이 맞게 짠다: 청·백 모두 남2·여2면 잡복 없이 남복·여복이나 혼복."""
    _join(club, "bm1", "bm2", "wm1", "wm2")
    _join(club, "bf1", "bf2", "wf1", "wf2", gender="female")
    t = _create(club, "team_battle")
    _add(club, t["id"], "bm1", "bm2", "bf1", "bf2", team="blue")
    _add(club, t["id"], "wm1", "wm2", "wf1", "wf2", team="white")
    for _ in range(5):
        t = club.c.post(f"/tournaments/{t['id']}/matches/random", json={"match_type": "doubles"}, headers=club.admin).json()
    assert len(t["matches"]) == 10
    assert Counter(m["match_type"] for m in t["matches"])["open_doubles"] == 0
