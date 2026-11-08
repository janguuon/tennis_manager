"""폰 캘린더에 넣기: .ics 파일과 구글 캘린더 링크."""
from urllib.parse import parse_qs, urlparse

from app.calendar_export import _fold

LINK = "https://otesik.example/app/gatherings/1"


def _ics(club, gid, name=None, link=LINK):
    return club.c.get(f"/gatherings/{gid}/calendar.ics", params={"link": link} if link else None, headers=club.h(name))


def _unfold(text: str) -> str:
    return text.replace("\r\n ", "")


def test_ics_timed_gathering(club):
    gid = club.create(
        kind="club_regular",
        title="오테식 정모",
        start_time="19:00",
        end_time="21:00",
        location="시민 테니스장",
        address="수원시 영통구 1",
        court_numbers="3, 5",
        court_surface="hard",
    ).json()["id"]
    r = _ics(club, gid)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    assert f'filename="otesik-{gid}.ics"' in r.headers["content-disposition"]
    text = r.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    body = _unfold(text)
    # 한국 시간 19:00~21:00 → UTC 10:00~12:00
    assert "DTSTART:20990115T100000Z" in body and "DTEND:20990115T120000Z" in body
    assert "SUMMARY:오테식 정모\r\n" in body  # 제목이 종류 이름이면 한 번만
    assert "LOCATION:수원시 영통구 1" in body
    assert "DESCRIPTION:장소: 시민 테니스장\\n코트: 3\\, 5번 (2면) · 하드\\n모임 화면: " + LINK in body
    assert f"UID:gathering-{gid}@otesik" in body and "STATUS:CONFIRMED" in body
    assert "TRIGGER:-PT1H" in body
    # 75바이트 넘는 줄은 접혀 있다
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))


def test_ics_all_day_and_default_length(club):
    gid = club.create(kind="flash", title="토요 벙개", location="구립 코트").json()["id"]
    body = _unfold(_ics(club, gid, link=None).text)
    assert "DTSTART;VALUE=DATE:20990115" in body and "DTEND;VALUE=DATE:20990116" in body
    assert "SUMMARY:[일반 벙개] 토요 벙개" in body and "LOCATION:구립 코트" in body
    assert "TRIGGER:-PT15H" in body and "URL:" not in body

    # 끝 시각이 없으면 2시간, 자정을 넘기면 다음 날
    gid = club.create(start_time="20:00").json()["id"]
    assert "DTEND:20990115T130000Z" in _unfold(_ics(club, gid).text)
    gid = club.create(start_time="22:00", end_time="00:30").json()["id"]
    assert "DTEND:20990115T153000Z" in _unfold(_ics(club, gid).text)


def test_canceled_and_visibility(club, fixed_now):
    club.add_members("kim")
    gid = club.create(kind="exchange", title="A클럽 교류전", start_time="10:00").json()["id"]
    club.c.post(f"/gatherings/{gid}/cancel", json={"reason": "우천"}, headers=club.admin)
    body = _unfold(_ics(club, gid).text)
    assert "SUMMARY:(취소) [교류전] A클럽 교류전" in body and "STATUS:CANCELLED" in body
    assert "취소: 우천" in body and "VALARM" not in body

    # 아직 공개 전인 일정은 받을 수 없다 (임원진만 보는 일정)
    later = club.create(event_date="2099-02-20").json()["id"]
    assert _ics(club, later, "kim").status_code == 403
    assert club.c.get(f"/gatherings/{later}/calendar/google", headers=club.h("kim")).status_code == 403
    assert _ics(club, 99999).status_code == 404


def test_google_calendar_link(club):
    gid = club.create(
        kind="exchange_split", title="B클럽 교류전", start_time="19:00", end_time="21:00", location="시민 테니스장"
    ).json()["id"]
    r = club.c.get(f"/gatherings/{gid}/calendar/google", params={"link": LINK}, headers=club.admin)
    url = urlparse(r.json()["url"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert (url.netloc, url.path) == ("calendar.google.com", "/calendar/render")
    assert q["action"] == "TEMPLATE" and q["text"] == "[교류전] B클럽 교류전"
    assert q["dates"] == "20990115T100000Z/20990115T120000Z" and q["ctz"] == "Asia/Seoul"
    assert q["location"] == "시민 테니스장" and LINK in q["details"]

    # 이상한 링크는 넣지 않는다
    r = club.c.get(f"/gatherings/{gid}/calendar/google", params={"link": "javascript:alert(1)"}, headers=club.admin)
    assert "javascript" not in r.json()["url"]
    body = _unfold(_ics(club, gid, link="https://x.example/a\r\nX-EVIL:1").text)
    assert "X-EVIL" not in body and "URL:" not in body


def test_fold_keeps_korean_whole():
    line = "SUMMARY:" + "가" * 60
    folded = _fold(line)
    assert all(len(part.encode()) <= 75 for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line
