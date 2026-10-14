"""회원 삭제(완전 삭제 / 기록 보존 탈퇴)와 복구."""


def _users(club):
    return {u["username"] for u in club.c.get("/users", headers=club.admin).json()}


def test_no_history_member_is_fully_deleted(club):
    club.add_members("amy", "ben")
    gid = club.gathering(fee=10000)
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    assert club.detail(gid)["per_person"] == 5000

    r = club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin)
    assert r.status_code == 200
    assert r.json() == {"result": "deleted", "name": "amy"}

    assert "amy" not in _users(club)
    # 미입금 참석 기록도 지워져 1인 금액이 다시 계산된다
    assert club.detail(gid)["per_person"] == 10000
    # 같은 아이디로 다시 가입할 수 있다
    r = club.c.post("/auth/signup", json={"username": "amy", "password": "1234", "name": "amy"})
    assert r.status_code == 201


def test_member_with_history_is_deactivated_and_restorable(club):
    club.add_members("amy", "ben")
    gid = club.gathering(fee=10000)
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    club.pay(gid, "amy")  # 입금 기록 = 지우면 정산이 깨지는 기록

    r = club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin)
    assert r.json() == {"result": "deactivated", "name": "amy"}

    # 로그인·기존 토큰 모두 막히고, 회원 목록에서 빠진다
    login = club.c.post("/auth/login", data={"username": "amy", "password": "1234"})
    assert login.status_code == 403
    assert "탈퇴" in login.json()["detail"]
    assert club.c.get("/users/me", headers=club.headers["amy"]).status_code == 401
    assert "amy" not in _users(club)

    # 앞으로의 모임 참석은 불참으로 바뀌고, 낸 돈은 돌려줄 참가비로 잡힌다
    detail = club.detail(gid)
    amy = next(p for p in detail["participants"] if p["user"]["id"] == club.ids["amy"])
    assert amy["status"] == "absent"
    assert [x["user"]["id"] for x in detail["payment"]["refunds"]] == [club.ids["amy"]]
    assert detail["per_person"] == 10000

    inactive = club.c.get("/admin/users/inactive", headers=club.admin).json()
    assert [u["username"] for u in inactive] == ["amy"]

    # 복구하면 다시 로그인할 수 있다
    r = club.c.post(f"/admin/users/{club.ids['amy']}/restore", headers=club.admin)
    assert r.status_code == 200 and r.json()["is_active"] is True
    assert club.c.post("/auth/login", data={"username": "amy", "password": "1234"}).status_code == 200
    assert "amy" in _users(club)


def _doubles(club, t1, t2, s1, s2, played_at="2026-10-01"):
    match = {
        "match_type": "mens_doubles",
        "played_at": played_at,
        "team1_score": s1,
        "team2_score": s2,
        "players": [{"user_id": club.ids[n], "team": 1} for n in t1]
        + [{"user_id": club.ids[n], "team": 2} for n in t2],
    }
    assert club.c.post("/matches", json=match, headers=club.admin).status_code == 201


def _stats(club, name, part=""):
    return club.c.get(f"/stats/users/{club.ids[name]}{part}", headers=club.admin).json()


def test_withdrawn_members_matches_are_excluded_and_restored(club):
    club.add_members("amy", "ben", "cal", "dan", "eve")
    # amy 가 낀 경기(파트너·상대 모두) 2개 + amy 없는 경기 1개
    _doubles(club, ["amy", "ben"], ["cal", "dan"], 6, 3)
    _doubles(club, ["ben", "cal"], ["amy", "eve"], 6, 4)
    _doubles(club, ["ben", "eve"], ["cal", "dan"], 2, 6)
    assert _stats(club, "ben")["overall"]["total"] == 3

    r = club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin)
    assert r.json()["result"] == "deactivated"

    # amy 와 함께했거나 맞선 경기는 다시 계산할 때 빠진다
    ben = _stats(club, "ben")["overall"]
    assert (ben["wins"], ben["losses"], ben["total"]) == (0, 1, 1)
    assert {p["partner"]["username"] for p in _stats(club, "ben", "/partners")} == {"eve"}
    assert {o["opponent"]["username"] for o in _stats(club, "ben", "/opponents")} == {"cal", "dan"}
    ranking = club.c.get("/stats/ranking", headers=club.admin).json()
    assert {row["user"]["username"] for row in ranking} == {"ben", "cal", "dan", "eve"}
    assert {row["user"]["username"]: row["record"]["total"] for row in ranking}["cal"] == 1

    # 복구하면 경기 기록이 그대로 있어서 다시 반영된다
    club.c.post(f"/admin/users/{club.ids['amy']}/restore", headers=club.admin)
    assert _stats(club, "ben")["overall"]["total"] == 3
    assert "amy" in {o["opponent"]["username"] for o in _stats(club, "ben", "/opponents")}


