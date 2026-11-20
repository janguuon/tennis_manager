"""
폰 알림 (웹 푸시).

안드로이드·아이폰(홈 화면에 추가한 앱, iOS 16.4+)에서 회원이 '이 폰에서 알림 받기'를 켜면 브라우저가 푸시 주소를 준다
(PushSubscription). 서버는 VAPID 키로 서명해 그 주소(구글 FCM·애플 등)에 암호화한 알림을 보낸다. 외부 가입은 필요 없다.

알림 종류 (회원이 마이페이지에서 종류마다 끈다, User.push_off):
- schedule: 일정 공개 — 정회원에게. 금요일 오전 10시에 다음 주 일정이 열리면 한 번에 묶어서, 미리 공개·나중에 만든 일정은 열릴 때.
- reminder: 참석한 일정 시작 1시간 전 (대기자 빼고)
- waitlist: 대기에서 참석으로 바뀌었을 때
- news: 클럽 소식 (운영진 소식, 교류전·대회 결과 소식)
- match: 경기 시작(코트 번호) · 다음 차례

보내는 때: 요청 안에서 notify() 로 줄을 세워 두면 DB 커밋이 끝난 뒤에 따로 보낸다(커밋이 실패하면 보내지 않는다).
정해진 때에 보내는 알림(1시간 전·일정 공개)은 서버가 1분마다 tick() 으로 확인하고, 보낸 기록(PushSent)으로 두 번 보내지 않는다.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from . import visibility
from .config import settings
from .database import SessionLocal
from .models import (
    ApprovalStatus,
    AttendanceStatus,
    ClubSetting,
    Gathering,
    GatheringStatus,
    MemberType,
    Notice,
    PushSent,
    PushSubscription,
    User,
)
from .schedule_import import court_labels

log = logging.getLogger(__name__)

KINDS = ("schedule", "reminder", "waitlist", "news", "match")

KEY_PUBLIC = "push.vapid_public"
KEY_PRIVATE = "push.vapid_private"
KEY_SUBJECT = "push.subject"
# 처음 켤 때 이미 열려 있던 일정은 알리지 않는다 (그때를 적어 둔다)
KEY_OPEN_BASELINE = "push.open_baseline"

# 알림을 받아 주는 곳 (브라우저 회사의 푸시 서버). 다른 주소로는 보내지 않는다
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)

REMIND_BEFORE = timedelta(hours=1)
WEEKDAYS = "월화수목금토일"

# 테스트에서는 True: 기다리지 않고 바로 보낸다
INLINE = False
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")


# --- 키 ---------------------------------------------------------------------
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def generate_keys() -> tuple[str, str]:
    """VAPID 키 한 쌍 (공개 키: 65바이트 점, 비밀 키: 32바이트 정수, 둘 다 base64url)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64(public), _b64(private)


def _setting(db: Session, key: str) -> str | None:
    row = db.get(ClubSetting, key)
    return row.value if row else None


def _put_setting(db: Session, key: str, value: str) -> None:
    row = db.get(ClubSetting, key)
    if row:
        row.value = value
    else:
        db.add(ClubSetting(key=key, value=value))


def ensure_keys(db: Session) -> tuple[str, str]:
    """(공개 키, 비밀 키). .env 에 있으면 그것, 없으면 DB 에 있는 것, 그것도 없으면 만들어 DB 에 둔다."""
    if settings.vapid_public_key and settings.vapid_private_key:
        return settings.vapid_public_key, settings.vapid_private_key
    public, private = _setting(db, KEY_PUBLIC), _setting(db, KEY_PRIVATE)
    if not (public and private):
        public, private = generate_keys()
        _put_setting(db, KEY_PUBLIC, public)
        _put_setting(db, KEY_PRIVATE, private)
        db.flush()
    return public, private


def public_key(db: Session) -> str:
    return ensure_keys(db)[0]


def subject(db: Session) -> str:
    """VAPID 'sub': .env → 회원이 알림을 켠 https 앱 주소. 애플은 https 주소나 mailto: 가 아니면 받지 않는다."""
    return settings.vapid_subject or _setting(db, KEY_SUBJECT) or "mailto:push@localhost.invalid"


def remember_origin(db: Session, origin: str | None) -> None:
    """알림을 켠 앱 주소(https)를 VAPID 'sub' 로 적어 둔다 (처음 한 번)."""
    if not origin or settings.vapid_subject or _setting(db, KEY_SUBJECT):
        return
    u = urlparse(origin)
    if u.scheme == "https" and u.hostname and u.hostname not in ("localhost", "127.0.0.1"):
        _put_setting(db, KEY_SUBJECT, f"https://{u.netloc}")


def valid_endpoint(endpoint: str) -> bool:
    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


