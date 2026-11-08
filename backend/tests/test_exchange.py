"""교류전: 운영진만 만들고, 정산은 모임마다 회비(exchange) 또는 n빵(exchange_split)."""
import io
from datetime import datetime

import openpyxl

from test_ratings_api import board, generate, record
from test_schedule_import import HEADER, _month


def names_amounts(lines: list[dict]) -> list[tuple[str, int]]:
    return sorted((x["user"]["name"], x["amount"]) for x in lines)


def _invite(club, gid, name):
    """임원진(관리자)이 가입한 게스트를 교류전에 참가시킨다."""
    r = club.c.put(
        f"/gatherings/{gid}/participants/{club.ids[name]}/attendance", json={"status": "attending"}, headers=club.admin
    )
    assert r.status_code == 200, r.text


def test_only_staff_create_exchange(club):
    club.add_members("kim", "off")
    club.set_type("off", "officer")
    for kind in ("exchange", "exchange_split"):
        r = club.create("kim", kind=kind)
        assert r.status_code == 403 and "교류전" in r.json()["detail"]
        assert club.create("off", kind=kind).status_code == 201
    # 정회원이 올린 일반 벙개를 교류전으로 바꿀 수도 없다
    gid = club.create("kim", kind="flash").json()["id"]
    r = club.c.patch(f"/gatherings/{gid}", json={"kind": "exchange_split"}, headers=club.h("kim"))
    assert r.status_code == 403


def test_exchange_paid_from_club_fund(club):
    """회비 교류전: 오테식 정모처럼 회원은 낼 돈이 없고 게스트만 게스트비, 코트비는 코트요정에게."""
    club.add_members("kim", "gst")
    club.set_type("gst", "guest")
    g = club.create(
        kind="exchange",
        court_fee=40000,
        court_bookings=[{"booker_id": club.ids["kim"], "amount": 30000, "court_label": "3번"}],
    ).json()
    assert (g["kind"], g["fee"], g["court_fee"], g["guest_fee"], g["court_total"]) == ("exchange", 0, 0, 5000, 30000)
    club.vote(g["id"], "kim")
    _invite(club, g["id"], "gst")  # 교류전 게스트는 임원진이 참가시킨다
    assert club.my_dues("kim") == []
    assert club.my_dues("gst")[0]["amount"] == 5000
    assert club.pay(g["id"], "gst").status_code == 200
    assert [x["kind"] for x in club.summary()["gatherings"]] == ["exchange"]


def test_exchange_entry_fee(club):
    """교류전(참가비): 코트비는 기록만 하고, 참석자마다 정한 1인 참가비를 낸다 (n빵 아님). 코트요정 지급 내역은 없다."""
    club.add_members("aaa", "bbb", "gst")
    club.set_type("gst", "guest")
    r = club.create(
        kind="exchange_split",
        court_bookings=[{"booker_id": club.ids["aaa"], "amount": 30000}],
    )
    assert r.status_code == 400
    g = club.create(kind="exchange_split", court_fee=40000, ball_fee=5000, guest_fee=5000, entry_fee=20000).json()
    assert (g["fee"], g["court_fee"], g["ball_fee"], g["guest_fee"], g["entry_fee"]) == (0, 40000, 0, 0, 20000)
    assert g["per_person"] == 20000  # 참석자가 없어도 1인 금액은 정해져 있다
    for n in ("aaa", "bbb"):
        club.vote(g["id"], n)
    _invite(club, g["id"], "gst")
    pay = club.detail(g["id"])["payment"]
    assert (pay["per_person"], pay["payer_count"], pay["expected"]) == (20000, 3, 60000)
    assert club.my_dues("aaa")[0]["amount"] == 20000 and club.my_dues("gst")[0]["amount"] == 20000
    assert club.pay(g["id"], "aaa").json()["paid_amount"] == 20000
    month = {x["id"]: x for x in club.summary()["gatherings"]}[g["id"]]
    assert (month["per_person"], month["expected"], month["collected"]) == (20000, 60000, 20000)

    # 참가비를 올리면 낸 사람은 차액을 더 낸다
    club.c.patch(f"/gatherings/{g['id']}", json={"entry_fee": 25000}, headers=club.admin)
    assert names_amounts(club.detail(g["id"])["payment"]["dues"]) == [("aaa", 5000), ("bbb", 25000), ("gst", 25000)]

    # 취소되면 일반 벙개처럼 취소 정산 금액을 참석자끼리 나눈다 (기본 0)
    club.c.post(f"/gatherings/{g['id']}/cancel", json={"reason": "우천"}, headers=club.admin)
    d = club.detail(g["id"])
    assert d["per_person"] == 0 and [x["amount"] for x in d["payment"]["refunds"]] == [20000]
    # 게스트비 면제는 회비로 하는 모임에서만
    r = club.c.put(f"/gatherings/{g['id']}/participants/{club.ids['gst']}/fee-waiver", json={"waived": True, "reason": "인원 부족"}, headers=club.admin)
    assert r.status_code == 400