def test_withdrawn_members_club_games_leave_tiers(club):
    club.add_members("amy", "ben", "cal", "dan")
    gid = club.create(kind="club_regular").json()["id"]
    for n in ("amy", "ben", "cal", "dan"):
        club.vote(gid, n)
    draw = club.c.post(
        f"/gatherings/{gid}/draws/generate", json={"match_type": "mens_doubles"}, headers=club.admin
    ).json()
    dm = draw["matches"][0]
    club.c.post(f"/draw-matches/{dm['id']}/result", json={"team1_score": 6, "team2_score": 1}, headers=club.admin)
    board = club.c.get("/admin/ratings", headers=club.admin).json()
    assert board["counted_matches"] == 1

    club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin)
    board = club.c.get("/admin/ratings", headers=club.admin).json()
    assert board["counted_matches"] == 0
    assert all(row["rating"] == 1000 and row["games"] == 0 for row in board["rows"])
    assert "amy" not in {row["user"]["username"] for row in board["rows"]}


def test_cannot_delete_self_and_members_cannot_delete(club):
    club.add_members("amy")
    me = club.c.get("/users/me", headers=club.admin).json()["id"]
    r = club.c.delete(f"/admin/users/{me}", headers=club.admin)
    assert r.status_code == 400

    r = club.c.delete(f"/admin/users/{me}", headers=club.headers["amy"])
    assert r.status_code == 403
    assert club.c.delete("/admin/users/9999", headers=club.admin).status_code == 404


def test_records_are_admin_only(club):
    """승률·전적은 당분간 관리자만: 임원진·정회원은 자기 전적도 못 본다."""
    club.add_members("amy", "ben", "cal", "dan")
    club.set_type("amy", "officer")
    _doubles(club, ["amy", "ben"], ["cal", "dan"], 6, 3)
    match_id = club.c.get("/matches", headers=club.admin).json()[0]["id"]
    for who in ("amy", "ben"):
        h = club.headers[who]
        me = club.ids[who]
        for path in (
            f"/stats/users/{me}",
            f"/stats/users/{me}/partners",
            f"/stats/users/{me}/opponents",
            "/stats/ranking",
            "/matches",
            f"/matches/{match_id}",
        ):
            assert club.c.get(path, headers=h).status_code == 403, (who, path)
        # 프로필은 그대로 볼 수 있다
        assert club.c.get(f"/users/{club.ids['cal']}", headers=h).status_code == 200
    assert _stats(club, "amy")["overall"]["wins"] == 1


def test_username_nickname_duplicates_ignore_case_and_spaces(club):
    c = club.c
    r = c.post("/auth/signup", json={"username": "Tesik", "password": "1234", "name": "테식", "nickname": "테식이"})
    assert r.status_code == 201 and r.json()["user"]["username"] == "tesik"  # 소문자로 저장
    # 대소문자만 다른 아이디, 공백만 다른 닉네임은 중복
    r = c.post("/auth/signup", json={"username": "tesik", "password": "1234", "name": "다른"})
    assert r.status_code == 409 and "아이디" in r.json()["detail"]
    r = c.post("/auth/signup", json={"username": "other", "password": "1234", "name": "다른", "nickname": " 테식이 "})
    assert r.status_code == 409 and "닉네임" in r.json()["detail"]
    r = c.post("/auth/signup", json={"username": "other2", "password": "1234", "name": "또", "nickname": "ABC"})
    assert r.status_code == 201
    r = c.post("/auth/signup", json={"username": "other3", "password": "1234", "name": "또또", "nickname": "abc"})
    assert r.status_code == 409

    for p in c.get("/admin/signups/pending", headers=club.admin).json():
        c.post(f"/admin/signups/{p['id']}/approve", headers=club.admin)
    # 휴대폰이 첫 글자를 대문자로 바꿔도 로그인된다
    for typed in ("tesik", "Tesik", "TESIK", " tesik"):
        assert c.post("/auth/login", data={"username": typed, "password": "1234"}).status_code == 200, typed

    # 프로필 닉네임 변경도 같은 규칙, 내 닉네임은 그대로 저장 가능, 빈 칸이면 지우기
    h = club._login("tesik")
    assert c.patch("/users/me", json={"nickname": "abc "}, headers=h).status_code == 409
    assert c.patch("/users/me", json={"nickname": "테식이"}, headers=h).status_code == 200
    assert c.patch("/users/me", json={"nickname": ""}, headers=h).json()["nickname"] is None


def test_signup_rules_answer_in_korean(club):
    c = club.c
    r = c.post("/auth/signup", json={"username": "테식", "password": "1234", "name": "테식"})
    assert r.status_code == 422 and "한글" in r.json()["detail"][0]["msg"]
    r = c.post("/auth/signup", json={"username": "ㅅㄷ냐ㅏ", "password": "1234", "name": "테식"})
    assert "한/영" in r.json()["detail"][0]["msg"]
    r = c.post("/auth/signup", json={"username": "ab", "password": "1234", "name": "테식"})
    assert "3자 이상" in r.json()["detail"][0]["msg"]
    r = c.post("/auth/signup", json={"username": "te sik", "password": "1234", "name": "테식"})
    assert "띄어쓰기" in r.json()["detail"][0]["msg"]
    r = c.post("/auth/signup", json={"username": "tesik", "password": "12", "name": "테식"})
    assert r.json()["detail"][0]["msg"] == "비밀번호는 4자 이상이어야 해요."
    assert c.post("/auth/signup", json={"username": "te_si.k-1", "password": "1234", "name": "테식"}).status_code == 201
