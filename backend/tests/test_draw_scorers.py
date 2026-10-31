"""대진 점수 입력: 운영진(주최자·관리자·임원진)과 그 경기에 뛴 선수. 게스트와 안 뛴 회원은 못 한다."""
from test_ratings_api import PLAYERS, generate, record, setup_club


def _players(dm):
    return [u["username"] for u in dm["team1"] + dm["team2"]]


def test_match_players_record_edit_and_delete_score(club):
    gid = setup_club(club, courts=1)
    dm = generate(club, gid, rounds=1).json()["matches"][0]
    t1, t2 = [u["username"] for u in dm["team1"]], [u["username"] for u in dm["team2"]]
    bench = next(n for n in PLAYERS if n not in t1 + t2)
    url = f"/draw-matches/{dm['id']}/result"

    # 같은 모임에 왔어도 이 경기에 안 뛴 회원은 못 한다
    r = record(club, dm["id"], 6, 2, as_=bench)
    assert r.status_code == 403 and "뛴 선수" in r.json()["detail"]
    # 뛴 선수는 상대 팀이어도 입력·고치기·지우기를 한다
    r = record(club, dm["id"], 6, 2, as_=t1[0])
    assert r.status_code == 200 and (r.json()["team1_score"], r.json()["team2_score"]) == (6, 2)
    r = club.c.patch(url, json={"team1_score": 4, "team2_score": 6}, headers=club.h(t2[1]))
    assert r.status_code == 200 and r.json()["team2_score"] == 6
    assert club.c.patch(url, json={"team1_score": 6, "team2_score": 4}, headers=club.h(bench)).status_code == 403
    assert club.c.delete(url, headers=club.h(bench)).status_code == 403
    assert club.c.delete(url, headers=club.h(t2[0])).json()["result_match_id"] is None


def test_guest_player_only_views(club):
    gid = setup_club(club, courts=1, names=PLAYERS[:4])
    club.set_type("aaa", "guest")
    dm = generate(club, gid, rounds=1).json()["matches"][0]
    assert "aaa" in _players(dm)
    assert record(club, dm["id"], 6, 2, as_="aaa").status_code == 403
    assert record(club, dm["id"], 6, 2, as_="bbb").status_code == 200


def test_officers_record_scores_in_flash_too(club):
    """일반 벙개 대진은 벙주가 짜지만, 점수는 임원진도 입력한다."""
    names = PLAYERS[:6]
    club.add_members(*names, "off")
    club.set_type("off", "officer")
    gid = club.create(as_="aaa", kind="flash", court_count=1).json()["id"]
    for n in names:
        assert club.vote(gid, n).status_code == 200
    dm = generate(club, gid, as_="aaa", rounds=1).json()["matches"][0]
    bench = next(n for n in names if n not in _players(dm) and n != "aaa")

    assert generate(club, gid, as_="off", rounds=1).status_code == 403
    assert record(club, dm["id"], 6, 3, as_=bench).status_code == 403
    assert record(club, dm["id"], 6, 3, as_="off").status_code == 200