# --- 받는 사람 ----------------------------------------------------------------
def off_kinds(user: User) -> set[str]:
    return {k for k in (user.push_off or "").split(",") if k}


def set_off_kinds(user: User, off: set[str]) -> None:
    user.push_off = ",".join(k for k in KINDS if k in off) or None


@dataclass
class Outgoing:
    sub_id: int
    info: dict
    payload: str
    ttl: int
    urgency: str


def _payload(title: str, body: str, url: str, tag: str | None) -> str:
    return json.dumps({"title": title, "body": body, "url": url, "tag": tag}, ensure_ascii=False)


def notify(
    db: Session,
    user_ids,
    kind: str,
    title: str,
    body: str,
    url: str = "/app",
    tag: str | None = None,
    ttl: int = 3600,
    urgency: str = "normal",
) -> int:
    """회원들에게 알림을 줄 세운다 (커밋이 끝나면 보낸다). 그 종류를 끈 회원·탈퇴·승인 전 회원은 뺀다. 보낼 기기 수."""
    ids = {u for u in user_ids if u is not None}
    if not ids:
        return 0
    users = db.scalars(
        select(User).where(
            User.id.in_(ids), User.approval_status == ApprovalStatus.APPROVED, User.is_active.is_(True)
        )
    ).all()
    allowed = [u.id for u in users if kind not in off_kinds(u)]
    if not allowed:
        return 0
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(allowed))).all()
    payload = _payload(title, body, url, tag)
    queue: list[Outgoing] = db.info.setdefault("push_queue", [])
    queue.extend(Outgoing(s.id, _info(s), payload, ttl, urgency) for s in subs)
    return len(subs)


def _info(s: PushSubscription) -> dict:
    return {"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    queue = session.info.pop("push_queue", None)
    if not queue:
        return
    private, sub = session.info.pop("push_vapid", None) or (None, None)
    if INLINE:
        deliver(queue, private, sub)
    else:
        _executor.submit(deliver, queue, private, sub).add_done_callback(_log_failure)


def _log_failure(future) -> None:
    if future.exception() is not None:
        log.error("push delivery failed", exc_info=future.exception())


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop("push_queue", None)


@event.listens_for(Session, "before_commit")
def _before_commit(session: Session) -> None:
    # 커밋 뒤에는 이 세션으로 DB 를 읽지 않으므로, 보낼 때 쓸 키를 미리 꺼내 둔다
    if session.info.get("push_queue"):
        session.info["push_vapid"] = (ensure_keys(session)[1], subject(session))


# --- 보내기 -------------------------------------------------------------------
def _send(info: dict, payload: str, private_key: str, claims: dict, ttl: int, urgency: str) -> None:
    """한 기기에 보낸다 (테스트에서 바꿔 끼운다). 실패하면 WebPushException."""
    from pywebpush import webpush

    webpush(
        info,
        data=payload,
        vapid_private_key=private_key,
        vapid_claims=claims,
        ttl=ttl,
        timeout=10,
        headers={"Urgency": urgency},
    )


def _status(exc: Exception) -> int | None:
    return getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)


def deliver(queue: list[Outgoing], private_key: str | None = None, sub: str | None = None) -> tuple[int, int]:
    """줄 선 알림을 보낸다. 없어진 기기(404·410)는 지운다. (보낸 수, 실패 수)"""
    if private_key is None or sub is None:
        with SessionLocal() as db:
            private_key, sub = ensure_keys(db)[1], subject(db)
            db.commit()
    ok = failed = 0
    gone: list[int] = []
    for o in queue:
        try:
            # claims 는 보낼 때마다 새로: pywebpush 가 받는 곳(aud)을 이 dict 에 적어 둔다
            _send(o.info, o.payload, private_key, {"sub": sub}, o.ttl, o.urgency)
            ok += 1
        except Exception as exc:  # noqa: BLE001 — 한 기기가 실패해도 나머지는 보낸다
            failed += 1
            code = _status(exc)
            if code in (404, 410):
                gone.append(o.sub_id)
            else:
                log.warning("push failed (%s): %s", code, exc)
    if gone:
        with SessionLocal() as db:
            db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
            db.commit()
    return ok, failed


def send_now(db: Session, subs: list[PushSubscription], title: str, body: str, url: str = "/app") -> tuple[int, int]:
    """시험 알림: 기다리지 않고 바로 보내고 결과를 돌려준다."""
    private, sub = ensure_keys(db)[1], subject(db)
    db.commit()
    payload = _payload(title, body, url, "test")
    return deliver([Outgoing(s.id, _info(s), payload, 300, "high") for s in subs], private, sub)


