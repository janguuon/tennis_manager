"""클럽 소식: 운영진(관리자·임원진·총무)이 축하·소식을 올리고, 회원은 들어올 때 안 본 소식을 팝업으로 본다."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Notice, User
from ..schemas import NoticeCreate, NoticeRead

router = APIRouter(prefix="/notices", tags=["notices"])


def _require_staff(user: User) -> None:
    if not user.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="클럽 소식은 운영진만 올리고 지울 수 있어요.")


def _read(n: Notice, user: User) -> NoticeRead:
    return NoticeRead(
        id=n.id,
        kind=n.kind,
        title=n.title,
        body=n.body,
        show_until=n.show_until,
        created_at=n.created_at,
        author_name=n.author.name if n.author else None,
        # 직접 올린 소식은 팝업으로 다시 띄우지 않는다
        is_new=n.created_by != user.id
        and (user.notice_seen_at is None or n.created_at > user.notice_seen_at),
    )


@router.get("", response_model=list[NoticeRead])
def list_notices(
    all: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """게시 중인 소식 (최신순). 운영진은 all=true로 게시가 끝난 소식까지 본다."""
    query = select(Notice).order_by(Notice.created_at.desc(), Notice.id.desc())
    if not (all and current_user.is_staff):
        query = query.where(or_(Notice.show_until.is_(None), Notice.show_until >= date.today()))
    return [_read(n, current_user) for n in db.scalars(query)]


@router.post("", response_model=NoticeRead, status_code=status.HTTP_201_CREATED)
def create_notice(
    payload: NoticeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_staff(current_user)
    notice = Notice(**payload.model_dump(), created_by=current_user.id)
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return _read(notice, current_user)


@router.delete("/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notice(
    notice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_staff(current_user)
    notice = db.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="소식을 찾을 수 없어요.")
    db.delete(notice)
    db.commit()


@router.post("/seen", status_code=status.HTTP_204_NO_CONTENT)
def mark_seen(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """팝업에서 '확인'을 누르면: 지금까지 올라온 소식은 다시 띄우지 않는다."""
    current_user.notice_seen_at = datetime.now()
    db.commit()
