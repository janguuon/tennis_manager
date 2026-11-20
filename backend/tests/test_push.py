"""폰 알림 (웹 푸시): 기기 등록·종류별 끄기, 소식·대기→참석·1시간 전·일정 공개·경기 시작·다음 차례."""
import json
from datetime import datetime

import pytest

from app import push
from test_exchange_battle import OURS, _opponents, _post, _setup
from test_ratings_api import PLAYERS, generate, record

KEYS = {"p256dh": "B" + "x" * 86, "auth": "a" * 22}


class Gone(Exception):
    status_code = 410


class Sent(list):
    gone: set[str]


@pytest.fixture
def sent(monkeypatch):
    """보낸 알림: [(받는 사람 이름, 제목, 본문, 주소, sub)]. endpoint 끝이 회원 이름이다."""
    out = Sent()
    gone: set[str] = set()

    def fake_send(info, payload, private_key, claims, ttl, urgency):
        who = info["endpoint"].rsplit("/", 1)[-1]
        if who in gone:
            raise Gone("gone")
        out.append({"to": who, **json.loads(payload), "sub": claims["sub"], "urgency": urgency, "ttl": ttl})

    monkeypatch.setattr(push, "INLINE", True)
    monkeypatch.setattr(push, "_send", fake_send)
    out.gone = gone
    return out


def subscribe(club, name, origin=None):
    body = {"endpoint": f"https://fcm.googleapis.com/wp/{name}", "keys": KEYS, "origin": origin}
    return club.c.post("/push/subscriptions", json=body, headers=club.h(name))


def to(sent, title_part=""):
    return sorted(m["to"] for m in sent if title_part in m["title"])


def test_subscribe_settings_and_test_push(club, sent):
    club.add_members("kim", "park")
    s = club.c.get("/push/settings", headers=club.h("kim")).json()
    assert len(s["public_key"]) == 87 and s["devices"] == 0
    assert s["kinds"] == {k: True for k in push.KINDS} and s["guest"] is False

    # 브라우저 회사 푸시 서버가 아닌 주소는 받지 않는다
    bad = {"endpoint": "https://evil.example.com/hook", "keys": KEYS}
    assert club.c.post("/push/subscriptions", json=bad, headers=club.h("kim")).status_code == 400
    assert subscribe(club, "kim").json()["devices"] == 1

    # 시험 알림은 바로 간다. 아직 앱 주소를 모르면 sub 는 mailto
    r = club.c.post("/push/test", json={}, headers=club.h("kim"))
    assert r.json() == {"sent": 1, "failed": 0}
    assert sent[-1]["title"] == "🔔 알림이 잘 와요" and sent[-1]["sub"].startswith("mailto:")

    # https 앱 주소로 켜면 그 주소를 VAPID sub 로 (localhost 는 아니다)
    subscribe(club, "kim", origin="http://localhost:3000")
    subscribe(club, "kim", origin="https://club.example.org")
    club.c.post("/push/test", json={}, headers=club.h("kim"))
    assert sent[-1]["sub"] == "https://club.example.org"

    # 같은 기기를 다른 아이디로 켜면 그 아이디로 옮긴다
    body = {"endpoint": "https://fcm.googleapis.com/wp/kim", "keys": KEYS}
    assert club.c.post("/push/subscriptions", json=body, headers=club.h("park")).json()["devices"] == 1
    assert club.c.get("/push/settings", headers=club.h("kim")).json()["devices"] == 0

    # 종류별 끄기
    s = club.c.put("/push/settings", json={"kinds": {"news": False, "match": False}}, headers=club.h("park")).json()
    assert (s["kinds"]["news"], s["kinds"]["match"], s["kinds"]["reminder"]) == (False, False, True)
    s = club.c.put("/push/settings", json={"kinds": {"news": True}}, headers=club.h("park")).json()
    assert (s["kinds"]["news"], s["kinds"]["match"]) == (True, False)
    assert club.c.put("/push/settings", json={"kinds": {"bogus": True}}, headers=club.h("park")).status_code == 422

    # 끄기 → 시험할 기기가 없다
    r = club.c.post("/push/unsubscribe", json={"endpoint": body["endpoint"]}, headers=club.h("park"))
    assert r.json()["devices"] == 0
    assert club.c.post("/push/test", json={}, headers=club.h("park")).status_code == 404


