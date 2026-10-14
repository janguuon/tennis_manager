"""대진 생성·결과 입력 → 내부 티어 반영 (오테식 모임 대진만), 관리자 전용 노출."""

PLAYERS = ("aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh")


def setup_club(club, kind="club_regular", courts=2, names=PLAYERS):
    club.add_members(*names)
    gid = club.create(kind=kind, court_count=courts).json()["id"]
    for n in names:
        assert club.vote(gid, n).status_code == 200
    return gid


def generate(club, gid, as_=None, **body):
    body = {"match_type": "mens_doubles", **body}
    return club.c.post(f"/gatherings/{gid}/draws/generate", json=body, headers=club.h(as_))


def record(club, dm_id, s1, s2, as_=None):
    return club.c.post(
        f"/draw-matches/{dm_id}/result",
        json={"team1_score": s1, "team2_score": s2},
        headers=club.h(as_),
    )


def board(club, as_=None):
    return club.c.get("/admin/ratings", headers=club.h(as_))


def test_generate_rounds_and_methods(club):
    gid = setup_club(club)
    r = generate(club, gid, method="balanced", rounds=3)
    assert r.status_code == 201
    draw = r.json()
    assert draw["generation_method"] == "balanced"
    assert len(draw["matches"]) == 6  # 2코트 × 3라운드
    assert {m["round_number"] for m in draw["matches"]} == {1, 2, 3}
    # 예전 이름 skill 은 balanced 로 저장
    assert generate(club, gid, method="skill").json()["generation_method"] == "balanced"
    # 기본(rounds 없음): 모임 시간이 없으면 2시간 기준 4라운드
    assert len(generate(club, gid).json()["matches"]) == 8
    # 혼복인데 성별이 없으면 안내
    r = generate(club, gid, match_type="mixed_doubles")
    assert r.status_code == 400 and "혼복" in r.json()["detail"]


def test_balance_visible_to_admin_only(club):
    gid = setup_club(club)
    draw = generate(club, gid, rounds=1).json()
    m = draw["matches"][0]
    assert m["balance"]["expected_team1"] == 0.5  # 모두 출발점이 같다
    assert set(m["balance"]["tiers"].values()) == {"C"}

    member_view = club.c.get(f"/gatherings/{gid}/draws", headers=club.h("aaa")).json()
    assert member_view[0]["matches"][0]["balance"] is None
    assert club.c.get(f"/draws/{draw['id']}", headers=club.h("aaa")).json()["matches"][0]["balance"] is None
    assert club.c.get(f"/gatherings/{gid}/draws", headers=club.admin).json()[0]["matches"][0]["balance"]


def test_tiers_board_is_admin_only(club):
    club.add_members("aaa", "bbb")
    club.set_type("aaa", "officer")
    assert board(club).status_code == 200
    assert board(club, "aaa").status_code == 403
    assert board(club, "bbb").status_code == 403
    assert club.c.get(f"/admin/ratings/{club.ids['bbb']}", headers=club.h("aaa")).status_code == 403


def test_club_draw_result_moves_ratings_and_needs_score(club):
    gid = setup_club(club)
    club.set_type("hhh", "guest")
    m = generate(club, gid, rounds=1).json()["matches"][0]

    r = record(club, m["id"], 0, 0)
    assert r.status_code == 400 and "7:6" in r.json()["detail"]
    r = record(club, m["id"], 6, 2)
    assert r.status_code == 200
    assert (r.json()["team1_score"], r.json()["team2_score"]) == (6, 2)

    b = board(club).json()
    assert b["counted_matches"] == 1
    rows = {row["user"]["id"]: row for row in b["rows"]}
    winners = [p["id"] for p in m["team1"]]
    losers = [p["id"] for p in m["team2"]]
    for uid in winners:
        assert rows[uid]["rating"] > 1000 and rows[uid]["wins"] == 1
        assert rows[uid]["provisional"] and rows[uid]["placement_left"] == 9
    for uid in losers:
        assert rows[uid]["rating"] < 1000 and rows[uid]["losses"] == 1
    # 아직 안 뛴 사람(게스트 포함)도 출발점으로 목록에 있다
    assert rows[club.ids["hhh"]]["user"]["member_type"] == "guest"
    assert b["rows"][0]["user"]["id"] in winners
    assert sum(b["tier_counts"].values()) == 4

    hist = club.c.get(f"/admin/ratings/{winners[0]}", headers=club.admin).json()
    (e,) = hist["events"]
    assert (e["games_for"], e["games_against"], e["outcome"]) == (6, 2, "win")
    assert [p["id"] for p in e["partners"]] == [winners[1]]
    assert sorted(p["id"] for p in e["opponents"]) == sorted(losers)
    assert e["expected"] == 0.5 and e["actual"] == 0.75

    # 친 경기의 예상 밸런스는 경기 직전 값으로 남는다
    played = club.c.get(f"/gatherings/{gid}/draws", headers=club.admin).json()[0]["matches"][0]
    assert played["balance"]["expected_team1"] == 0.5


