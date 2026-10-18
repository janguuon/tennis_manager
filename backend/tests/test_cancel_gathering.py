"""모임 취소: 운영진·모임을 만든 사람이 사유와 함께 취소, 취소하면 투표를 멈추고, 되돌릴 수 있다."""
from datetime import datetime

from conftest import FAR_MONTH


def _cancel(club, gid, as_=None, reason="우천으로 코트 사용 불가"):
    return club.c.post(f"/gatherings/{gid}/cancel", json={"reason": reason}, headers=club.h(as_))


def _restore(club, gid, as_=None):
    return club.c.delete(f"/gatherings/{gid}/cancel", headers=club.h(as_))


def test_staff_cancels_with_reason(club):
    club.add_members("amy", "off")
    club.set_type("off", "officer")
    gid = club.create(kind="club_regular").json()["id"]
    club.vote(gid, "amy")

    # 사유는 꼭
    r = _cancel(club, gid, "off", reason="   ")
    assert r.status_code == 422 and "사유" in r.json()["detail"][0]["msg"]
    # 임원진이 취소: 상태·사유(공백 정리)·시각
    r = _cancel(club, gid, "off", reason="  비 예보로   우천 취소 ")
    assert r.status_code == 200
    g = r.json()
    assert (g["status"], g["cancel_reason"]) == ("canceled", "비 예보로 우천 취소")
    assert g["canceled_at"].startswith("2099-01-12T09:00")
    # 회원도 목록·상세에서 사유를 본다. 투표 기록은 남는다
    rows = club.c.get(f"/gatherings?date_from={FAR_MONTH}-01&date_to={FAR_MONTH}-31", headers=club.h("amy")).json()
    assert next(x["cancel_reason"] for x in rows if x["id"] == gid) == "비 예보로 우천 취소"
    assert club.detail(gid)["attendance"]["attending"] == 1
    # 두 번 취소는 안 된다
    assert _cancel(club, gid).status_code == 400


def test_who_can_cancel(club):
    club.add_members("amy", "ben", "gus", "tre")
    club.set_type("gus", "guest")
    club.set_type("tre", "treasurer")
    club_gid = club.create(kind="club_regular").json()["id"]
    # 정회원·게스트는 오테식 모임을 취소할 수 없다
    assert _cancel(club, club_gid, "amy").status_code == 403
    assert _cancel(club, club_gid, "gus").status_code == 403
    # 총무(운영진)는 된다
    assert _cancel(club, club_gid, "tre").status_code == 200

    # 일반 벙개: 만든 사람은 자기 벙개를 취소·되돌리기, 다른 회원은 안 된다
    flash = club.create(as_="amy", kind="flash", court_fee=20000).json()["id"]
    assert _cancel(club, flash, "ben").status_code == 403
    assert _cancel(club, flash, "amy").status_code == 200
    assert _restore(club, flash, "ben").status_code == 403
    assert _restore(club, flash, "amy").status_code == 200


def test_club_gathering_cancel_is_staff_only(club):
    """오테식 모임은 올린 사람이라도 운영진이 아니면 취소할 수 없다."""
    club.add_members("off", "amy")
    club.set_type("off", "officer")
    # 임원진이 올린 오테식 벙개 → 그 사람이 정회원이 되면 취소할 수 없다
    gid = club.create(as_="off", kind="club_flash").json()["id"]
    club.set_type("off", "member")
    assert _cancel(club, gid, "off").status_code == 403
    # 회원이 올린 일반 벙개를 오테식 벙개로 바꾸면 올린 회원은 취소할 수 없다
    flash = club.create(as_="amy", kind="flash").json()["id"]
    club.c.patch(f"/gatherings/{flash}", json={"kind": "club_flash"}, headers=club.admin)
    r = _cancel(club, flash, "amy")
    assert r.status_code == 403 and "운영진" in r.json()["detail"]
    assert _cancel(club, flash).status_code == 200  # 관리자


def test_canceled_gathering_stops_votes(club):
    club.add_members("amy", "ben")
    gid = club.gathering(fee=0)
    club.vote(gid, "amy")
    assert _cancel(club, gid).status_code == 200

    r = club.vote(gid, "ben")
    assert r.status_code == 400 and "취소된 모임" in r.json()["detail"]
    assert club.c.delete(f"/gatherings/{gid}/attendance", headers=club.h("amy")).status_code == 400
    r = club.c.put(f"/gatherings/{gid}/participants/{club.ids['ben']}/attendance",
                   json={"status": "attending"}, headers=club.admin)
    assert r.status_code == 400
    assert club.c.post(f"/gatherings/{gid}/guests", json={"name": "홍길동"}, headers=club.admin).status_code == 400


def test_restore_and_edit_rules(club):
    club.add_members("amy")
    gid = club.gathering(fee=0)
    # 수정 창에서 바로 '취소'로 바꿀 수는 없다 (사유가 없으니)
    r = club.c.patch(f"/gatherings/{gid}", json={"status": "canceled"}, headers=club.admin)
    assert r.status_code == 400 and "모임 취소" in r.json()["detail"]
    assert _restore(club, gid).status_code == 400  # 취소된 모임이 아니다

    assert _cancel(club, gid).status_code == 200
    r = _restore(club, gid)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["cancel_reason"], r.json()["canceled_at"]) == ("planned", None, None)
    assert club.vote(gid, "amy").json()["status"] == "attending"  # 다시 투표할 수 있다

    # 수정 창에서 취소를 풀어도 사유는 지운다
    assert _cancel(club, gid).status_code == 200
    r = club.c.patch(f"/gatherings/{gid}", json={"status": "planned"}, headers=club.admin).json()
    assert (r["status"], r["cancel_reason"]) == ("planned", None)


def test_paid_become_refunds_and_finished_can_be_canceled(club, fixed_now):
    club.add_members("amy", "ben")
    gid = club.gathering(fee=20000, bank="국민", account_number="1")
    club.vote(gid, "amy")
    club.vote(gid, "ben")
    assert club.pay(gid, "amy").status_code == 200
    assert _cancel(club, gid).status_code == 200
    pay = club.detail(gid)["payment"]
    assert pay["dues"] == []  # 더 받을 돈은 없다
    assert [(x["user"]["username"], x["amount"]) for x in pay["refunds"]] == [("amy", 10000)]

    # 비로 못 했는데 앱에서 미처 취소하지 못해 자동 '완료'가 된 모임도 나중에 취소할 수 있다
    done = club.gathering(fee=0)
    fixed_now["now"] = datetime(2099, 1, 16, 9, 0)
    assert club.detail(done)["status"] == "completed"
    r = _cancel(club, done)
    assert (r.status_code, r.json()["status"]) == (200, "canceled")
    # 되돌리면 지난 모임이라 다시 완료
    assert _restore(club, done).json()["status"] == "completed"
