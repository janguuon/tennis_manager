"""
전적(경기) 라우터: 경기 결과 입력/조회/수정/삭제.

여기서 생성된 Match가 각 회원의 전적 집계(/stats)에 그대로 반영된다.
모임의 자동/수동 대진(Draw)이 확정되면, 그 결과를 이 API로 Match화하여
전적에 반영하는 흐름으로 연결된다.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import Gathering, Match, MatchPlayer, MatchType, TeamSide, User
from ..schemas import MatchCreate, MatchRead, MatchUpdate

router = APIRouter(prefix="/matches", tags=["matches"])


def _resolve_winner(team1_score: int, team2_score: int, explicit: TeamSide | None) -> TeamSide | None:
    """승팀이 명시되지 않으면 점수로 판정. 동점이면 무승부(NULL)."""
    if explicit is not None:
        return explicit
    if team1_score > team2_score:
        return TeamSide.TEAM_1
    if team2_score > team1_score:
        return TeamSide.TEAM_2
    return None


def _load_match(db: Session, match_id: int) -> Match:
    match = db.scalar(
        select(Match)
        .where(Match.id == match_id)
        .options(selectinload(Match.players).selectinload(MatchPlayer.user))
    )
    if not match:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="경기를 찾을 수 없습니다.")
    return match


@router.post("", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match(
    payload: MatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """경기 결과 입력 → 참가자 전적에 반영."""
    # 모임 연결 검증
    if payload.gathering_id is not None and not db.get(Gathering, payload.gathering_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="연결할 모임을 찾을 수 없습니다.")

    # 참가자 존재 검증
    user_ids = [p.user_id for p in payload.players]
    found = db.scalars(select(User.id).where(User.id.in_(user_ids))).all()
    missing = set(user_ids) - set(found)
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"존재하지 않는 회원 id: {sorted(missing)}"
        )

    match = Match(
        match_type=payload.match_type,
        played_at=payload.played_at,
        location=payload.location,
        team1_score=payload.team1_score,
        team2_score=payload.team2_score,
        winner_team=_resolve_winner(
            payload.team1_score, payload.team2_score, payload.winner_team
        ),
        gathering_id=payload.gathering_id,
        recorded_by=current_user.id,
        note=payload.note,
        players=[
            MatchPlayer(user_id=p.user_id, team=p.team) for p in payload.players
        ],
    )
    db.add(match)
    db.commit()
    return _load_match(db, match.id)


@router.get("", response_model=list[MatchRead])
def list_matches(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    user_id: int | None = Query(None, description="해당 회원이 참가한 경기만"),
    gathering_id: int | None = None,
    match_type: MatchType | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    skip: int = 0,
    limit: int = Query(100, le=500),
):
    """경기(전적) 히스토리 조회. 다양한 필터 지원."""
    stmt = select(Match).options(
        selectinload(Match.players).selectinload(MatchPlayer.user)
    )
    if user_id is not None:
        stmt = stmt.where(Match.players.any(MatchPlayer.user_id == user_id))
    if gathering_id is not None:
        stmt = stmt.where(Match.gathering_id == gathering_id)
    if match_type is not None:
        stmt = stmt.where(Match.match_type == match_type)
    if date_from is not None:
        stmt = stmt.where(Match.played_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Match.played_at <= date_to)

    stmt = stmt.order_by(Match.played_at.desc(), Match.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.get("/{match_id}", response_model=MatchRead)
def get_match(
    match_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return _load_match(db, match_id)


@router.patch("/{match_id}", response_model=MatchRead)
def update_match(
    match_id: int,
    payload: MatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """경기 결과 수정. 기록자 본인 또는 관리자만 가능."""
    match = _load_match(db, match_id)
    if match.recorded_by not in (None, current_user.id) and not current_user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="수정 권한이 없습니다.")

    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(match, field_name, value)

    # 점수가 바뀌고 승팀이 명시되지 않았다면 재판정
    if ("team1_score" in data or "team2_score" in data) and "winner_team" not in data:
        match.winner_team = _resolve_winner(match.team1_score, match.team2_score, None)

    db.commit()
    return _load_match(db, match.id)


@router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_match(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """경기 삭제 → 전적에서 제외. 기록자 본인 또는 관리자만 가능."""
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="경기를 찾을 수 없습니다.")
    if match.recorded_by not in (None, current_user.id) and not current_user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="삭제 권한이 없습니다.")
    db.delete(match)
    db.commit()
