"""이름만 적어 초대하는 게스트: 게스트와 같은 자리·대기·게스트비, 게스트 투표 시각부터, 초대 취소."""
from datetime import date, datetime, timedelta

# conftest.fixed_now: 2099-01-12(월) 09:00 → 01-15(목) 모임은 게스트 투표가 열려 있고 01-16(금) 모임은 아직(01-13 0시)
THU = "2099-01-15"
FRI = "2099-01-16"


def _invite(club, gid, who, name="홍길동", **extra):
    return club.c.post(f"/gatherings/{gid}/guests", json={"name": name, **extra}, headers=club.h(who))


def _people(club, gid):
    return {p["user"]["name"]: p for p in club.detail(gid)["participants"]}


def test_attendee_invites_guest_who_takes_a_seat(club, fixed_now):
    club.add_members("amy", "ben")
    g = club.create(kind="club_regular", event_date=THU, max_participants=2, bank="국민", account_number="1").json()
    club.vote(g["id"], "amy")

    r = _invite(club, g["id"], "amy", "  홍  길동 ", gender="male")
    assert r.status_code == 201
    guest = r.json()
    assert guest["status"] == "attending"
    assert (guest["user"]["name"], guest["user"]["member_type"], guest["user"]["invited_by_name"]) == (
        "홍 길동", "guest", "amy",
    )
    # 회원 명단에는 나오지 않는다
    names = {u["name"] for u in club.c.get("/users", headers=club.h("amy")).json()}
    assert "홍 길동" not in names
    # 오테식 모임: 초대 게스트도 게스트비를 낸다
    pay = club.detail(g["id"])["payment"]
    assert [(x["user"]["name"], x["amount"]) for x in pay["dues"]] == [("홍 길동", 5000)]
    # 정원(2명)이 찼으니 다음 초대는 대기
    assert _invite(club, g["id"], "amy", "김철수").json()["status"] == "waiting"
    # 회원도 대기로 (정원이 찼다)
    assert club.vote(g["id"], "ben").json()["status"] == "waiting"


def test_who_and_when_can_invite(club, fixed_now):
    club.add_members("amy", "ben", "off", "gus")
    club.set_type("off", "officer")
    club.set_type("gus", "guest")
    thu = club.gathering(fee=0, date=THU)
    fri = club.gathering(fee=0, date=FRI)
    club.vote(thu, "amy")
    club.vote(fri, "amy")

    assert _invite(club, thu, "ben").status_code == 403  # 참석하지 않은 회원
    assert club.vote(thu, "gus").status_code == 200
    assert _invite(club, thu, "gus").status_code == 403  # 게스트는 보기와 투표만
    # 게스트 투표 전(금요일 모임은 화요일 0시부터)에는 운영진만
    r = _invite(club, fri, "amy")
    assert r.status_code == 403 and "1월 13일(화) 0시부터" in r.json()["detail"]
    assert _invite(club, fri, "off").status_code == 201
    fixed_now["now"] = datetime(2099, 1, 13, 0, 0)
    assert _invite(club, fri, "amy").status_code == 201
    # 이름은 꼭
    assert _invite(club, thu, "amy", "   ").status_code == 422


def test_cancel_invite(club):
    """초대한 회원·운영진이 취소, 3일 전부터 참석 중인 게스트는 운영진만. 빠지면 대기자가 올라간다."""
    club.add_members("amy", "ben", "cal", "off")
    club.set_type("off", "officer")
    far = (date.today() + timedelta(days=10)).isoformat()
    soon = (date.today() + timedelta(days=1)).isoformat()
    gid = club.gathering(fee=0, date=far, max_participants=2)
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    guest = _invite(club, gid, "amy").json()["user"]
    assert _people(club, gid)["홍길동"]["status"] == "waiting"
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("ben")).status_code == 403
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("amy")).status_code == 204
    assert "홍길동" not in _people(club, gid)

    # 내일 모임: 참석 중인 초대 게스트는 운영진만 취소, 대기자가 올라간다
    gid = club.gathering(fee=0, date=soon, max_participants=2)
    club.vote(gid, "amy")
    guest = _invite(club, gid, "amy").json()["user"]
    club.vote(gid, "cal")
    assert _people(club, gid)["cal"]["status"] == "waiting"
    r = club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("amy"))
    assert r.status_code == 403 and "운영진" in r.json()["detail"]
    assert club.c.delete(f"/gatherings/{gid}/guests/{guest['id']}", headers=club.h("off")).status_code == 204
    assert _people(club, gid)["cal"]["status"] == "attending"
    # 가입한 회원은 이 경로로 뺄 수 없다
    r = club.c.delete(f"/gatherings/{gid}/guests/{club.ids['cal']}", headers=club.h("off"))
    assert r.status_code == 404




