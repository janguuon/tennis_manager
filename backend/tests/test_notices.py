"""클럽 소식: 운영진이 올리고, 회원은 확인하기 전까지 새 소식으로 본다."""
from datetime import date, timedelta


def notices(club, as_=None, **params):
    return club.c.get("/notices", params=params, headers=club.h(as_)).json()


def test_staff_post_members_see_new_until_seen(club):
    club.add_members("mem", "off")
    club.set_type("off", "officer")
    body = {"kind": "celebrate", "title": "  김오테 OO오픈 우승!  ", "body": "축하해요 🎉"}
    assert club.c.post("/notices", json=body, headers=club.h("mem")).status_code == 403
    r = club.c.post("/notices", json=body, headers=club.h("off"))
    assert r.status_code == 201 and r.json()["title"] == "김오테 OO오픈 우승!"
    assert club.c.post("/notices", json={"title": " "}, headers=club.h("off")).status_code == 422

    assert not notices(club, "off")[0]["is_new"]  # 올린 사람에게는 새 소식이 아니다
    [n] = notices(club, "mem")
    assert n["is_new"] and n["kind"] == "celebrate" and n["author_name"]
    # 확인하면 새 소식이 아니다, 그 뒤에 올라온 소식만 새 소식
    assert club.c.post("/notices/seen", headers=club.h("mem")).status_code == 204
    assert not notices(club, "mem")[0]["is_new"]
    club.c.post("/notices", json={"title": "다음 주 정모 장소 변경"}, headers=club.admin)
    assert [x["is_new"] for x in notices(club, "mem")] == [True, False]

    # 지우기는 운영진만
    nid = n["id"]
    assert club.c.delete(f"/notices/{nid}", headers=club.h("mem")).status_code == 403
    assert club.c.delete(f"/notices/{nid}", headers=club.h("off")).status_code == 204
    assert len(notices(club, "mem")) == 1


def test_expired_notices_hidden_except_all_for_staff(club):
    club.add_members("mem")
    yesterday = str(date.today() - timedelta(days=1))
    club.c.post("/notices", json={"title": "지난 소식", "show_until": yesterday}, headers=club.admin)
    club.c.post("/notices", json={"title": "오늘까지", "show_until": str(date.today())}, headers=club.admin)
    assert [n["title"] for n in notices(club, "mem")] == ["오늘까지"]
    assert len(notices(club, "mem", all="true")) == 1  # 회원은 all이어도 게시 중인 것만
    assert len(notices(club, all="true")) == 2
