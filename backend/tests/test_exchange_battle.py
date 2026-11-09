"""교류전 화면: 일정과 연결된 목록, 상대 명단, 코트 × 라운드 대진, 점수판, 마치기와 결과 소식."""
from collections import Counter

from app import exchange as X
from app.models import Gender

OURS = ("man1", "man2", "man3", "man4", "wom1", "wom2")


def _setup(club, courts="1~2", **body):
    """교류전 일정 + 참석자 (남 4 · 여 2). 회원 m*, w* 는 성별을 맞춰 둔다."""
    club.add_members(*OURS, "off", "kim")
    club.set_type("off", "officer")
    for n in OURS:
        club.c.patch("/users/me", json={"gender": "female" if n.startswith("w") else "male"}, headers=club.h(n))
    g = club.create(title="A클럽 교류전", kind="exchange", court_numbers=courts, start_time="19:00", end_time="21:00", **body)
    gid = g.json()["id"]
    for n in OURS:
        assert club.vote(gid, n).status_code == 200
    return gid


def _ex(club, gid, as_=None):
    return club.c.get(f"/exchanges/{gid}", headers=club.h(as_))


def _post(club, path, body=None, as_=None, method="post"):
    return getattr(club.c, method)(f"/exchanges{path}", json=body, headers=club.h(as_))


def test_list_follows_schedule_and_defaults(club):
    gid = _setup(club)
    club.create(title="그냥 벙개")
    listed = club.c.get("/exchanges", headers=club.h("kim")).json()
    assert [x["gathering_id"] for x in listed] == [gid]
    x = listed[0]
    assert (x["opponent_name"], x["ours_count"], x["theirs_count"], x["total"], x["winner"]) == ("A클럽", 6, 0, 0, None)

    d = _ex(club, gid, "kim").json()
    # 코트 수는 일정 면수(1~2 → 2면), 라운드는 모임 시간(2시간 → 4)
    assert (d["court_count"], d["rounds"], d["can_manage"]) == (2, 4, False)
    assert [p["user"]["name"] for p in d["ours"]] == list(OURS)
    # 교류전이 아닌 일정은 없다
    other = club.create(title="벙개").json()["id"]
    assert _ex(club, other).status_code == 404


def test_only_staff_manage(club):
    gid = _setup(club)
    club.add_members("gst")
    club.set_type("gst", "guest")
    # 게스트는 교류전 목록에 들어오지 않는다 (일정 화면의 점수판만)
    assert club.c.get("/exchanges", headers=club.h("gst")).status_code == 403
    # 공개된 교류전 일정이면 게스트도 점수판은 본다 (꾸리기·점수 적기는 못 한다)
    opened = club.create(title="B클럽 교류전", kind="exchange", open_now=True).json()["id"]
    d = _ex(club, opened, "gst")
    assert d.status_code == 200 and d.json()["can_manage"] is False
    assert _post(club, f"/{gid}/opponents", {"text": "홍길동 남"}, as_="kim").status_code == 403
    assert _post(club, f"/{gid}", {"opponent_name": "B클럽"}, as_="kim", method="patch").status_code == 403
    r = _post(club, f"/{gid}/opponents", {"text": "홍길동 남"}, as_="off")
    assert r.status_code == 200 and r.json()["can_manage"] is True


def test_opponents_paste_edit_remove(club):
    gid = _setup(club)
    r = _post(club, f"/{gid}/opponents", {"text": "홍길동 남, 김영희(여)\n박철수"})
    opp = r.json()["opponents"]
    assert [(o["name"], o["gender"]) for o in opp] == [("홍길동", "male"), ("김영희", "female"), ("박철수", None)]
    assert _post(club, f"/{gid}/opponents", {"text": " , "}).status_code == 400
    pid = opp[2]["id"]
    r = _post(club, f"/{gid}/opponents/{pid}", {"gender": "male", "name": "박 철수"}, method="patch")
    assert r.json()["opponents"][2] == {**opp[2], "gender": "male", "name": "박 철수"}
    r = club.c.delete(f"/exchanges/{gid}/opponents/{pid}", headers=club.admin)
    assert len(r.json()["opponents"]) == 2
    # 상대 선수는 일정 참가자가 아니다 (정산·출석에 없다)
    parts = club.c.get(f"/gatherings/{gid}/participants", headers=club.admin).json()
    assert {p["user"]["name"] for p in parts} == set(OURS)


