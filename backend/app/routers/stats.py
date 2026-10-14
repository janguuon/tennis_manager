"""
전적 통계 라우터: 개인 전적/승률, 페어 전적, 상대 전적, 팀 랭킹.

모든 수치는 Match/MatchPlayer 기록에서 실시간 집계한다(stats.py).
탈퇴한 회원이 뛴 경기는 모든 집계에서 빠지고, 복구하면 다시 반영된다.

승률·전적은 당분간 관리자만 본다(임원진 포함 다른 회원에게는 403).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import stats as stats_svc
from ..database import get_db
from ..deps import get_current_admin
from ..models import Match, MatchPlayer, User
from ..schemas import (
    OpponentStat,
    PartnerStat,
    PlayerStatsRead,
    RankingEntry,
    UserBrief,
)

router = APIRouter(prefix="/stats", tags=["stats"], dependencies=[Depends(get_current_admin)])


def _load_user_matches(db: Session, user_id: int) -> list[Match]:
    """해당 회원이 참가한 경기 (탈퇴한 회원과 함께한 경기 제외, 참가자/회원 eager load)."""
    return list(
        db.scalars(
            select(Match)
            .where(
                Match.players.any(MatchPlayer.user_id == user_id),
                stats_svc.without_withdrawn(),
            )
            .options(selectinload(Match.players).selectinload(MatchPlayer.user))
            .order_by(Match.played_at.desc())
        ).all()
    )


def _ensure_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")
    return user


@router.get("/users/{user_id}", response_model=PlayerStatsRead)
def get_player_stats(
    user_id: int,
    db: Session = Depends(get_db),
):
    """개인 종합 전적 + 단식/남복/여복/혼복별 승률."""
    user = _ensure_user(db, user_id)
    matches = _load_user_matches(db, user_id)
    result = stats_svc.player_stats(matches, user_id)
    return PlayerStatsRead(user=UserBrief.model_validate(user), **result)


@router.get("/users/{user_id}/partners", response_model=list[PartnerStat])
def get_partner_stats(
    user_id: int,
    db: Session = Depends(get_db),
):
    """파트너(페어)별 전적."""
    _ensure_user(db, user_id)
    matches = _load_user_matches(db, user_id)
    return stats_svc.partner_stats(matches, user_id)


@router.get("/users/{user_id}/opponents", response_model=list[OpponentStat])
def get_opponent_stats(
    user_id: int,
    db: Session = Depends(get_db),
):
    """상대방별 상대 전적."""
    _ensure_user(db, user_id)
    matches = _load_user_matches(db, user_id)
    return stats_svc.opponent_stats(matches, user_id)


@router.get("/ranking", response_model=list[RankingEntry])
def get_ranking(
    db: Session = Depends(get_db),
    min_games: int = Query(0, ge=0, description="랭킹 포함 최소 경기 수(승+패)"),
):
    """팀 랭킹: 승률 → 승수 순. 탈퇴한 회원과 함께한 경기는 빼고 계산한다."""
    matches = list(
        db.scalars(
            select(Match)
            .where(stats_svc.without_withdrawn())
            .options(selectinload(Match.players).selectinload(MatchPlayer.user))
        ).all()
    )
    return stats_svc.ranking(matches, min_games=min_games)