def test_games_with_guests_are_not_counted(club):
    """초대 게스트가 뛴 경기는 승·패 전적·파트너·상대·랭킹에 누적하지 않는다 (경기 기록은 남는다)."""
    club.add_members("aaa", "bbb", "ccc", "ddd")
    gid = club.create(kind="club_regular", court_count=1).json()["id"]
    for n in ("aaa", "bbb"):
        club.vote(gid, n)
    g1, g2 = (
        club.c.post(f"/gatherings/{gid}/guests", json={"name": n}, headers=club.admin).json()["user"]["id"]
        for n in ("홍길동", "김철수")
    )
    aaa, bbb, ccc, ddd = (club.ids[n] for n in ("aaa", "bbb", "ccc", "ddd"))

    def match(team1, team2, s1, s2):
        body = {
            "match_type": "mens_doubles", "played_at": "2099-01-15", "gathering_id": gid,
            "team1_score": s1, "team2_score": s2,
            "players": [{"user_id": u, "team": 1} for u in team1] + [{"user_id": u, "team": 2} for u in team2],
        }
        r = club.c.post("/matches", json=body, headers=club.admin)
        assert r.status_code == 201
        return r.json()["id"]

    match([aaa, bbb], [ccc, ddd], 6, 3)          # 회원끼리 → 누적
    guest_match = match([aaa, g1], [bbb, g2], 6, 4)  # 게스트가 낀 경기 → 누적하지 않음

    stats = club.c.get(f"/stats/users/{aaa}", headers=club.admin).json()
    assert (stats["overall"]["total"], stats["overall"]["wins"]) == (1, 1)
    partners = {r["partner"]["name"] for r in club.c.get(f"/stats/users/{aaa}/partners", headers=club.admin).json()}
    opponents = {r["opponent"]["name"] for r in club.c.get(f"/stats/users/{aaa}/opponents", headers=club.admin).json()}
    assert partners == {"bbb"} and opponents == {"ccc", "ddd"}
    ranking = {r["user"]["name"]: r["record"]["total"] for r in club.c.get("/stats/ranking", headers=club.admin).json()}
    assert ranking == {"aaa": 1, "bbb": 1, "ccc": 1, "ddd": 1}
    # 경기 기록 자체는 남아 있다
    assert club.c.get(f"/matches/{guest_match}", headers=club.admin).status_code == 200


def test_games_with_guests_are_not_rated(club):
    """대진표 결과로 계산하는 레이팅에도 초대 게스트가 뛴 경기는 넣지 않는다."""
    club.add_members("aaa", "bbb", "ccc", "ddd")

    def play(names, guests):
        gid = club.create(kind="club_regular", court_count=1).json()["id"]
        for n in names:
            club.vote(gid, n)
        for n in guests:  # 운영진(관리자)은 언제든 초대
            assert club.c.post(f"/gatherings/{gid}/guests", json={"name": n}, headers=club.admin).status_code == 201
        draw = club.c.post(f"/gatherings/{gid}/draws/generate",
                           json={"match_type": "mens_doubles", "rounds": 1}, headers=club.admin).json()
        dm = draw["matches"][0]
        assert club.c.post(f"/draw-matches/{dm['id']}/result",
                           json={"team1_score": 6, "team2_score": 3}, headers=club.admin).status_code == 200

    play(["aaa", "bbb"], ["홍길동", "김철수"])  # 게스트가 낀 대진 → 레이팅에 넣지 않음
    board = club.c.get("/admin/ratings", headers=club.admin).json()
    assert board["counted_matches"] == 0
    assert all(r["games"] == 0 for r in board["rows"])
    assert not {"홍길동", "김철수"} & {r["user"]["name"] for r in board["rows"]}

    play(["aaa", "bbb", "ccc", "ddd"], [])  # 회원끼리 → 반영
    board = club.c.get("/admin/ratings", headers=club.admin).json()
    assert board["counted_matches"] == 1
    assert {r["user"]["name"]: r["games"] for r in board["rows"] if r["games"]} == {
        "aaa": 1, "bbb": 1, "ccc": 1, "ddd": 1,
    }