def test_guest_is_rated(club):
    gid = setup_club(club, names=("aaa", "bbb", "ccc", "gst"), courts=1)
    club.set_type("gst", "guest")
    m = generate(club, gid).json()["matches"][0]
    record(club, m["id"], 5, 5)
    rows = {row["user"]["id"]: row for row in board(club).json()["rows"]}
    assert rows[club.ids["gst"]]["games"] == 1 and rows[club.ids["gst"]]["draws"] == 1


def test_only_club_draw_results_count(club):
    # 일반 벙개 대진 결과는 반영하지 않는다 (점수 없이도 입력 가능)
    flash = setup_club(club, kind="flash")
    m = generate(club, flash, rounds=1).json()["matches"][0]
    assert record(club, m["id"], 0, 0).status_code == 200
    m2 = generate(club, flash, rounds=1).json()["matches"][0]
    assert record(club, m2["id"], 6, 0).status_code == 200
    # 오테식 모임에 연결했더라도 직접 입력한 경기는 반영하지 않는다
    club_gid = club.create(kind="club_flash").json()["id"]
    r = club.c.post(
        "/matches",
        json={
            "match_type": "mens_doubles",
            "played_at": "2099-01-15",
            "team1_score": 6,
            "team2_score": 0,
            "gathering_id": club_gid,
            "players": [
                {"user_id": club.ids["aaa"], "team": 1},
                {"user_id": club.ids["bbb"], "team": 1},
                {"user_id": club.ids["ccc"], "team": 2},
                {"user_id": club.ids["ddd"], "team": 2},
            ],
        },
        headers=club.admin,
    )
    assert r.status_code == 201
    b = board(club).json()
    assert b["counted_matches"] == 0
    assert all(row["rating"] == 1000 and row["games"] == 0 for row in b["rows"])


def test_deleting_result_reverts_rating_and_reopens_draw(club):
    gid = setup_club(club)
    m = generate(club, gid, rounds=1).json()["matches"][0]
    match_id = record(club, m["id"], 6, 1).json()["result_match_id"]
    assert board(club).json()["counted_matches"] == 1

    # 점수 정정은 곧바로 다시 계산된다
    club.c.patch(f"/matches/{match_id}", json={"team1_score": 1, "team2_score": 6}, headers=club.admin)
    rows = {row["user"]["id"]: row for row in board(club).json()["rows"]}
    assert rows[m["team1"][0]["id"]]["rating"] < 1000

    assert club.c.delete(f"/matches/{match_id}", headers=club.admin).status_code == 204
    assert board(club).json()["counted_matches"] == 0
    again = club.c.get(f"/gatherings/{gid}/draws", headers=club.admin).json()[0]["matches"][0]
    assert again["result_match_id"] is None
    assert record(club, m["id"], 6, 4).status_code == 200


def test_canceled_gathering_excluded(club):
    gid = setup_club(club)
    m = generate(club, gid, rounds=1).json()["matches"][0]
    record(club, m["id"], 6, 3)
    club.c.patch(f"/gatherings/{gid}", json={"status": "canceled"}, headers=club.admin)
    assert board(club).json()["counted_matches"] == 0


