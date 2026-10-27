"""코트 취소: 코트비 대신 취소 수수료만 회비에서 지급한다 (지급 전, 운영진). 0원이면 지급할 것 없음."""
from conftest import FAR_MONTH


def _cancel(club, bid, fee, as_=None):
    return club.c.put(f"/court-bookings/{bid}/cancel", json={"fee": fee}, headers=club.h(as_))


def _restore(club, bid, as_=None):
    return club.c.delete(f"/court-bookings/{bid}/cancel", headers=club.h(as_))


def _setup(club):
    club.add_members("kim", "lee", "off", "tre")
    club.set_type("off", "officer")
    club.set_type("tre", "treasurer")
    gid = club.create(
        kind="club_regular",
        court_bookings=[
            {"booker_id": club.ids["kim"], "amount": 24000, "court_label": "3번"},
            {"booker_id": club.ids["lee"], "amount": 20000, "court_label": "5번"},
        ],
    ).json()["id"]
    kim_b, lee_b = (b["id"] for b in club.detail(gid)["court_bookings"])
    return gid, kim_b, lee_b


def test_cancel_court_with_fee(club):
    gid, kim_b, lee_b = _setup(club)

    # 운영진만 (정회원은 안 된다)
    assert _cancel(club, kim_b, 3000, "kim").status_code == 403
    r = _cancel(club, kim_b, 3000, "off")
    assert r.status_code == 200
    b = r.json()
    assert (b["canceled"], b["amount"], b["court_fee"], b["cancel_fee"]) == (True, 3000, 24000, 3000)
    first_at = b["canceled_at"]
    # 다시 보내면 수수료만 고친다 (취소 시각은 그대로)
    b = _cancel(club, kim_b, 5000, "off").json()
    assert (b["amount"], b["canceled_at"]) == (5000, first_at)
    # 모임의 회비 지출 합계도 수수료 기준
    assert club.detail(gid)["court_total"] == 5000 + 20000

    # 수수료 없이 취소: 지급할 것이 없어 지급 대기·내가 받을 코트비에서 빠지고 지급 처리도 안 된다
    assert _cancel(club, lee_b, 0, "off").json()["amount"] == 0
    pending = {x["id"] for x in club.c.get("/court-bookings", headers=club.h("tre")).json()}
    assert pending == {kim_b}
    assert club.c.get("/court-bookings/me", headers=club.h("lee")).json() == []
    r = club.c.put(f"/court-bookings/{lee_b}/reimbursement", json={"reimbursed": True}, headers=club.h("tre"))
    assert r.status_code == 400 and "0원" in r.json()["detail"]
    r = club.c.put("/court-bookings/reimbursement", json={"booking_ids": [kim_b, lee_b], "reimbursed": True},
                   headers=club.h("tre"))
    assert r.status_code == 400

    # 월 정산의 회비 지출도 수수료 기준
    month = club.summary(FAR_MONTH)
    assert (month["court_total"], month["court_pending"]) == (5000, 5000)

    # 되돌리면 다시 원래 코트비
    b = _restore(club, lee_b, "off").json()
    assert (b["canceled"], b["amount"], b["cancel_fee"]) == (False, 20000, 0)


def test_cannot_cancel_reimbursed_court(club):
    gid, kim_b, _ = _setup(club)
    _cancel(club, kim_b, 3000, "off")
    # 수수료 지급 뒤에는 지급 취소 전까지 고칠 수 없다
    assert club.c.put(f"/court-bookings/{kim_b}/reimbursement", json={"reimbursed": True},
                      headers=club.h("tre")).json()["amount"] == 3000
    assert _cancel(club, kim_b, 0, "off").status_code == 400
    assert _restore(club, kim_b, "off").status_code == 400
