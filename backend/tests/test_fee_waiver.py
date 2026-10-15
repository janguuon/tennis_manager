"""게스트비 면제: 관리자·총무만, 오테식 모임의 게스트만. 면제하면 받을 돈에서 빠지고, 이미 냈으면 돌려줄 돈."""
from conftest import FAR_MONTH


def _waive(club, gid, name, waived=True, as_=None, reason="당일 인원 부족 무료 모집"):
    return club.c.put(
        f"/gatherings/{gid}/participants/{club.ids[name]}/fee-waiver",
        json={"waived": waived, "reason": reason if waived else None},
        headers=club.h(as_),
    )


def _dues(club, gid):
    return sorted((x["user"]["username"], x["amount"]) for x in club.detail(gid)["payment"]["dues"])


def test_waive_guest_fee(club):
    club.add_members("kim", "gst", "gs2", "tre", "off")
    club.set_type("gst", "guest")
    club.set_type("gs2", "guest")
    club.set_type("tre", "treasurer")
    club.set_type("off", "officer")
    g = club.create(kind="club_regular", bank="국민", account_number="1").json()
    gid = g["id"]
    for n in ("kim", "gst", "gs2"):
        club.vote(gid, n)
    assert _dues(club, gid) == [("gs2", 5000), ("gst", 5000)]

    # 면제할 때는 사유를 꼭 적는다
    r = _waive(club, gid, "gst", as_="tre", reason="  ")
    assert r.status_code == 422 and "사유" in r.json()["detail"][0]["msg"]
    # 총무가 gst 면제 → 받을 돈에서 빠지고, 명단에 면제 표시와 사유
    r = _waive(club, gid, "gst", as_="tre", reason="  당일   인원 부족 ")
    assert r.status_code == 200 and r.json()["fee_waived"] is True
    assert r.json()["fee_waiver_reason"] == "당일 인원 부족"
    seen = {p["user"]["username"]: p for p in club.c.get(f"/gatherings/{gid}", headers=club.h("kim")).json()["participants"]}
    assert seen["gst"]["fee_waiver_reason"] == "당일 인원 부족"  # 회원에게도 보인다
    assert _dues(club, gid) == [("gs2", 5000)]
    pay = club.detail(gid)["payment"]
    assert (pay["payer_count"], pay["expected"]) == (1, 5000)
    assert club.my_dues("gst") == []
    # 면제한 게스트는 입금 처리할 수 없다
    r = club.pay(gid, "gst")
    assert r.status_code == 400 and "면제" in r.json()["detail"]
    # 월 정산에도 반영
    month = club.summary(FAR_MONTH)
    assert sum(x["expected"] for x in month["gatherings"] if x["id"] == gid) == 5000

    # 이미 낸 게스트를 면제하면 돌려줄 돈
    assert club.pay(gid, "gs2").status_code == 200
    assert _waive(club, gid, "gs2").status_code == 200  # 관리자
    refunds = [(x["user"]["username"], x["amount"]) for x in club.detail(gid)["payment"]["refunds"]]
    assert refunds == [("gs2", 5000)]

    # 면제 취소 (사유도 지운다)
    r = _waive(club, gid, "gst", waived=False, as_="tre").json()
    assert r["fee_waived"] is False and r["fee_waiver_reason"] is None
    assert _dues(club, gid) == [("gst", 5000)]


def test_who_and_what_can_be_waived(club):
    club.add_members("kim", "gst", "off")
    club.set_type("gst", "guest")
    club.set_type("off", "officer")
    gid = club.create(kind="club_regular", bank="국민", account_number="1").json()["id"]
    club.vote(gid, "kim")
    club.vote(gid, "gst")
    # 관리자·총무만 (임원진·정회원·게스트 본인은 안 된다)
    for who in ("off", "kim", "gst"):
        assert _waive(club, gid, "gst", as_=who).status_code == 403, who
    # 게스트만
    r = _waive(club, gid, "kim")
    assert r.status_code == 400 and "게스트만" in r.json()["detail"]
    # 일반 벙개는 참석자끼리 n빵이라 면제가 없다
    flash = club.create(kind="flash", court_fee=20000).json()["id"]
    club.vote(flash, "gst")
    r = _waive(club, flash, "gst")
    assert r.status_code == 400 and "오테식 모임" in r.json()["detail"]
