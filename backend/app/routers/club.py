"""모임 통장 (오테식 모임 게스트비 입금 계좌): 보기는 회원 누구나, 바꾸기는 관리자·총무."""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..club_account import ClubAccount, apply_to_upcoming, get_club_account, set_club_account
from ..database import get_db
from ..deps import get_current_settler, get_current_user
from ..models import User
from ..schemas import ClubAccountRead, ClubAccountResult, ClubAccountUpdate

router = APIRouter(prefix="/club", tags=["club"])


def _read(account: ClubAccount | None) -> ClubAccountRead | None:
    if account is None:
        return None
    return ClubAccountRead(
        bank=account.bank, account_number=account.account_number, account_holder=account.account_holder
    )


@router.get("/account", response_model=ClubAccountRead | None)
def read_club_account(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _read(get_club_account(db))


@router.put("/account", response_model=ClubAccountResult)
def update_club_account(
    payload: ClubAccountUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_settler),
):
    """모임 통장을 정한다. apply_upcoming 이면 다가오는 오테식 모임의 계좌도 바꾼다."""
    account = ClubAccount(
        bank=payload.bank or None,
        account_number=payload.account_number,
        account_holder=payload.account_holder or None,
    )
    set_club_account(db, account)
    updated = apply_to_upcoming(db, account, date.today()) if payload.apply_upcoming else 0
    db.commit()
    return ClubAccountResult(account=_read(account), updated=updated)
