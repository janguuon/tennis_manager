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


def test_deactivated_member_leaves_ranking_but_records_stay(club):
    club.add_members("amy", "ben")
    match = {
        "match_type": "singles",
        "played_at": "2026-10-01",
        "team1_score": 6,
        "team2_score": 3,
        "players": [
            {"user_id": club.ids["amy"], "team": 1},
            {"user_id": club.ids["ben"], "team": 2},
        ],
    }
    assert club.c.post("/matches", json=match, headers=club.admin).status_code == 201

    r = club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin)
    assert r.json()["result"] == "deactivated"

    ranking = club.c.get("/stats/ranking", headers=club.admin).json()
    assert [row["user"]["username"] for row in ranking] == ["ben"]
    # ben의 전적에는 amy와의 경기가 그대로 남는다
    ben = club.c.get(f"/stats/users/{club.ids['ben']}", headers=club.admin).json()
    assert ben["overall"]["losses"] == 1


def test_cannot_delete_self_and_members_cannot_delete(club):
    club.add_members("amy")
    me = club.c.get("/users/me", headers=club.admin).json()["id"]
    r = club.c.delete(f"/admin/users/{me}", headers=club.admin)
    assert r.status_code == 400

    r = club.c.delete(f"/admin/users/{me}", headers=club.headers["amy"])
    assert r.status_code == 403
    assert club.c.delete("/admin/users/9999", headers=club.admin).status_code == 404