def test_news_goes_to_everyone_once(club, sent):
    club.add_members("kim", "park", "guest1")
    club.set_type("guest1", "guest")
    for n in ("kim", "park", "guest1"):
        subscribe(club, n)
    club.c.put("/push/settings", json={"kinds": {"news": False}}, headers=club.h("park"))
    sent.gone.add("guest1")  # 앱을 지운 기기: 410 → 지운다

    r = club.c.post("/notices", json={"kind": "celebrate", "title": "대회 우승!", "body": "축하해요\n모두"}, headers=club.admin)
    assert r.status_code == 201
    assert to(sent) == ["kim"]
    assert sent[0]["title"] == "🎉 대회 우승!" and sent[0]["body"] == "축하해요 모두" and sent[0]["url"] == "/app"
    assert club.c.get("/push/settings", headers=club.h("guest1")).json()["devices"] == 0


def test_waitlist_promotion(club, sent):
    club.add_members("kim", "park")
    gid = club.gathering(0, max_participants=1, start_time="10:00", end_time="12:00")
    subscribe(club, "park")
    club.vote(gid, "kim")
    assert club.vote(gid, "park").json()["status"] == "waiting"
    assert sent == []
    club.vote(gid, "kim", "absent")
    assert to(sent) == ["park"]
    assert sent[0]["title"] == "대기에서 참석이 됐어요 🙌" and "1/15(목) 10:00 모임" in sent[0]["body"]
    assert sent[0]["url"] == f"/app/gatherings/{gid}"


def test_reminder_one_hour_before(club, sent):
    club.add_members("kim", "park", "lee")
    gid = club.gathering(0, max_participants=1, start_time="10:00", end_time="12:00", location="망원 코트", court_numbers="3, 5")
    for n in ("kim", "park", "lee"):
        subscribe(club, n)
    club.vote(gid, "kim")
    club.vote(gid, "park")  # 대기
    club.vote(gid, "lee", "absent")
    canceled = club.gathering(0, start_time="10:00")
    club.vote(canceled, "lee")
    club.c.post(f"/gatherings/{canceled}/cancel", json={"reason": "우천"}, headers=club.admin)

    push.tick(datetime(2099, 1, 15, 8, 59))
    assert sent == []
    push.tick(datetime(2099, 1, 15, 9, 3))
    assert to(sent) == ["kim"]
    assert sent[0]["title"] == "⏰ 모임 1시간 뒤 시작" and sent[0]["body"] == "1/15(목) 10:00 · 망원 코트 3, 5번"
    assert sent[0]["urgency"] == "high"
    push.tick(datetime(2099, 1, 15, 9, 30))
    assert len(sent) == 1  # 두 번 보내지 않는다

    # 시작 시각을 바꾸면 다시
    club.c.patch(f"/gatherings/{gid}", json={"start_time": "11:00", "end_time": "13:00"}, headers=club.admin)
    push.tick(datetime(2099, 1, 15, 10, 30))
    assert to(sent) == ["kim", "kim"] and sent[1]["title"] == "⏰ 모임 30분 뒤 시작"


def test_schedule_open_notice(club, sent, fixed_now):
    club.add_members("kim", "park", "guest1")
    club.set_type("guest1", "guest")
    for n in ("kim", "park", "guest1"):
        subscribe(club, n)
    admin = {"endpoint": "https://fcm.googleapis.com/wp/admin", "keys": KEYS}
    club.c.post("/push/subscriptions", json=admin, headers=club.admin)

    # 처음 켤 때는 이미 열린 일정을 알리지 않는다 (FAR_DATE 모임은 이미 열려 있다)
    club.gathering(0)
    push.tick(datetime(2099, 1, 12, 9, 1))
    assert sent == []

    # 다음 주 일정: 금요일 오전 10시에 열린다 → 정회원에게 (게스트·만든 사람 빼고), 여러 개면 묶어서
    a = club.gathering(0, date="2099-01-22", title="정모", start_time="10:00")
    push.tick(datetime(2099, 1, 16, 9, 59))
    assert sent == []
    push.tick(datetime(2099, 1, 16, 10, 0))
    assert to(sent) == ["kim", "park"]
    assert sent[0]["title"] == "📅 새 일정이 열렸어요" and sent[0]["body"] == "1/22(목) 10:00 정모"
    assert sent[0]["url"] == f"/app/gatherings/{a}"

    sent.clear()
    club.gathering(0, date="2099-01-29", title="벙개1")
    club.gathering(0, date="2099-01-30", title="벙개2")
    push.tick(datetime(2099, 1, 23, 10, 0))
    assert to(sent) == ["kim", "park"]
    assert sent[0]["title"] == "📅 새 일정 2개가 열렸어요" and sent[0]["body"] == "1/29(목) 벙개1, 1/30(금) 벙개2"
    push.tick(datetime(2099, 1, 23, 10, 1))
    assert len(sent) == 2

    # 운영진이 미리 공개하면 다음 확인 때 (일정 공개 알림을 끈 사람은 빼고)
    sent.clear()
    club.c.put("/push/settings", json={"kinds": {"schedule": False}}, headers=club.h("park"))
    fixed_now["now"] = datetime(2099, 1, 24, 9, 0)
    early = club.gathering(0, date="2099-02-05", title="미리")
    assert club.c.post(f"/gatherings/{early}/open", headers=club.admin).status_code == 200
    push.tick(datetime(2099, 1, 24, 9, 1))
    assert to(sent) == ["kim"] and "미리" in sent[0]["body"]


