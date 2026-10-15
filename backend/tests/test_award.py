"""대회 입상 별 개수: 관리자만 정하고, 회원 명단·참석 명단 어디서나 보인다."""


def test_admin_sets_award_stars(club):
    club.add_members("amy", "off")
    club.set_type("off", "officer")
    uid = club.ids["amy"]
    url = f"/admin/users/{uid}/award"
    r = club.c.put(url, json={"gold": 2, "silver": 1, "bronze": 1, "note": "  2026  OO오픈 우승 "}, headers=club.admin)
    assert r.status_code == 200
    me = r.json()
    assert (me["award_gold"], me["award_silver"], me["award_bronze"], me["award_note"]) == (2, 1, 1, "2026 OO오픈 우승")
    # 관리자만
    assert club.c.put(url, json={"gold": 1}, headers=club.h("off")).status_code == 403

    # 회원 명단·내 정보·참석 명단(UserBrief)에 보인다
    members = {u["username"]: u for u in club.c.get("/users", headers=club.h("off")).json()}
    assert members["amy"]["award_gold"] == 2
    assert club.c.get("/users/me", headers=club.h("amy")).json()["award_silver"] == 1
    gid = club.gathering(fee=0)
    club.vote(gid, "amy")
    brief = next(p["user"] for p in club.detail(gid)["participants"] if p["user"]["username"] == "amy")
    assert (brief["award_gold"], brief["award_silver"], brief["award_bronze"]) == (2, 1, 1)

    # 한도: 종류별 5개, 모두 합쳐 9개
    assert club.c.put(url, json={"gold": 6}, headers=club.admin).status_code == 422
    r = club.c.put(url, json={"gold": 5, "silver": 5}, headers=club.admin)
    assert r.status_code == 422 and "9개" in r.json()["detail"][0]["msg"]
    # 모두 0이면 이력도 지운다
    r = club.c.put(url, json={"note": "남은 글"}, headers=club.admin).json()
    assert (r["award_gold"], r["award_silver"], r["award_bronze"], r["award_note"]) == (0, 0, 0, None)