def _opponents(club, gid, text="a1 남, a2 남, a3 남, a4 남, b1 여, b2 여, a5 남"):
    return _post(club, f"/{gid}/opponents", {"text": text}).json()


def test_draw_courts_by_rounds(club):
    gid = _setup(club)
    _opponents(club, gid)
    r = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 3})
    d = r.json()
    assert (d["court_count"], d["rounds"], len(d["matches"]), d["total"]) == (2, 3, 6, 6)
    assert [(m["round_number"], m["court"]) for m in d["matches"]] == [(r, c) for r in (1, 2, 3) for c in (1, 2)]
    played = Counter()
    for m in d["matches"]:
        assert len(m["ours"]) == 2 and len(m["theirs"]) == 2
        # 남 4·여 2 대 남 5·여 2: 성별이 안 맞는 경기는 없다
        assert m["match_type"] in ("mens_doubles", "womens_doubles", "mixed_doubles")
        played.update(p["id"] for p in m["ours"])
        # 한 라운드에 같은 사람이 두 번 뛰지 않는다
    for rnd in (1, 2, 3):
        ids = [p["id"] for m in d["matches"] if m["round_number"] == rnd for p in m["ours"]]
        assert len(ids) == len(set(ids))
    # 6명이 12자리: 다 같이 2경기
    assert sorted(played.values()) == [2] * 6

    # 사람이 모자라면 남는 코트는 빈칸 (우리 6명 → 3코트 중 3번째는 비어 있다)
    d = _post(club, f"/{gid}/draw", {"court_count": 4, "rounds": 1}).json()
    assert [len(m["ours"]) for m in d["matches"]] == [2, 2, 2, 0] and d["total"] == 3
    # 양쪽 2명이 안 되면 못 짠다
    other = club.create(title="B 교류전", kind="exchange").json()["id"]
    assert _post(club, f"/{other}/draw", {"court_count": 1, "rounds": 1}).status_code == 400


def test_lineup_and_redraw_round(club):
    gid = _setup(club)
    opp = _opponents(club, gid)["opponents"]
    d = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2}).json()
    first = d["matches"][0]
    ids = {u: club.ids[u] for u in OURS}
    # 직접 바꾸기: 단식 1:1
    r = _post(club, f"/{gid}/matches/{first['id']}", {"ours_ids": [ids["wom1"]], "theirs_ids": [opp[4]["id"]]}, method="put")
    m = r.json()["matches"][0]
    assert ([p["name"] for p in m["ours"]], [p["name"] for p in m["theirs"]], m["match_type"]) == (["wom1"], ["b1"], "singles")
    bad = [
        ({"ours_ids": [ids["man1"]], "theirs_ids": []}, 400),  # 수가 다르다
        ({"ours_ids": [ids["man1"], ids["man1"]], "theirs_ids": [opp[0]["id"], opp[1]["id"]]}, 400),
        ({"ours_ids": [club.ids["kim"]], "theirs_ids": [opp[0]["id"]]}, 400),  # 참석하지 않은 회원
        ({"ours_ids": [ids["man1"]], "theirs_ids": [999]}, 400),
    ]
    for body, code in bad:
        assert _post(club, f"/{gid}/matches/{first['id']}", body, method="put").status_code == code
    # 비우기
    r = _post(club, f"/{gid}/matches/{first['id']}", {"ours_ids": [], "theirs_ids": []}, method="put")
    assert r.json()["matches"][0]["ours"] == [] and r.json()["total"] == 3

    # 점수가 들어간 라운드는 다시 짤 수 없고, 다른 라운드는 된다
    second = d["matches"][1]
    _post(club, f"/{gid}/matches/{second['id']}/result", {"ours_score": 6, "theirs_score": 4}, method="put")
    assert _post(club, f"/{gid}/rounds/1/draw").status_code == 409
    assert _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2}).status_code == 409
    r = _post(club, f"/{gid}/rounds/2/draw")
    assert r.status_code == 200 and [m["round_number"] for m in r.json()["matches"]] == [1, 1, 2, 2]
    # 점수가 들어간 경기는 선수를 바꿀 수 없다
    body = {"ours_ids": [ids["man1"]], "theirs_ids": [opp[0]["id"]]}
    assert _post(club, f"/{gid}/matches/{second['id']}", body, method="put").status_code == 409
    # 점수가 들어간 경기에 뛴 상대 선수는 뺄 수 없다
    used = r.json()["matches"][1]["theirs"][0]["id"]
    assert club.c.delete(f"/exchanges/{gid}/opponents/{used}", headers=club.admin).status_code == 409