def _draw_setup(club):
    club.add_members(*PLAYERS)
    gid = club.create(kind="club_regular", court_numbers="3, 5", start_time="19:00", end_time="22:00").json()["id"]
    for n in PLAYERS:
        club.vote(gid, n)
        subscribe(club, n)
    matches = generate(club, gid, rounds=2).json()["matches"]
    return gid, matches


def _names(m):
    return sorted(u["username"] for u in m["team1"] + m["team2"])


def test_draw_match_start_and_next_turn(club, sent, fixed_now):
    gid, matches = _draw_setup(club)
    r1c1, r1c2, r2c1, r2c2 = sorted(matches, key=lambda m: (m["round_number"], m["court_number"]))
    p = _names(r1c1)
    bench = next(n for n in PLAYERS if n not in p)
    url = f"/draw-matches/{r1c1['id']}/start"

    # 모임 날에만
    assert club.c.post(url, headers=club.h(p[0])).status_code == 400
    fixed_now["now"] = datetime(2099, 1, 15, 19, 5)
    # 그 경기 선수·운영진만 (점수 입력과 같다)
    assert club.c.post(url, headers=club.h(bench)).status_code == 403
    r = club.c.post(url, headers=club.h(p[0]))
    assert r.status_code == 200 and r.json()["started_at"]
    assert to(sent) == p[1:]  # 누른 사람은 빼고
    assert sent[0]["title"] == "🎾 경기 시작 · 3번 코트" and sent[0]["body"].startswith("1라운드 · ")
    assert " vs " in sent[0]["body"] and sent[0]["urgency"] == "high"
    # 다시 눌러도 알림은 한 번
    club.c.post(url, headers=club.h(p[1]))
    assert len(sent) == 3
    # 되돌리기
    assert club.c.delete(url, headers=club.h(p[0])).json()["started_at"] is None

    # 라운드 시작: 운영진·모임 올린 사람만, 아직 시작 안 한 경기를 한 번에
    sent.clear()
    draw_id = club.c.get(f"/gatherings/{gid}/draws", headers=club.admin).json()[0]["id"]
    assert club.c.post(f"/draws/{draw_id}/rounds/1/start", headers=club.h(p[0])).status_code == 403
    d = club.c.post(f"/draws/{draw_id}/rounds/1/start", headers=club.admin).json()
    assert [bool(m["started_at"]) for m in d["matches"]] == [True, True, False, False]
    assert to(sent) == sorted(_names(r1c1) + _names(r1c2))
    assert {m["title"] for m in sent} == {"🎾 경기 시작 · 3번 코트", "🎾 경기 시작 · 5번 코트"}
    assert club.c.post(f"/draws/{draw_id}/rounds/9/start", headers=club.admin).status_code == 404

    # 점수가 들어오면 같은 코트 다음 경기 선수에게 '다음 차례' (한 번만)
    sent.clear()
    assert record(club, r1c1["id"], 6, 3).status_code == 200
    assert to(sent) == _names(r2c1)
    assert sent[0]["title"] == "⏭️ 다음 차례예요 · 3번 코트" and sent[0]["body"].startswith("앞 경기가 끝났어요")
    club.c.delete(f"/draw-matches/{r1c1['id']}/result", headers=club.admin)
    record(club, r1c1["id"], 6, 3)
    assert len(sent) == 4
    # 점수가 들어간 경기는 시작할 수 없다
    assert club.c.post(url, headers=club.admin).status_code == 409

    # 모임이 끝나고 한참 뒤(집에서 몰아 적기)에는 다음 차례를 보내지 않는다
    sent.clear()
    fixed_now["now"] = datetime(2099, 1, 15, 23, 30)
    record(club, r1c2["id"], 6, 1)
    assert sent == []


