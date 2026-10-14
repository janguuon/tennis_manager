"""
모임 통장: 오테식 정모·벙개의 게스트비를 받는 클럽 공용 계좌.

- 관리자·총무가 앱에서 정한다(ClubSetting). 계좌번호를 코드에 두지 않는다.
- 오테식 모임을 만들 때(직접 등록·엑셀 등록·종류 변경) 계좌가 비어 있으면 모임 통장으로 채운다.
- 모임 통장을 아직 정하지 않았으면 가장 최근 오테식 모임의 계좌를 쓴다(예전 방식).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CLUB_KINDS, ClubSetting, Gathering, GatheringStatus

_KEYS = {
    "bank": "club_account.bank",
    "account_number": "club_account.number",
    "account_holder": "club_account.holder",
}


@dataclass(frozen=True)
class ClubAccount:
    bank: str | None
    account_number: str
    account_holder: str | None


def get_club_account(db: Session) -> ClubAccount | None:
    """관리자·총무가 정한 모임 통장 (없으면 None)."""
    rows = {s.key: s.value for s in db.scalars(select(ClubSetting).where(ClubSetting.key.in_(_KEYS.values())))}
    number = rows.get(_KEYS["account_number"])
    if not number:
        return None
    return ClubAccount(
        bank=rows.get(_KEYS["bank"]) or None,
        account_number=number,
        account_holder=rows.get(_KEYS["account_holder"]) or None,
    )


def set_club_account(db: Session, account: ClubAccount) -> None:
    for field, key in _KEYS.items():
        value = getattr(account, field)
        row = db.get(ClubSetting, key)
        if value:
            if row is None:
                db.add(ClubSetting(key=key, value=value))
            else:
                row.value = value
        elif row is not None:
            db.delete(row)


def default_club_account(db: Session) -> ClubAccount | None:
    """새 오테식 모임에 넣을 계좌: 모임 통장, 없으면 가장 최근 오테식 모임의 계좌."""
    account = get_club_account(db)
    if account is not None:
        return account
    latest = db.scalar(
        select(Gathering)
        .where(Gathering.kind.in_(CLUB_KINDS), Gathering.account_number.is_not(None))
        .order_by(Gathering.event_date.desc(), Gathering.id.desc())
        .limit(1)
    )
    if latest is None:
        return None
    return ClubAccount(latest.bank, latest.account_number, latest.account_holder)


def fill_club_account(gathering: Gathering, account: ClubAccount | None) -> None:
    """오테식 모임인데 계좌가 비어 있으면 채운다 (직접 적은 계좌는 그대로)."""
    if account is None or not gathering.is_club or gathering.account_number:
        return
    gathering.bank = account.bank
    gathering.account_number = account.account_number
    gathering.account_holder = account.account_holder


def apply_to_upcoming(db: Session, account: ClubAccount, today: date) -> int:
    """오늘 이후의 취소되지 않은 오테식 모임을 모임 통장으로 바꾼다. 바뀐 모임 수."""
    changed = 0
    for g in db.scalars(
        select(Gathering).where(
            Gathering.kind.in_(CLUB_KINDS),
            Gathering.event_date >= today,
            Gathering.status != GatheringStatus.CANCELED,
        )
    ):
        if (g.bank, g.account_number, g.account_holder) != (
            account.bank,
            account.account_number,
            account.account_holder,
        ):
            g.bank = account.bank
            g.account_number = account.account_number
            g.account_holder = account.account_holder
            changed += 1
    return changed
