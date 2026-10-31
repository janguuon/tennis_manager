"""대진 결과 고치기·지우기: 점수를 입력할 수 있는 사람만, 전적·티어에 바로 반영된다."""
from test_ratings_api import PLAYERS, generate, record, setup_club


def _stats(club, name):
    return club.c.get(f"/stats/users/{club.ids[name]}", headers=club.admin).json()["overall"]


def test_edit_and_delete_recorded_result(club):
    gid = setup_club(club, courts=1)
    club.add_members("off")
    club.set_type("off", "officer")
    dm = generate(club, gid, rounds=1).json()["matches"][0]
    t1 = [u["username"] for u in dm["team1"]]
    assert record(club, dm["id"], 6, 2).status_code == 200
    assert _stats(club, t1[0])["wins"] == 1

    url = f"/draw-matches/{dm['id']}/result"
    # 이 경기에 안 뛴 정회원은 못 고친다, 임원진은 고친다
    bench = next(n for n in PLAYERS if n not in t1 + [u["username"] for u in dm["team2"]])
    assert club.c.patch(url, json={"team1_score": 3, "team2_score": 6}, headers=club.h(bench)).status_code == 403
    r = club.c.patch(url, json={"team1_score": 3, "team2_score": 6}, headers=club.h("off"))
    assert r.status_code == 200 and (r.json()["team1_score"], r.json()["team2_score"]) == (3, 6)
    # 승패가 뒤집혀 전적에 바로 반영
    s = _stats(club, t1[0])
    assert (s["wins"], s["losses"], s["total"]) == (0, 1, 1)
    # 오테식 모임은 0:0 으로 고칠 수 없다
    assert club.c.patch(url, json={"team1_score": 0, "team2_score": 0}, headers=club.admin).status_code == 400
    board = club.c.get("/admin/ratings", headers=club.admin).json()
    assert board["counted_matches"] == 1

    # 지우면 전적에서 빠지고, 다시 입력할 수 있다
    r = club.c.delete(url, headers=club.admin)
    assert r.status_code == 200 and r.json()["result_match_id"] is None
    assert _stats(club, t1[0])["total"] == 0
    assert club.c.delete(url, headers=club.admin).status_code == 404
    assert record(club, dm["id"], 6, 4).status_code == 200
    assert _stats(club, t1[0])["wins"] == 1