def _scores(club, gid, results, as_=None):
    d = _ex(club, gid).json()
    for m, (o, t) in zip([m for m in d["matches"] if m["ours"]], results):
        r = _post(club, f"/{gid}/matches/{m['id']}/result", {"ours_score": o, "theirs_score": t}, as_=as_, method="put")
        assert r.status_code == 200, r.text
    return _ex(club, gid).json()


def test_scoreboard_and_who_scores(club):
    gid = _setup(club)
    _opponents(club, gid)
    d = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2}).json()
    m = d["matches"][0]
    player = next(n for n in OURS if club.ids[n] in [p["id"] for p in m["ours"]])
    outsider = next(n for n in OURS if club.ids[n] not in [p["id"] for p in m["ours"]])
    url = f"/{gid}/matches/{m['id']}/result"
    assert _post(club, url, {"ours_score": 6, "theirs_score": 3}, as_=outsider, method="put").status_code == 403
    assert _post(club, url, {"ours_score": 0, "theirs_score": 0}, as_=player, method="put").status_code == 400
    r = _post(club, url, {"ours_score": 6, "theirs_score": 3}, as_=player, method="put").json()
    assert r["matches"][0]["can_score"] is True
    # 6:3 승, 4:6 패, 5:5 무, 6:2 승
    d = _scores(club, gid, [(6, 3), (4, 6), (5, 5), (6, 2)])
    assert d["score"] == {"ours_wins": 2, "theirs_wins": 1, "draws": 1, "ours_games": 21, "theirs_games": 16}
    assert (d["played"], d["total"], d["suggested_winner"]) == (4, 4, "ours")
    # 점수 지우기
    r = club.c.delete(f"/exchanges/{gid}/matches/{m['id']}/result", headers=club.admin).json()
    assert r["played"] == 3


def test_finish_announce_and_reopen(club):
    gid = _setup(club)
    _opponents(club, gid)
    _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2})
    _scores(club, gid, [(6, 3), (6, 4), (2, 6), (6, 1)])

    r = _post(club, f"/{gid}/finish", {"announce": True}, as_="kim")
    assert r.status_code == 403
    d = _post(club, f"/{gid}/finish", {"announce": True}).json()
    assert (d["winner"], d["announced"]) == ("ours", True) and d["finished_at"]
    pop = club.c.get("/notices", headers=club.h("kim")).json()
    assert pop[0]["kind"] == "celebrate" and pop[0]["title"] == "A클럽 교류전, 오테식 승리!"
    assert "오테식 3승 · A클럽 1승 (게임 20:14)" in pop[0]["body"] and "함께한 선수" in pop[0]["body"]

    # 마친 교류전은 점수·대진을 바꾸지 못한다
    m = d["matches"][0]
    assert _post(club, f"/{gid}/matches/{m['id']}/result", {"ours_score": 1, "theirs_score": 6}, method="put").status_code == 409
    assert _post(club, f"/{gid}/opponents", {"text": "c1 남"}).status_code == 409

    # 결과를 바꾸면 소식도 바뀐다: 상대 승 → 수고 인사
    d = _post(club, f"/{gid}/finish", {"winner": "theirs", "announce": True}).json()
    pop = club.c.get("/notices", headers=club.h("kim")).json()
    assert len(pop) == 1 and pop[0]["kind"] == "news" and pop[0]["title"] == "A클럽 교류전, A클럽 승리"
    # 알리지 않기 → 소식을 내린다
    d = _post(club, f"/{gid}/finish", {"winner": "theirs", "announce": False}).json()
    assert d["announced"] is False and club.c.get("/notices", headers=club.h("kim")).json() == []

    # 마치기 취소 → 결과와 소식이 없어지고 다시 고칠 수 있다
    _post(club, f"/{gid}/finish", {"winner": "draw", "announce": True})
    d = club.c.delete(f"/exchanges/{gid}/finish", headers=club.admin).json()
    assert (d["winner"], d["finished_at"], d["announced"]) == (None, None, False)
    assert club.c.get("/notices", headers=club.h("kim")).json() == []
    assert _post(club, f"/{gid}/matches/{m['id']}/result", {"ours_score": 1, "theirs_score": 6}, method="put").status_code == 200

    # 점수 없이 마치려면 결과를 골라야 한다
    other = club.create(title="교류전", kind="exchange").json()["id"]
    assert _post(club, f"/{other}/finish", {}).status_code == 400
    _post(club, f"/{other}", {"opponent_name": "B클럽"}, method="patch")
    _post(club, f"/{other}/finish", {"winner": "draw"})
    titles = [n["title"] for n in club.c.get("/notices", headers=club.h("kim")).json()]
    assert "B클럽 교류전, 무승부!" in titles