def test_officers_manage_any_exchange(club):
    """교류전은 클럽 일정이라 올린 사람이 아니어도 임원진이 고치고 대진을 짠다 (일반 벙개는 올린 사람만)."""
    club.add_members("off", "kim", "aaa", "bbb", "ccc")
    club.set_type("off", "officer")
    ex = club.create(kind="exchange_split").json()["id"]
    flash = club.create(kind="flash").json()["id"]
    assert club.c.patch(f"/gatherings/{ex}", json={"title": "A클럽 교류전"}, headers=club.h("off")).status_code == 200
    assert club.c.patch(f"/gatherings/{flash}", json={"title": "x"}, headers=club.h("off")).status_code == 403
    # 정회원은 남이 올린 교류전을 고치거나 취소할 수 없다
    assert club.c.patch(f"/gatherings/{ex}", json={"title": "x"}, headers=club.h("kim")).status_code == 403
    r = club.c.post(f"/gatherings/{ex}/cancel", json={"reason": "우천"}, headers=club.h("kim"))
    assert r.status_code == 403

    for n in ("off", "aaa", "bbb", "ccc"):
        club.vote(ex, n)
    assert generate(club, ex, as_="off", rounds=1).status_code == 201


def test_switch_settlement_only_without_records(club):
    """정산 방식(회비 / 1인 참가비 / n빵)이 바뀌면 입금 기록·코트비 지급 내역이 없을 때만 바꾼다."""
    club.add_members("aaa")
    gid = club.create(kind="exchange_split", court_fee=20000, entry_fee=10000).json()["id"]
    club.vote(gid, "aaa")
    assert club.pay(gid, "aaa").status_code == 200
    r = club.c.patch(f"/gatherings/{gid}", json={"kind": "exchange"}, headers=club.admin)
    assert r.status_code == 400 and "입금 기록" in r.json()["detail"]
    # 참가비 → 일반 벙개(n빵)도 정산 방식이 달라 막는다
    r = club.c.patch(f"/gatherings/{gid}", json={"kind": "flash"}, headers=club.admin)
    assert r.status_code == 400
    club.pay(gid, "aaa", paid=False)
    r = club.c.patch(f"/gatherings/{gid}", json={"kind": "exchange"}, headers=club.admin)
    assert r.status_code == 200
    assert (r.json()["kind"], r.json()["fee"], r.json()["guest_fee"], r.json()["entry_fee"]) == ("exchange", 0, 5000, 0)
    # 같은 쪽(회비)끼리는 언제든: 정모 ↔ 회비 교류전
    assert club.c.patch(f"/gatherings/{gid}", json={"kind": "club_regular"}, headers=club.admin).status_code == 200


