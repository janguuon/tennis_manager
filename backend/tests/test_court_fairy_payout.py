"""코트요정 = 코트비를 받을 회원(지급 내역)과 같게, 코트요정별 한 번에 지급 완료."""


def booking(club, gid, name, amount=20000, label=None, as_=None):
    return club.c.post(
        f"/gatherings/{gid}/court-bookings",
        json={"booker_id": club.ids[name], "amount": amount, "court_label": label},
        headers=club.h(as_),
    )


def test_court_fairy_follows_bookings(club):
    club.add_members("seo", "kim")
    # 등록할 때 넣은 코트요정(지급 내역)이 코트요정 칸이 된다. 직접 적은 글자보다 우선
    r = club.create(
        kind="club_regular",
        court_fairy="아무개",
        court_bookings=[
            {"booker_id": club.ids["seo"], "amount": 24000, "court_label": "3번"},
            {"booker_id": club.ids["seo"], "amount": 24000, "court_label": "5번"},
        ],
    )
    gid = r.json()["id"]
    assert club.detail(gid)["court_fairy"] == "seo"
    # 추가·수정·삭제할 때마다 맞춘다
    b = booking(club, gid, "kim", label="7번").json()
    assert club.detail(gid)["court_fairy"] == "seo, kim"
    club.c.patch(f"/court-bookings/{b['id']}", json={"booker_id": club.ids["seo"]}, headers=club.admin)
    assert club.detail(gid)["court_fairy"] == "seo"
    for x in club.detail(gid)["court_bookings"]:
        club.c.delete(f"/court-bookings/{x['id']}", headers=club.admin)
    assert club.detail(gid)["court_fairy"] is None

    # 일반 벙개의 코트요정 글자는 그대로 (지급 내역이 없다)
    flash = club.create(kind="flash", court_fairy="서승우").json()["id"]
    assert club.detail(flash)["court_fairy"] == "서승우"
    # 지급 내역이 없는 오테식 모임은 적어 둔 글자를 그대로 둔다
    plain = club.create(kind="club_flash", court_fairy="서승우").json()["id"]
    assert club.detail(plain)["court_fairy"] == "서승우"


def test_bulk_reimbursement(club):
    club.add_members("seo", "kim", "tre", "off")
    club.set_type("tre", "treasurer")
    club.set_type("off", "officer")
    g1 = club.create(kind="club_regular").json()["id"]
    g2 = club.create(kind="club_flash").json()["id"]
    ids = [booking(club, g1, "seo", label="3번").json()["id"], booking(club, g2, "seo", label="5번").json()["id"]]
    other = booking(club, g1, "kim").json()["id"]

    body = {"booking_ids": ids, "reimbursed": True}
    assert club.c.put("/court-bookings/reimbursement", json=body, headers=club.h("off")).status_code == 403
    r = club.c.put("/court-bookings/reimbursement", json=body, headers=club.h("tre"))
    assert r.status_code == 200 and all(b["reimbursed"] for b in r.json())
    pending = club.c.get("/court-bookings", headers=club.h("tre")).json()
    assert [b["id"] for b in pending] == [other]

    # 지급 취소도 한 번에, 없는 예약이 섞이면 아무것도 바꾸지 않는다
    r = club.c.put("/court-bookings/reimbursement", json={"booking_ids": [ids[0], 99999], "reimbursed": False}, headers=club.admin)
    assert r.status_code == 404
    assert len(club.c.get("/court-bookings", headers=club.admin).json()) == 1
    r = club.c.put("/court-bookings/reimbursement", json={"booking_ids": ids, "reimbursed": False}, headers=club.admin)
    assert not any(b["reimbursed"] for b in r.json())
    assert len(club.c.get("/court-bookings", headers=club.admin).json()) == 3
