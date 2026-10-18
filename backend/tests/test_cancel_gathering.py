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


def _cancel_fee(club, gid, fee, as_=None):
    return club.c.put(f"/gatherings/{gid}/cancel-fee", json={"fee": fee}, headers=club.h(as_))


def test_cancel_fee_flash_split_among_attendees(club):
    """일반 벙개: 취소 정산 금액(예: 코트 위약금)을 참석자끼리 1/n. 이미 낸 돈과 차액을 다시 계산한다."""
    club.add_members("amy", "ben", "cal", "dan")
    gid = club.create(as_="amy", kind="flash", court_fee=20000, bank="국민", account_number="1").json()["id"]
    for n in ("amy", "ben", "cal"):
        club.vote(gid, n)
    assert club.pay(gid, "ben").status_code == 200  # 6,700원 (20,000 ÷ 3)

    # 취소 전에는 정할 수 없다
    assert _cancel_fee(club, gid, 12000).status_code == 400
    assert _cancel(club, gid, "amy").status_code == 200
    pay = club.detail(gid)["payment"]
    assert pay["dues"] == [] and [(x["user"]["username"], x["amount"]) for x in pay["refunds"]] == [("ben", 6700)]

    # 다른 회원은 못 정하고, 올린 사람(벙주)은 정한다
    assert _cancel_fee(club, gid, 12000, "dan").status_code == 403
    r = _cancel_fee(club, gid, 12000, "amy")
    assert (r.status_code, r.json()["cancel_fee"], r.json()["per_person"]) == (200, 12000, 4000)
    pay = club.detail(gid)["payment"]
    assert sorted((x["user"]["username"], x["amount"]) for x in pay["dues"]) == [("amy", 4000), ("cal", 4000)]
    assert [(x["user"]["username"], x["amount"]) for x in pay["refunds"]] == [("ben", 2700)]  # 6,700 - 4,000
    assert (pay["fee"], pay["expected"]) == (12000, 12000)
    # 내 참가비·월 정산에도 나온다
    assert [(d["gathering_id"], d["amount"]) for d in club.my_dues("cal")] == [(gid, 4000)]
    month = next(x for x in club.summary(FAR_MONTH)["gatherings"] if x["id"] == gid)
    assert (month["status"], month["expected"], month["cancel_reason"]) == ("canceled", 12000, "우천으로 코트 사용 불가")
    # 입금 처리는 취소 정산 금액으로
    assert club.pay(gid, "cal").status_code == 200
    assert next(p for p in club.detail(gid)["participants"] if p["user"]["username"] == "cal")["paid_amount"] == 4000

    # 0원으로 되돌리면 받을 돈이 없어지고 낸 돈은 모두 돌려줄 돈
    _cancel_fee(club, gid, 0, "amy")
    pay = club.detail(gid)["payment"]
    assert pay["dues"] == [] and sorted(x["amount"] for x in pay["refunds"]) == [4000, 6700]
    # 되돌리기(취소 해제)하면 취소 정산 금액도 지운다
    _cancel_fee(club, gid, 9000, "amy")
    assert _restore(club, gid, "amy").json()["cancel_fee"] == 0


def test_cancel_fee_free_flash_and_club_guest(club):
    club.add_members("amy", "ben", "gst", "gs2", "off")
    club.set_type("gst", "guest")
    club.set_type("gs2", "guest")
    club.set_type("off", "officer")
    # 무료 벙개라도 취소 정산 금액이 생기면 정산 대상
    free = club.gathering(fee=0)
    club.vote(free, "amy")
    club.vote(free, "ben")
    _cancel(club, free)
    assert club.detail(free)["payment"] is None
    _cancel_fee(club, free, 9000)
    assert [x["amount"] for x in club.detail(free)["payment"]["dues"]] == [4500, 4500]

    # 오테식 모임: 취소하면 게스트비 0원, 취소 정산 금액은 게스트 1인 금액 (면제한 게스트는 0)
    gid = club.create(kind="club_regular", bank="국민", account_number="1").json()["id"]
    for n in ("amy", "gst", "gs2"):
        club.vote(gid, n)
    club.c.put(f"/gatherings/{gid}/participants/{club.ids['gs2']}/fee-waiver",
               json={"waived": True, "reason": "초대"}, headers=club.admin)
    _cancel(club, gid, "off")
    assert club.detail(gid)["payment"] is None
    assert _cancel_fee(club, gid, 2000, "amy").status_code == 403  # 오테식 모임은 운영진만
    assert _cancel_fee(club, gid, 2000, "off").status_code == 200
    pay = club.detail(gid)["payment"]
    assert ([(x["user"]["username"], x["amount"]) for x in pay["dues"]], pay["guest_fee"]) == ([("gst", 2000)], 2000)