# --- 한 번만 보내기 -------------------------------------------------------------
def _sent(db: Session, kind: str, ref: str, user_id: int | None = None) -> bool:
    q = select(PushSent.id).where(PushSent.kind == kind, PushSent.ref == ref)
    q = q.where(PushSent.user_id.is_(None) if user_id is None else PushSent.user_id == user_id)
    return db.scalar(q.limit(1)) is not None


def once(db: Session, kind: str, ref: str, user_id: int | None = None) -> bool:
    """처음이면 기록하고 True, 이미 보냈으면 False."""
    if _sent(db, kind, ref, user_id):
        return False
    db.add(PushSent(kind=kind, ref=ref, user_id=user_id))
    return True


# --- 문구 ---------------------------------------------------------------------
def day_text(d: date) -> str:
    return f"{d.month}/{d.day}({WEEKDAYS[d.weekday()]})"


def when_text(g: Gathering) -> str:
    return f"{day_text(g.event_date)} {g.start_time:%H:%M}" if g.start_time else day_text(g.event_date)


def court_text(g: Gathering, court: int | None) -> str:
    """대진의 n번째 코트 → 실제 코트 번호 ('5번 코트'), 모르면 'n코트' (화면의 courtName 과 같다)."""
    if court is None:
        return "코트"
    labels = court_labels(g.court_numbers)
    return f"{labels[court - 1]}번 코트" if 0 < court <= len(labels) else f"{court}코트"


def _where(g: Gathering) -> str:
    if not g.location:
        return ""
    return f" · {g.location}" + (f" {g.court_numbers}번" if g.court_numbers else "")


def gathering_url(g: Gathering) -> str:
    return f"/app/gatherings/{g.id}"


def match_day_ok(g: Gathering, now: datetime | None = None) -> bool:
    """경기 시작은 모임 날(자정을 넘긴 다음 날 새벽까지)에만."""
    today = (now or visibility.now_kst()).date()
    return g.event_date <= today <= g.event_date + timedelta(days=1)


def in_progress(g: Gathering, now: datetime | None = None) -> bool:
    """모임 시간 안(시작 30분 전 ~ 끝나고 1시간)인지. '다음 차례'는 이때만 — 집에서 점수를 몰아 적을 때는 보내지 않는다."""
    now = now or visibility.now_kst()
    if not match_day_ok(g, now):
        return False
    if g.start_time is None:
        return now.date() == g.event_date
    start = datetime.combine(g.event_date, g.start_time)
    end = datetime.combine(g.event_date, g.end_time) if g.end_time else start + timedelta(hours=4)
    if end <= start:
        end += timedelta(days=1)  # 자정을 넘기는 모임
    return start - timedelta(minutes=30) <= now <= end + timedelta(hours=1)


# --- 알림별 -------------------------------------------------------------------
def notice_posted(db: Session, notice: Notice, ref: str, author_id: int | None) -> None:
    """클럽 소식 (운영진 소식·교류전·대회 결과): 모든 회원·게스트에게. 같은 ref 는 한 번만 (마치기를 다시 눌러도)."""
    if not once(db, "news", ref):
        return
    users = db.scalars(
        select(User.id).where(User.approval_status == ApprovalStatus.APPROVED, User.is_active.is_(True))
    ).all()
    title = ("🎉 " if notice.kind == "celebrate" else "📢 ") + notice.title
    body = (notice.body or "").strip().replace("\n", " ")
    body = (body[:120] + "…") if len(body) > 120 else body
    notify(db, [u for u in users if u != author_id], "news", title, body or "클럽 소식을 확인해 보세요.", "/app",
           tag=f"news-{ref}", ttl=86400)


def promoted(db: Session, g: Gathering, user_ids: list[int]) -> None:
    """대기 → 참석."""
    if not user_ids or g.status == GatheringStatus.CANCELED or g.event_date < visibility.now_kst().date():
        return
    notify(db, user_ids, "waitlist", "대기에서 참석이 됐어요 🙌", f"{when_text(g)} {g.title}{_where(g)}",
           gathering_url(g), tag=f"waitlist-{g.id}", ttl=86400)


def match_started(db: Session, g: Gathering, players: list[int], court: str, title_extra: str,
                  line: str, tag: str, exclude: int | None) -> None:
    """경기 시작: 그 경기 선수에게 코트와 대진. 누른 사람은 빼고."""
    notify(db, [p for p in players if p != exclude], "match", f"🎾 경기 시작 · {court}",
           f"{title_extra}{line}", gathering_url(g), tag=tag, ttl=900, urgency="high")


