"""탈퇴 회원 완전 삭제: 탈퇴 처리된 회원만, 기록까지 DB 에서 지운다."""


def _match(club, t1, t2, s1=6, s2=3):
    body = {"match_type": "mens_doubles" if len(t1) == 2 else "singles", "played_at": "2026-10-01",
            "team1_score": s1, "team2_score": s2,
            "players": [{"user_id": club.ids[n], "team": 1} for n in t1]
            + [{"user_id": club.ids[n], "team": 2} for n in t2]}
    return club.c.post("/matches", json=body, headers=club.admin).json()["id"]


def test_only_withdrawn_members_can_be_purged(club):
    club.add_members("amy")
    r = club.c.delete(f"/admin/users/{club.ids['amy']}/purge", headers=club.admin)
    assert r.status_code == 400 and "탈퇴 처리" in r.json()["detail"]
    club.add_members("ben")
    assert club.c.delete(f"/admin/users/{club.ids['amy']}/purge", headers=club.headers["ben"]).status_code == 403


def test_purge_removes_records_and_keeps_others_intact(club):
    club.add_members("amy", "ben", "cal", "dan", "eve")
    # amy: 경기 2건(복식·단식), 오테식 모임 코트비 지급 내역, 참석·입금, 일반 벙개 주최, 대진 자리
    m_with_amy = _match(club, ["amy", "ben"], ["cal", "dan"])
    _match(club, ["amy"], ["eve"])
    m_without = _match(club, ["ben", "eve"], ["cal", "dan"])
    flash = club.c.post("/gatherings", json={"title": "amy 벙개", "event_date": "2099-01-15", "kind": "flash",
                                             "court_fee": 20000}, headers=club.headers["amy"]).json()["id"]
    club.vote(flash, "amy")
    club.pay(flash, "amy")
    regular = club.create(kind="club_regular", court_count=1,
                          court_bookings=[{"booker_id": club.ids["amy"], "amount": 24000}]).json()["id"]
    for n in ("amy", "ben", "cal", "dan"):
        club.vote(regular, n)
    draw = club.c.post(f"/gatherings/{regular}/draws/generate", json={"rounds": 1}, headers=club.admin).json()
    dm = draw["matches"][0]
    club.c.post(f"/draw-matches/{dm['id']}/result", json={"team1_score": 6, "team2_score": 4}, headers=club.admin)

    assert club.c.delete(f"/admin/users/{club.ids['amy']}", headers=club.admin).json()["result"] == "deactivated"
    preview = club.c.get("/admin/users/inactive/purge-preview", headers=club.admin).json()
    (p,) = preview
    assert (p["name"], p["matches"], p["court_bookings"], p["gatherings_created"], p["draw_seats"]) == ("amy", 3, 1, 1, 1)
    assert p["participations"] >= 2 and p["paid"] == 1

    r = club.c.delete(f"/admin/users/{club.ids['amy']}/purge", headers=club.admin)
    assert r.status_code == 200 and r.json()["purged"][0]["name"] == "amy"

    # 회원과 그 경기들은 사라지고, 다른 회원끼리 친 경기는 그대로
    assert club.c.get("/admin/users/inactive", headers=club.admin).json() == []
    assert club.c.get(f"/matches/{m_with_amy}", headers=club.admin).status_code == 404
    assert club.c.get(f"/matches/{m_without}", headers=club.admin).status_code == 200
    ben = club.c.get(f"/stats/users/{club.ids['ben']}", headers=club.admin).json()["overall"]
    assert ben["total"] == 1
    # 만든 모임은 관리자에게, 코트비 지급 내역·대진 자리·결과 연결은 정리
    g = club.c.get(f"/gatherings/{flash}", headers=club.admin).json()
    assert g["created_by"] == club.c.get("/users/me", headers=club.admin).json()["id"]
    assert all(pp["user"]["username"] != "amy" for pp in g["participants"])
    assert club.c.get(f"/gatherings/{regular}", headers=club.admin).json()["court_bookings"] == []
    after = club.c.get(f"/gatherings/{regular}/draws", headers=club.admin).json()[0]["matches"][0]
    assert club.ids["amy"] not in after["slot_ids"] and None in after["slot_ids"]
    # 아이디가 비어서 다시 가입할 수 있다
    r = club.c.post("/auth/signup", json={"username": "amy", "password": "1234", "name": "amy"})
    assert r.status_code == 201


def test_purge_all_withdrawn(club):
    club.add_members("amy", "ben", "cal")
    _match(club, ["amy"], ["ben"])
    _match(club, ["ben"], ["cal"])
    for n in ("amy", "ben"):
        assert club.c.delete(f"/admin/users/{club.ids[n]}", headers=club.admin).json()["result"] == "deactivated"
    r = club.c.delete("/admin/users/inactive/purge", headers=club.admin)
    assert sorted(p["name"] for p in r.json()["purged"]) == ["amy", "ben"]
    assert club.c.get("/admin/users/inactive", headers=club.admin).json() == []
    assert {u["username"] for u in club.c.get("/users", headers=club.admin).json()} == {"admin1", "cal"}