def test_schedule_links(club):
    gid = _setup(club)
    _opponents(club, gid)
    _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 1})
    # 대진이 있으면 교류전이 아닌 종류로 못 바꾸고, 교류전 기록을 지우면 바꿀 수 있다
    r = club.c.patch(f"/gatherings/{gid}", json={"kind": "club_regular"}, headers=club.admin)
    assert r.status_code == 400 and "교류전" in r.json()["detail"]
    assert club.c.patch(f"/gatherings/{gid}", json={"kind": "exchange_split"}, headers=club.admin).status_code == 200
    assert club.c.delete(f"/exchanges/{gid}", headers=club.admin).status_code == 204
    assert _ex(club, gid).json()["opponents"] == []

    # 불참으로 바뀐 선수는 표시된다
    _opponents(club, gid)
    d = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 1}).json()
    gone = d["matches"][0]["ours"][0]
    name = next(n for n in OURS if club.ids[n] == gone["id"])
    club.vote(gid, name, "absent")
    d = _ex(club, gid).json()
    assert d["matches"][0]["absent_ids"] == [gone["id"]] and len(d["ours"]) == 5

    # 취소된 일정은 점수를 적지 못한다
    club.c.post(f"/gatherings/{gid}/cancel", json={"reason": "우천"}, headers=club.admin)
    d = _ex(club, gid).json()
    assert d["canceled"] is True and not any(m["can_score"] for m in d["matches"])
    m = d["matches"][1]
    assert _post(club, f"/{gid}/matches/{m['id']}/result", {"ours_score": 6, "theirs_score": 1}, method="put").status_code == 409

    # 일정을 지우면 교류전 기록·결과 소식도 함께 없어진다
    other = club.create(title="C클럽 교류전", kind="exchange").json()["id"]
    _post(club, f"/{other}/finish", {"winner": "ours"})
    assert club.c.get("/notices", headers=club.h("kim")).json()
    assert club.c.delete(f"/gatherings/{other}", headers=club.admin).status_code == 204
    assert club.c.get("/notices", headers=club.h("kim")).json() == []
    assert _ex(club, other).status_code == 404


def test_generate_unit():
    """대진 짜기 규칙만: 덜 뛴 사람부터, 직전에 쉰 사람 먼저, 성별 구성 맞추기."""
    M, F = Gender.MALE, Gender.FEMALE
    ours = {1: M, 2: M, 3: F, 4: F, 5: M}
    theirs = {11: M, 12: M, 13: F, 14: F}
    rows = X.generate(ours, theirs, [1, 2, 3, 4, 5], 1)
    seen = Counter(u for r in rows for u in r["ours_ids"])
    assert max(seen.values()) - min(seen.values()) <= 1
    # 우리 5명이 1코트: 라운드마다 3명이 쉬고, 오래 쉰 사람이 먼저 들어간다 → 연속 3번 쉬는 사람은 없다
    by_round = [set(r["ours_ids"]) for r in rows]
    for u in ours:
        rests = "".join("r" if u not in s else "p" for s in by_round)
        assert "rrr" not in rests
    assert X.parse_opponents("홍길동남") == [("홍길동남", None)]
    # MVP: 가장 많이 이긴 사람, 같으면 게임 득실. 1승도 없으면 없다
    lines, _ = X.player_lines([([1, 2], [11, 12], 1, 6, 3), ([1, 3], [11, 13], 1, 6, 1), ([2, 3], [12, 13], 2, 2, 6)])
    assert X.mvp(lines) == [1]
    lines, _ = X.player_lines([([1, 2], [11, 12], 2, 2, 6)])
    assert X.mvp(lines) == []
    assert X.default_opponent("교류전 (B클럽)") == "B클럽"