def test_exchange_draws_are_not_rated(club):
    """교류전 대진 결과는 레이팅에 넣지 않는다 (회비·n빵 모두). 그래서 점수 없이도 기록할 수 있다."""
    names = ("aaa", "bbb", "ccc", "ddd")
    club.add_members(*names)
    for kind in ("exchange", "exchange_split"):
        gid = club.create(kind=kind).json()["id"]
        for n in names:
            club.vote(gid, n)
        m = generate(club, gid, rounds=1).json()["matches"][0]
        assert record(club, m["id"], 6, 2).status_code == 200
        m2 = generate(club, gid, rounds=1).json()["matches"][0]
        assert record(club, m2["id"], 0, 0).status_code == 200
    b = board(club).json()
    assert b["counted_matches"] == 0
    assert all(row["rating"] == 1000 and row["games"] == 0 for row in b["rows"])

    # 오테식 정모는 그대로 반영된다
    gid = club.create(kind="club_regular").json()["id"]
    for n in names:
        club.vote(gid, n)
    m = generate(club, gid, rounds=1).json()["matches"][0]
    assert record(club, m["id"], 0, 0).status_code == 400
    assert record(club, m["id"], 6, 2).status_code == 200
    assert board(club).json()["counted_matches"] == 1


def test_exchange_counts_in_attendance(club, fixed_now):
    """출석 현황에는 교류전도 들어간다 (회비·n빵 모두)."""
    club.add_members("amy")
    ex = club.create(kind="exchange", event_date="2099-01-15").json()["id"]
    split = club.create(kind="exchange_split", event_date="2099-01-16").json()["id"]
    reg = club.create(kind="club_regular", event_date="2099-01-17").json()["id"]
    for gid in (ex, split, reg):
        assert club.vote(gid, "amy").status_code == 200
    fixed_now["now"] = datetime(2099, 1, 20, 12, 0)

    data = club.c.get("/admin/attendance?month=2099-01", headers=club.admin).json()
    amy = next(r for r in data["rows"] if r["user"]["username"] == "amy")
    assert amy["total"] == 3 and amy["gathering_ids"] == [ex, split, reg]
    assert (amy["by_kind"]["exchange"], amy["by_kind"]["exchange_split"], amy["by_kind"]["club_regular"]) == (1, 1, 1)


