"""경기 취소: 못 친 경기를 점수·전적에 영향 없이 취소하고 되돌린다 (일반 대진·교류전)."""
from test_exchange_battle import OURS, _ex, _opponents, _post, _setup
from test_ratings_api import PLAYERS, generate, record, setup_club


def _stats(club, name):
    return club.c.get(f"/stats/users/{club.ids[name]}", headers=club.admin).json()["overall"]


def test_cancel_draw_match(club):
    gid = setup_club(club, courts=1)
    club.add_members("off")
    club.set_type("off", "officer")
    first, second = generate(club, gid, rounds=2).json()["matches"][:2]
    players = [u["username"] for u in first["team1"] + first["team2"]]
    bench = next(n for n in PLAYERS if n not in players)
    url = f"/draw-matches/{first['id']}/cancel"

    # 정회원(선수여도)은 못 하고, 임원진은 한다
    assert club.c.post(url, headers=club.h(players[0])).status_code == 403
    assert club.c.post(url, headers=club.h(bench)).status_code == 403
    r = club.c.post(url, headers=club.h("off"))
    assert r.status_code == 200 and r.json()["canceled"] is True
    # 취소한 경기는 점수를 받지 않는다 → 전적·레이팅 그대로
    assert record(club, first["id"], 6, 2).status_code == 409
    assert _stats(club, players[0])["total"] == 0
    draws = club.c.get(f"/gatherings/{gid}/draws", headers=club.admin).json()
    assert [m["canceled"] for m in draws[0]["matches"]][:2] == [True, False]

    # 되돌리면 다시 점수를 적는다
    r = club.c.delete(url, headers=club.admin)
    assert r.status_code == 200 and r.json()["canceled"] is False
    assert record(club, first["id"], 6, 2).status_code == 200
    # 점수가 들어간 경기는 취소할 수 없다 (결과를 먼저 지운다)
    assert club.c.post(url, headers=club.admin).status_code == 409
    assert _stats(club, players[0])["total"] == 1


def test_cancel_exchange_match(club):
    gid = _setup(club)
    _opponents(club, gid)
    d = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2}).json()
    first, second = d["matches"][0], d["matches"][1]
    assert d["total"] == 4

    assert _post(club, f"/{gid}/matches/{first['id']}/cancel", as_="kim").status_code == 403
    d = _post(club, f"/{gid}/matches/{first['id']}/cancel").json()
    m = d["matches"][0]
    # 점수판의 경기 수·남은 경기에서 빠지고, 점수·선수 바꾸기는 안 된다 (선수 자리는 남는다)
    assert (m["canceled"], m["can_score"], len(m["ours"])) == (True, False, 2)
    assert d["total"] == 3
    score = {"ours_score": 6, "theirs_score": 1}
    assert _post(club, f"/{gid}/matches/{first['id']}/result", score, method="put").status_code == 409
    body = {"ours_ids": [club.ids[OURS[0]]], "theirs_ids": [d["opponents"][0]["id"]]}
    assert _post(club, f"/{gid}/matches/{first['id']}", body, method="put").status_code == 409

    # 나머지 경기만 쳐도 마칠 수 있다
    for m in d["matches"][1:]:
        _post(club, f"/{gid}/matches/{m['id']}/result", score, method="put")
    d = _ex(club, gid).json()
    assert (d["played"], d["total"], d["score"]["ours_wins"]) == (3, 3, 3)

    # 되돌리면 다시 칠 경기 → 점수가 들어간 경기는 취소할 수 없다
    d = club.c.delete(f"/exchanges/{gid}/matches/{first['id']}/cancel", headers=club.admin).json()
    assert d["matches"][0]["canceled"] is False and d["total"] == 4
    assert _post(club, f"/{gid}/matches/{second['id']}/cancel").status_code == 409
    # 빈 코트는 취소할 경기가 없다
    d = _post(club, f"/{gid}/rounds", {"mode": "empty"}).json()
    empty = d["matches"][-1]["id"]
    assert _post(club, f"/{gid}/matches/{empty}/cancel").status_code == 400
    # 마친 교류전은 바꾸지 못한다
    _post(club, f"/{gid}/finish", {"announce": False})
    assert _post(club, f"/{gid}/matches/{first['id']}/cancel").status_code == 409