def next_turn(db: Session, g: Gathering, players: list[int], court: str, line: str, ref: str,
              exclude: int | None) -> None:
    """앞 경기 점수가 들어오면 같은 코트 다음 경기 선수에게 미리 (한 번만)."""
    if not players or not once(db, "next", ref):
        return
    notify(db, [p for p in players if p != exclude], "match", f"⏭️ 다음 차례예요 · {court}",
           f"앞 경기가 끝났어요. 준비해 주세요 — {line}", gathering_url(g), tag=f"next-{ref}", ttl=1800,
           urgency="high")


# --- 1분마다 ------------------------------------------------------------------
def send_reminders(db: Session, now: datetime) -> int:
    """시작까지 1시간이 안 남은 일정의 참석자에게 (회원마다 한 번, 시작 시각을 바꾸면 다시)."""
    today = now.date()
    gatherings = db.scalars(
        select(Gathering).where(
            Gathering.event_date.in_([today, today + timedelta(days=1)]),
            Gathering.start_time.is_not(None),
            Gathering.status != GatheringStatus.CANCELED,
        )
    ).all()
    count = 0
    for g in gatherings:
        start = datetime.combine(g.event_date, g.start_time)
        left = start - now
        if not (timedelta(0) < left <= REMIND_BEFORE):
            continue
        ref = f"{g.id}@{start:%Y%m%dT%H%M}"
        targets = [
            p.user_id
            for p in g.participants
            if p.status == AttendanceStatus.ATTENDING and once(db, "reminder", ref, p.user_id)
        ]
        if not targets:
            continue
        minutes = int(left.total_seconds() // 60)
        soon = "1시간 뒤 시작" if minutes >= 55 else f"{max(minutes, 1)}분 뒤 시작"
        notify(db, targets, "reminder", f"⏰ {g.title} {soon}", f"{when_text(g)}{_where(g)}", gathering_url(g),
               tag=f"remind-{g.id}", ttl=3600, urgency="high")
        count += len(targets)
    return count


def _members(db: Session) -> list[User]:
    """일정 공개 알림을 받는 사람: 승인된 정회원·운영진 (게스트 빼고)."""
    users = db.scalars(
        select(User).where(User.approval_status == ApprovalStatus.APPROVED, User.is_active.is_(True))
    ).all()
    return [u for u in users if u.is_admin or u.member_type != MemberType.GUEST]


def send_openings(db: Session, now: datetime) -> int:
    """새로 열린 일정(정회원에게 보이기 시작한 일정)을 알린다. 한 번에 여러 개면 묶어서."""
    upcoming = db.scalars(
        select(Gathering)
        .where(Gathering.event_date >= now.date(), Gathering.status != GatheringStatus.CANCELED)
        .order_by(Gathering.event_date, Gathering.start_time, Gathering.id)
    ).all()
    opened = [g for g in upcoming if visibility.open_at(g) <= now]
    new = [g for g in opened if once(db, "open", str(g.id))]
    if _setting(db, KEY_OPEN_BASELINE) is None:
        _put_setting(db, KEY_OPEN_BASELINE, now.isoformat(timespec="minutes"))
        return 0  # 처음 켤 때: 이미 열려 있던 일정은 알리지 않고 기록만
    if not new:
        return 0
    groups: dict[tuple[int, ...], list[int]] = {}
    for u in _members(db):
        mine = tuple(g.id for g in new if g.created_by != u.id)  # 자기가 만든 일정은 이미 안다
        if mine:
            groups.setdefault(mine, []).append(u.id)
    by_id = {g.id: g for g in new}
    for ids, users in groups.items():
        gs = [by_id[i] for i in ids]
        if len(gs) == 1:
            g = gs[0]
            notify(db, users, "schedule", "📅 새 일정이 열렸어요", f"{when_text(g)} {g.title}{_where(g)}",
                   gathering_url(g), tag="open", ttl=86400)
        else:
            names = ", ".join(f"{day_text(g.event_date)} {g.title}" for g in gs[:3])
            more = f" 외 {len(gs) - 3}개" if len(gs) > 3 else ""
            notify(db, users, "schedule", f"📅 새 일정 {len(gs)}개가 열렸어요", f"{names}{more}", "/app/calendar",
                   tag="open", ttl=86400)
    return len(new)


def tick(now: datetime | None = None) -> None:
    now = now or visibility.now_kst()
    with SessionLocal() as db:
        send_reminders(db, now)
        send_openings(db, now)
        db.commit()


async def run_scheduler() -> None:
    """서버가 켜져 있는 동안 1분마다 tick (매분 2초쯤)."""
    while True:
        now = datetime.now()
        await asyncio.sleep(60 - now.second - now.microsecond / 1e6 + 2)
        try:
            await asyncio.to_thread(tick)
        except Exception:  # noqa: BLE001 — 한 번 실패해도 다음 분에 다시
            log.exception("push tick failed")
