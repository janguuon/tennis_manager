"""
폰 알림 설정 (/push): 이 폰에서 알림 받기(구독)·끄기, 종류별 켜기/끄기, 시험 알림.

알림을 보내는 쪽은 push.py.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import push
from ..database import get_db
from ..deps import get_current_user
from ..models import PushSubscription, User
from ..schemas import (
    PushEndpoint,
    PushSettingsRead,
    PushSettingsUpdate,
    PushSubscribe,
    PushTestRequest,
    PushTestResult,
)

router = APIRouter(prefix="/push", tags=["push"])


def _settings(db: Session, user: User) -> PushSettingsRead:
    off = push.off_kinds(user)
    devices = db.scalar(
        select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user.id)
    )
    return PushSettingsRead(
        public_key=push.public_key(db),
        kinds={k: k not in off for k in push.KINDS},
        devices=devices or 0,
        guest=user.is_guest,
    )


@router.get("/settings", response_model=PushSettingsRead)
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _settings(db, current_user)


@router.put("/settings", response_model=PushSettingsRead)
def update_settings(
    payload: PushSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    off = push.off_kinds(current_user)
    for kind, on in payload.kinds.items():
        (off.discard if on else off.add)(kind)
    push.set_off_kinds(current_user, off)
    db.commit()
    return _settings(db, current_user)


@router.post("/subscriptions", response_model=PushSettingsRead)
def subscribe(
    payload: PushSubscribe,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """이 폰에서 알림 받기. 같은 기기(푸시 주소)를 다른 아이디로 켜면 그 아이디로 옮긴다."""
    if not push.valid_endpoint(payload.endpoint):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="이 브라우저의 알림 주소는 쓸 수 없어요.")
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=payload.endpoint, user_id=current_user.id, p256dh="", auth="")
        db.add(sub)
    sub.user_id = current_user.id
    sub.p256dh = payload.keys.p256dh
    sub.auth = payload.keys.auth
    sub.user_agent = payload.user_agent
    push.remember_origin(db, payload.origin)
    db.commit()
    return _settings(db, current_user)


@router.post("/unsubscribe", response_model=PushSettingsRead)
def unsubscribe(
    payload: PushEndpoint,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """이 폰 알림 끄기."""
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == current_user.id
        )
    )
    db.commit()
    return _settings(db, current_user)


@router.post("/test", response_model=PushTestResult)
def test_push(
    payload: PushTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """시험 알림: 바로 보내고 결과를 알려 준다."""
    q = select(PushSubscription).where(PushSubscription.user_id == current_user.id)
    if payload.endpoint:
        q = q.where(PushSubscription.endpoint == payload.endpoint)
    subs = db.scalars(q).all()
    if not subs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="알림을 켠 기기가 없어요. 먼저 '알림 받기'를 눌러 주세요.")
    sent, failed = push.send_now(db, list(subs), "🔔 알림이 잘 와요", f"{current_user.name}님, 이제 이 폰으로 알림을 받아요.")
    return PushTestResult(sent=sent, failed=failed)
