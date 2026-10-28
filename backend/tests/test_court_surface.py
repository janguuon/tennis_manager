"""코트 바닥 재질: 하드·인조잔디·클레이·카펫. 주소처럼 같은 장소의 일정끼리 함께 쓴다."""


def test_court_surface_shared_by_same_place(club):
    a = club.create(kind="flash", location="수암꿈나무", event_date="2099-01-10").json()
    assert a["court_surface"] is None
    # 재질을 골라 만들면, 같은 장소(띄어쓰기 무시)인데 재질이 없던 일정에도 들어간다
    b = club.create(kind="flash", location="수암 꿈나무", court_surface="turf", event_date="2099-01-12").json()
    assert b["court_surface"] == "turf"
    assert club.detail(a["id"])["court_surface"] == "turf"
    # 다음 일정은 고르지 않아도 같은 장소의 재질이 들어가고, 주소와 재질을 따로 채운다
    club.c.patch(f"/gatherings/{a['id']}", json={"address": "안산 어딘가 1"}, headers=club.admin)
    c = club.create(kind="flash", location="수암꿈나무", event_date="2099-01-19").json()
    assert (c["court_surface"], c["address"]) == ("turf", "안산 어딘가 1")
    # 다른 장소는 그대로, 엉뚱한 값은 받지 않는다
    assert club.create(kind="flash", location="시민 테니스장").json()["court_surface"] is None
    assert club.create(kind="flash", location="시민 테니스장", court_surface="sand").status_code == 422

    # 수정으로 바꾸면 그 일정만 바뀐다 (이미 재질이 있는 같은 장소 일정은 그대로)
    r = club.c.patch(f"/gatherings/{c['id']}", json={"court_surface": "hard"}, headers=club.admin)
    assert r.json()["court_surface"] == "hard"
    assert club.detail(b["id"])["court_surface"] == "turf"
    # 지우기: 이번에 직접 비운 것은 다시 채우지 않는다
    r = club.c.patch(f"/gatherings/{c['id']}", json={"location": "수암꿈나무", "court_surface": None},
                     headers=club.admin)
    assert r.json()["court_surface"] is None
    # 장소를 바꾸면 그 장소의 재질로
    club.create(kind="flash", location="구립 코트", court_surface="clay")
    r = club.c.patch(f"/gatherings/{c['id']}", json={"location": "구립 코트"}, headers=club.admin)
    assert r.json()["court_surface"] == "clay"