def test_second_draw_avoids_first_draw_partners(club):
    gid = setup_club(club, names=("aaa", "bbb", "ccc", "ddd"), courts=1)
    first = generate(club, gid, rounds=1).json()["matches"][0]
    second = generate(club, gid, rounds=1).json()["matches"][0]
    first_pairs = {frozenset(p["id"] for p in first[t]) for t in ("team1", "team2")}
    second_pairs = {frozenset(p["id"] for p in second[t]) for t in ("team1", "team2")}
    assert not first_pairs & second_pairs


def test_officer_runs_club_draws_but_sees_no_tiers(club):
    gid = setup_club(club)
    club.set_type("aaa", "officer")
    r = generate(club, gid, as_="aaa", method="balanced")
    assert r.status_code == 201
    m = r.json()["matches"][0]
    assert m["balance"] is None
    assert record(club, m["id"], 6, 3, as_="aaa").status_code == 200
    # 정회원은 남의 오테식 모임 대진을 만들 수 없다
    assert generate(club, gid, as_="bbb").status_code == 403


def test_auto_types_and_rounds_from_gathering_time(club):
    """기본 대진: 성별로 남복·여복·혼복을 꾸리고, 2시간 모임이면 4라운드."""
    men = ("mm1", "mm2", "mm3", "mm4", "mm5", "mm6")
    women = ("ww1", "ww2", "ww3", "ww4", "ww5", "ww6")
    club.add_members(*men, *women)
    for n in men:
        club.c.patch("/users/me", json={"gender": "male"}, headers=club.h(n))
    for n in women:
        club.c.patch("/users/me", json={"gender": "female"}, headers=club.h(n))
    gid = club.create(
        kind="club_regular", court_count=2, start_time="19:00", end_time="21:00"
    ).json()["id"]
    for n in men + women:
        club.vote(gid, n)

    r = club.c.post(f"/gatherings/{gid}/draws/generate", json={}, headers=club.admin)
    assert r.status_code == 201
    matches = r.json()["matches"]
    assert {m["round_number"] for m in matches} == {1, 2, 3, 4}
    assert len(matches) == 8
    # 남녀 6명씩이면 잡복 없이 짤 수 있다
    assert {m["match_type"] for m in matches} <= {"mens_doubles", "womens_doubles", "mixed_doubles"}
    # 12명이 8자리 × 4라운드(32자리)를 나눠 뛰면 1인 2~3게임
    plays = {}
    for m in matches:
        for p in m["team1"] + m["team2"]:
            plays[p["id"]] = plays.get(p["id"], 0) + 1
    assert len(plays) == 12 and set(plays.values()) <= {2, 3}

    # 3시간 모임은 6라운드, 직접 고른 라운드 수가 우선
    club.c.patch(f"/gatherings/{gid}", json={"end_time": "22:00"}, headers=club.admin)
    assert len(club.c.post(f"/gatherings/{gid}/draws/generate", json={}, headers=club.admin).json()["matches"]) == 12
    r = club.c.post(f"/gatherings/{gid}/draws/generate", json={"rounds": 1}, headers=club.admin)
    assert len(r.json()["matches"]) == 2


def test_open_doubles_only_when_unavoidable(club):
    club.add_members("mm1", "mm2", "mm3", "ww1")
    for n in ("mm1", "mm2", "mm3"):
        club.c.patch("/users/me", json={"gender": "male"}, headers=club.h(n))
    club.c.patch("/users/me", json={"gender": "female"}, headers=club.h("ww1"))
    gid = club.create(kind="club_regular").json()["id"]
    for n in ("mm1", "mm2", "mm3", "ww1"):
        club.vote(gid, n)
    m = club.c.post(f"/gatherings/{gid}/draws/generate", json={"rounds": 1}, headers=club.admin).json()["matches"][0]
    assert m["match_type"] == "open_doubles"
    # 잡복 결과도 전적·티어에 반영된다
    r = club.c.post(f"/draw-matches/{m['id']}/result", json={"team1_score": 6, "team2_score": 4}, headers=club.admin)
    assert r.status_code == 200
    assert club.c.get("/admin/ratings", headers=club.admin).json()["counted_matches"] == 1
    by_type = club.c.get(f"/stats/users/{club.ids['ww1']}", headers=club.admin).json()["by_type"]
    assert [t["match_type"] for t in by_type] == ["open_doubles"]
