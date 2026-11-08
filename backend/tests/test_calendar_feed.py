"""참석 일정 구독: 비밀 링크 만들기·다시 만들기·끊기, 참석·대기 모임만 담은 캘린더."""

BASE = "https://otesik.example"


def _token(club, name, method="post"):
    r = getattr(club.c, method)("/users/me/calendar-feed", headers=club.h(name))
    return r.json()["token"] if r.status_code == 200 else r.status_code


def _feed(club, token, base=BASE):
    return club.c.get(f"/calendar-feed/{token}.ics", params={"base": base} if base else None)


def _unfold(text: str) -> str:
    return text.replace("\r\n ", "")


def test_link_lifecycle(club):
    club.add_members("kim")
    assert _token(club, "kim", "get") is None
    first = _token(club, "kim")
    assert len(first) >= 30 and _token(club, "kim", "get") == first
    assert _feed(club, first).status_code == 200

    # 다시 만들면 예전 링크는 끊긴다
    second = _token(club, "kim")
    assert second != first
    assert _feed(club, first).status_code == 404 and _feed(club, second).status_code == 200

    # 끊기
    assert club.c.delete("/users/me/calendar-feed", headers=club.h("kim")).status_code == 204
    assert _token(club, "kim", "get") is None and _feed(club, second).status_code == 404
    # 짧거나 없는 토큰
    assert _feed(club, "x").status_code == 404
    # 로그인 없이는 링크를 만들 수 없다
    assert club.c.post("/users/me/calendar-feed").status_code == 401


def test_feed_has_my_attending_and_waiting(club):
    club.add_members("kim", "lee")
    attend = club.create(title="토요 정모", kind="club_regular", start_time="19:00", end_time="21:00").json()["id"]
    full = club.create(title="꽉 찬 벙개", max_participants=1).json()["id"]
    absent = club.create(title="불참한 모임").json()["id"]
    other = club.create(title="남의 모임").json()["id"]
    canceled = club.create(title="비 온 날").json()["id"]

    club.vote(attend, "kim")
    club.vote(full, "lee")
    assert club.vote(full, "kim").json()["status"] == "waiting"
    club.vote(absent, "kim", "absent")
    club.vote(other, "lee")
    club.vote(canceled, "kim")
    club.c.post(f"/gatherings/{canceled}/cancel", json={"reason": "우천"}, headers=club.admin)

    token = _token(club, "kim")
    r = _feed(club, token)
    assert r.headers["content-type"].startswith("text/calendar")
    body = _unfold(r.text)
    assert "X-WR-CALNAME:오테식 참석 일정" in body
    assert body.count("BEGIN:VEVENT") == 3
    assert "SUMMARY:[오테식 정모] 토요 정모" in body and "DTSTART:20990115T100000Z" in body
    assert "SUMMARY:(대기) [일반 벙개] 꽉 찬 벙개" in body
    assert "SUMMARY:(취소) [일반 벙개] 비 온 날" in body and "STATUS:CANCELLED" in body
    assert "불참한 모임" not in body and "남의 모임" not in body
    assert f"URL:{BASE}/app/gatherings/{attend}" in body

    # 불참으로 바꾸면 다음에 받을 때 빠진다
    club.c.delete(f"/gatherings/{attend}/attendance", headers=club.h("kim"))
    assert "토요 정모" not in _unfold(_feed(club, token).text)

    # 링크 주소(base)가 이상하면 모임 화면 링크만 뺀다
    body = _unfold(_feed(club, token, base="javascript:alert(1)").text)
    assert "URL:" not in body and "javascript" not in body


def test_inactive_member_link_stops(club):
    club.add_members("kim")
    gid = club.create().json()["id"]
    club.vote(gid, "kim")
    token = _token(club, "kim")
    # 회원을 지우면(기록이 있으면 탈퇴 처리, 없으면 완전 삭제) 링크도 열리지 않는다
    r = club.c.delete(f"/admin/users/{club.ids['kim']}", headers=club.admin)
    assert r.json()["result"] in ("deleted", "deactivated")
    assert _feed(club, token).status_code == 404