def test_match_push_respects_setting(club, sent, fixed_now):
    gid, matches = _draw_setup(club)
    first = sorted(matches, key=lambda m: (m["round_number"], m["court_number"]))[0]
    p = _names(first)
    club.c.put("/push/settings", json={"kinds": {"match": False}}, headers=club.h(p[1]))
    fixed_now["now"] = datetime(2099, 1, 15, 19, 5)
    club.c.post(f"/draw-matches/{first['id']}/start", headers=club.admin)
    assert to(sent) == [p[0], p[2], p[3]]


def test_exchange_match_start_next_and_result_news(club, sent, fixed_now):
    gid = _setup(club)
    for n in (*OURS, "kim"):
        subscribe(club, n)
    _opponents(club, gid)
    d = _post(club, f"/{gid}/draw", {"court_count": 2, "rounds": 2}).json()
    first = d["matches"][0]
    ours = sorted(u["username"] for u in first["ours"])

    assert _post(club, f"/{gid}/matches/{first['id']}/start").status_code == 400  # 교류전 날이 아니다
    fixed_now["now"] = datetime(2099, 1, 15, 19, 5)
    assert _post(club, f"/{gid}/matches/{first['id']}/start", as_="kim").status_code == 403
    assert _post(club, f"/{gid}/rounds/1/start", as_=ours[0]).status_code == 403
    d = _post(club, f"/{gid}/rounds/1/start", as_="off").json()
    assert [bool(m["started_at"]) for m in d["matches"]] == [True, True, False, False]
    round1 = sorted(u["username"] for m in d["matches"][:2] for u in m["ours"])
    assert to(sent) == round1 and "kim" not in to(sent)
    assert {m["title"] for m in sent} == {"🎾 경기 시작 · 1번 코트", "🎾 경기 시작 · 2번 코트"}
    assert all(" vs " in m["body"] for m in sent)

    # 점수 → 같은 코트 다음 라운드 우리 선수에게 (고쳐 적을 때는 다시 안 간다)
    sent.clear()
    score = {"ours_score": 6, "theirs_score": 2}
    _post(club, f"/{gid}/matches/{first['id']}/result", score, method="put")
    nxt = next(m for m in d["matches"] if m["round_number"] == 2 and m["court"] == 1)
    assert to(sent) == sorted(u["username"] for u in nxt["ours"])
    assert sent[0]["title"] == "⏭️ 다음 차례예요 · 1번 코트"
    _post(club, f"/{gid}/matches/{first['id']}/result", {"ours_score": 6, "theirs_score": 3}, method="put")
    assert len(sent) == len(nxt["ours"])

    # 결과 소식은 모두에게 한 번 (마치기를 취소하고 다시 마쳐도)
    sent.clear()
    for m in d["matches"][1:]:
        _post(club, f"/{gid}/matches/{m['id']}/result", score, method="put")
    sent.clear()
    _post(club, f"/{gid}/finish", {"announce": True}, as_="off")
    assert "kim" in to(sent, "교류전") and len(to(sent, "교류전")) == 7
    club.c.delete(f"/exchanges/{gid}/finish", headers=club.h("off"))
    _post(club, f"/{gid}/finish", {"announce": True}, as_="off")
    assert len(to(sent, "교류전")) == 7


def test_real_web_push_encryption_and_vapid():
    """만든 VAPID 키로 pywebpush 가 서명·암호화하고, 받는 쪽 키로 풀린다."""
    import base64

    import http_ece
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from py_vapid import Vapid
    from pywebpush import WebPusher

    public, private = push.generate_keys()
    assert len(public) == 87 and len(private) == 43
    headers = Vapid.from_string(private).sign({"sub": "https://club.example.org", "aud": "https://fcm.googleapis.com"})
    assert public in headers["Authorization"]

    receiver = ec.generate_private_key(ec.SECP256R1())
    p256dh = base64.urlsafe_b64encode(
        receiver.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    ).rstrip(b"=").decode()
    auth = base64.urlsafe_b64encode(b"0123456789abcdef").rstrip(b"=").decode()
    info = {"endpoint": "https://fcm.googleapis.com/wp/x", "keys": {"p256dh": p256dh, "auth": auth}}
    body = WebPusher(info).encode(push._payload("제목", "본문", "/app", None).encode(), "aes128gcm")["body"]
    plain = http_ece.decrypt(body, private_key=receiver, auth_secret=b"0123456789abcdef", version="aes128gcm")
    assert json.loads(plain)["title"] == "제목"
