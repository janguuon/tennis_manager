"""
내부 레이팅 · 티어(A~E) 라우터 — 관리자 전용.

계산은 rating.py 가 오테식 모임 대진 결과로만 한다. 여기서는 보여 주기만 한다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import rating
from ..database import get_db
from ..deps import get_current_admin
from ..models import ApprovalStatus, User
from ..schemas import (
    RatingBoard,
    RatingConfig,
    RatingEventRead,
    RatingHistory,
    RatingRow,
    UserBrief,
)

router = APIRouter(
    prefix="/admin/ratings", tags=["ratings"], dependencies=[Depends(get_current_admin)]
)


def _row(user: User, p: rating.PlayerRating) -> RatingRow:
    last_change = 0.0
    if p.history:
        last = p.history[-1]
        # 마지막으로 뛴 모임(없으면 마지막 날짜)의 경기들을 합친다
        last_change = sum(
            e.delta
            for e in p.history
            if (e.gathering_id, e.played_at) == (last.gathering_id, last.played_at)
        )
    return RatingRow(
        user=UserBrief.model_validate(user),
        rating=round(p.rating),
        tier=p.tier,
        games=p.games,
        wins=p.wins,
        losses=p.losses,
        draws=p.draws,
        provisional=p.provisional,
        placement_left=max(rating.PLACEMENT_GAMES - p.games, 0),
        peak=round(p.peak),
        last_played=p.last_played,
        last_change=round(last_change),
    )


def _config() -> RatingConfig:
    return RatingConfig(
        base=round(rating.BASE),
        k_placement=rating.K_PLACEMENT,
        k_regular=rating.K_REGULAR,
        placement_games=rating.PLACEMENT_GAMES,
        hysteresis=rating.HYSTERESIS,
        tier_floors={t: round(f) for t, f in rating.TIER_FLOORS},
    )


@router.get("", response_model=RatingBoard)
def rating_board(db: Session = Depends(get_db)):
    """승인된 활동 회원(게스트 포함)의 레이팅·티어. 경기 기록이 없으면 출발점 그대로."""
    book = rating.load(db)
    users = db.scalars(
        select(User).where(User.approval_status == ApprovalStatus.APPROVED, User.is_active.is_(True))
    ).all()
    rows = [_row(u, book.get(u.id)) for u in users]
    # 경기 기록 있는 사람 먼저, 레이팅 높은 순
    rows.sort(key=lambda r: (r.games == 0, -r.rating, r.user.name))
    counts = {t: 0 for t in rating.TIERS}
    for r in rows:
        if r.games:
            counts[r.tier] += 1
    return RatingBoard(
        rows=rows, counted_matches=len(book.games), tier_counts=counts, config=_config()
    )


@router.get("/{user_id}", response_model=RatingHistory)
def rating_history(user_id: int, db: Session = Depends(get_db)):
    """한 회원의 경기별 레이팅 변화 (최근 경기부터)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    book = rating.load(db)
    p = book.get(user_id)
    ids = {uid for e in p.history for uid in e.partners + e.opponents}
    briefs = {
        u.id: UserBrief.model_validate(u)
        for u in (db.scalars(select(User).where(User.id.in_(ids))).all() if ids else [])
    }
    events = [
        RatingEventRead(
            match_id=e.match_id,
            played_at=e.played_at,
            gathering_id=e.gathering_id,
            gathering_title=e.gathering_title,
            partners=[briefs[u] for u in e.partners if u in briefs],
            opponents=[briefs[u] for u in e.opponents if u in briefs],
            games_for=e.games_for,
            games_against=e.games_against,
            outcome=e.outcome,
            expected=round(e.expected, 3),
            actual=round(e.actual, 3),
            delta=round(e.delta, 1),
            rating_after=round(e.rating_after),
            tier_after=e.tier_after,
        )
        for e in reversed(p.history)
    ]
    return RatingHistory(row=_row(user, p), events=events)