def _sheet(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "템플릿"
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _upload(club, data: bytes, as_=None):
    files = {"file": ("schedule.xlsx", data, "application/octet-stream")}
    return club.c.post("/gatherings/import", files=files, headers=club.h(as_))


def test_import_exchange_rows(club):
    club.add_members("kim", "off")
    club.set_type("off", "officer")
    d1, d2 = datetime(2099, 1, 17), datetime(2099, 1, 24)
    rows = [
        # 교류전(회비): 코트비는 코트요정(kim)에게, 최대 인원을 비우면 제한 없음
        [d1, "10:00~12:00", 3, "장미주", "kim", 24000, 6000, "교류전", None, "시민 테니스장", None],
        [d1, "10:00~12:00", 4, "장미주", "kim", 24000, None, "교류전 (회비)", None, "시민 테니스장", None],
        # 교류전(n빵): 일반 벙개처럼 코트비 + 캔볼비를 나눈다
        [d2, "19:00~21:00", 2, "김다빈", "kim", 20000, 6000, "교류전 (N빵)", 8, "구립 테니스장", None],
    ]
    r = _upload(club, _sheet(rows), as_="kim")
    assert r.status_code == 200 and r.json()["created"] == 0
    assert all("교류전은 관리자와 임원진만" in e["error"] for e in r.json()["errors"])

    r = _upload(club, _sheet(rows), as_="off")
    assert r.status_code == 200 and r.json()["created"] == 2, r.text
    by_kind = {g["kind"]: g for g in _month(club)}
    paid = by_kind["exchange"]
    assert (paid["title"], paid["court_numbers"], paid["max_participants"]) == ("교류전", "3, 4", None)
    assert (paid["fee"], paid["guest_fee"], paid["court_total"]) == (0, 5000, 48000)
    split = by_kind["exchange_split"]
    # 코트비는 기록만, 1인 참가비는 모임 수정에서 정한다 (캔볼비는 쓰지 않는다)
    assert (split["title"], split["fee"], split["court_fee"], split["entry_fee"], split["max_participants"]) == (
        "교류전", 0, 20000, 0, 8,
    )


def test_court_number_ranges(club):
    """코트 번호를 '1~4'처럼 범위로 적어도 4면이 된다 (일정 등록·수정·엑셀)."""
    g = club.create(court_numbers="1~4").json()
    assert (g["court_numbers"], g["court_count"]) == ("1, 2, 3, 4", 4)
    g = club.c.patch(f"/gatherings/{g['id']}", json={"court_numbers": "5-8, 10"}, headers=club.admin).json()
    assert (g["court_numbers"], g["court_count"]) == ("5, 6, 7, 8, 10", 5)
    assert club.create(court_count=4).json()["court_count"] == 4

    rows = [[datetime(2099, 1, 17), "10:00~12:00", "1~4번", "장미주", "홍길동", 80000, None, "교류전 (참가비)", None, "시민 테니스장", None]]
    r = _upload(club, _sheet(rows))
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    made = [g for g in _month(club) if g["kind"] == "exchange_split"][0]
    assert (made["court_numbers"], made["court_count"], made["court_fee"]) == ("1, 2, 3, 4", 4, 80000)


def test_exchange_guests_join_only_by_staff_invite(club):
    """교류전 게스트는 임원진이 초대해야 참가한다: 직접 참석 투표 X, 정회원의 이름 초대 X."""
    club.add_members("off", "kim", "gst")
    club.set_type("off", "officer")
    club.set_type("gst", "guest")
    reg = club.create(kind="club_regular").json()["id"]
    assert club.vote(reg, "gst").json()["status"] == "attending"  # 정모는 그대로 직접 투표

    for kind in ("exchange", "exchange_split"):
        gid = club.create(kind=kind).json()["id"]
        r = club.vote(gid, "gst")
        assert r.status_code == 403 and "임원진이 초대한 게스트만" in r.json()["detail"]
        assert club.vote(gid, "gst", "absent").status_code == 200  # 불참은 된다

        # 가입한 게스트: 임원진이 참가시킨다 (정회원은 못 함)
        url = f"/gatherings/{gid}/participants/{club.ids['gst']}/attendance"
        assert club.c.put(url, json={"status": "attending"}, headers=club.h("kim")).status_code == 403
        r = club.c.put(url, json={"status": "attending"}, headers=club.h("off"))
        assert r.status_code == 200 and r.json()["status"] == "attending"
        assert club.vote(gid, "gst").status_code == 200  # 이미 참석이면 그대로
        # 초대받은 게스트가 스스로 빠질 수 있고, 다시 들어오려면 또 초대받아야 한다
        assert club.c.delete(f"/gatherings/{gid}/attendance", headers=club.h("gst")).status_code == 204
        assert club.vote(gid, "gst").status_code == 403

        # 이름만 적는 게스트 초대: 참석 중인 정회원은 못 하고 임원진만
        club.vote(gid, "kim")
        r = club.c.post(f"/gatherings/{gid}/guests", json={"name": "상대팀 손님"}, headers=club.h("kim"))
        assert r.status_code == 403 and "임원진만" in r.json()["detail"]
        r = club.c.post(f"/gatherings/{gid}/guests", json={"name": "상대팀 손님"}, headers=club.h("off"))
        assert r.status_code == 201 and r.json()["status"] == "attending"

    # 정회원은 교류전도 직접 투표한다
    assert club.vote(club.create(kind="exchange").json()["id"], "kim").json()["status"] == "attending"
