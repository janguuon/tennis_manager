"""
대진표(Draw) 라우터: 자동 생성 / 수동 편집 / 결과 입력(→ 전적 반영).

흐름
----
1. 모임 참석자(ATTENDING) 확정
2. POST /gatherings/{id}/draws/generate  → 코트 수 기준 자동 대진 생성
   또는 POST /gatherings/{id}/draws       → 빈 대진표 만들고 수동으로 경기 추가
3. PATCH /draw-matches/{id}              → 선수/코트 수동 편집
4. POST /draw-matches/{id}/result        → 결과 입력 시 Match 생성 → 전적 반영
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import matchmaking
from ..database import get_db
from ..deps import get_current_user
from ..models import (
    AttendanceStatus,
    Draw,
    DrawMatch,
    Gathering,
    Match,
    MatchPlayer,
    MatchType,
    Participant,
    TeamSide,
    User,
)
from ..schemas import (
    DrawCreate,
    DrawGenerateRequest,
    DrawMatchCreate,
    DrawMatchEdit,
    DrawMatchRead,
    DrawMatchResultInput,
    DrawRead,
    UserBrief,
)

router = APIRouter(tags=["draws"])


# --- 직렬화 헬퍼 ------------------------------------------------------------
def _draw_match_player_ids(dm: DrawMatch) -> list[int]:
    return [
        pid
        for pid in (
            dm.team1_player1_id,
            dm.team1_player2_id,
            dm.team2_player1_id,
            dm.team2_player2_id,
        )
        if pid is not None
    ]


def _build_draw_read(draw: Draw, db: Session) -> DrawRead:
    # 대진에 등장하는 모든 회원을 한 번에 로드
    ids: set[int] = set()
    for dm in draw.draw_matches:
        ids.update(_draw_match_player_ids(dm))
    users = {
        u.id: UserBrief.model_validate(u)
        for u in (db.scalars(select(User).where(User.id.in_(ids))).all() if ids else [])
    }

    def briefs(*pids):
        return [users[p] for p in pids if p is not None and p in users]

    matches = [
        DrawMatchRead(
            id=dm.id,
            court_number=dm.court_number,
            round_number=dm.round_number,
            match_type=dm.match_type,
            team1=briefs(dm.team1_player1_id, dm.team1_player2_id),
            team2=briefs(dm.team2_player1_id, dm.team2_player2_id),
            result_match_id=dm.result_match_id,
        )
        for dm in sorted(
            draw.draw_matches, key=lambda d: ((d.round_number or 0), (d.court_number or 0))
        )
    ]
    return DrawRead(
        id=draw.id,
        gathering_id=draw.gathering_id,
        name=draw.name,
        generation_method=draw.generation_method,
        created_at=draw.created_at,
        matches=matches,
    )


def _load_draw(db: Session, draw_id: int) -> Draw:
    draw = db.scalar(
        select(Draw).where(Draw.id == draw_id).options(selectinload(Draw.draw_matches))
    )
    if not draw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진표를 찾을 수 없습니다.")
    return draw


def _require_organizer(db: Session, gathering_id: int, user: User) -> Gathering:
    g = db.get(Gathering, gathering_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    if g.created_by != user.id and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="모임 주최자 또는 관리자만 가능합니다.")
    return g


# --- 자동 생성 --------------------------------------------------------------
@router.post(
    "/gatherings/{gathering_id}/draws/generate",
    response_model=DrawRead,
    status_code=status.HTTP_201_CREATED,
)
def generate_draw(
    gathering_id: int,
    payload: DrawGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """참석(ATTENDING) 인원으로 코트 수 기준 자동 대진을 생성한다."""
    gathering = _require_organizer(db, gathering_id, current_user)

    attendees = db.scalars(
        select(User)
        .join(Participant, Participant.user_id == User.id)
        .where(
            Participant.gathering_id == gathering_id,
            Participant.status == AttendanceStatus.ATTENDING,
        )
    ).all()

    need = 2 if payload.match_type == MatchType.SINGLES else 4
    if len(attendees) < need:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"대진을 만들기엔 참석 인원이 부족합니다. (필요 {need}명, 현재 {len(attendees)}명)",
        )

    generated = matchmaking.generate(
        list(attendees), gathering.court_count, payload.match_type, payload.method
    )

    draw = Draw(
        gathering_id=gathering_id,
        name=payload.name,
        generation_method=payload.method,
        draw_matches=[
            DrawMatch(
                court_number=g["court_number"],
                round_number=g["round_number"],
                match_type=payload.match_type,
                team1_player1_id=g["team1_ids"][0] if len(g["team1_ids"]) > 0 else None,
                team1_player2_id=g["team1_ids"][1] if len(g["team1_ids"]) > 1 else None,
                team2_player1_id=g["team2_ids"][0] if len(g["team2_ids"]) > 0 else None,
                team2_player2_id=g["team2_ids"][1] if len(g["team2_ids"]) > 1 else None,
            )
            for g in generated
        ],
    )
    db.add(draw)
    db.commit()
    return _build_draw_read(_load_draw(db, draw.id), db)


# --- 수동 생성/편집 ---------------------------------------------------------
@router.post(
    "/gatherings/{gathering_id}/draws",
    response_model=DrawRead,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_draw(
    gathering_id: int,
    payload: DrawCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """빈 대진표 생성 (이후 /draws/{id}/matches 로 경기 추가)."""
    _require_organizer(db, gathering_id, current_user)
    draw = Draw(gathering_id=gathering_id, name=payload.name, generation_method="manual")
    db.add(draw)
    db.commit()
    return _build_draw_read(_load_draw(db, draw.id), db)


@router.get("/gatherings/{gathering_id}/draws", response_model=list[DrawRead])
def list_draws(
    gathering_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    draws = db.scalars(
        select(Draw)
        .where(Draw.gathering_id == gathering_id)
        .options(selectinload(Draw.draw_matches))
        .order_by(Draw.created_at)
    ).all()
    return [_build_draw_read(d, db) for d in draws]


@router.get("/draws/{draw_id}", response_model=DrawRead)
def get_draw(
    draw_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return _build_draw_read(_load_draw(db, draw_id), db)


@router.delete("/draws/{draw_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draw(
    draw_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draw = _load_draw(db, draw_id)
    _require_organizer(db, draw.gathering_id, current_user)
    db.delete(draw)
    db.commit()


@router.post("/draws/{draw_id}/matches", response_model=DrawMatchRead, status_code=201)
def add_draw_match(
    draw_id: int,
    payload: DrawMatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """수동으로 대진 경기 한 건 추가."""
    draw = _load_draw(db, draw_id)
    _require_organizer(db, draw.gathering_id, current_user)
    dm = DrawMatch(draw_id=draw_id, **payload.model_dump())
    db.add(dm)
    db.commit()
    db.refresh(dm)
    return _single_draw_match_read(dm, db)


@router.patch("/draw-matches/{draw_match_id}", response_model=DrawMatchRead)
def edit_draw_match(
    draw_match_id: int,
    payload: DrawMatchEdit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """대진 수동 편집 (선수 교체, 코트/라운드 변경)."""
    dm = db.get(DrawMatch, draw_match_id)
    if not dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진 경기를 찾을 수 없습니다.")
    draw = db.get(Draw, dm.draw_id)
    _require_organizer(db, draw.gathering_id, current_user)
    if dm.result_match_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="이미 결과가 입력된 대진은 수정할 수 없습니다.")

    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(dm, field_name, value)
    db.commit()
    db.refresh(dm)
    return _single_draw_match_read(dm, db)


@router.delete("/draw-matches/{draw_match_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draw_match(
    draw_match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dm = db.get(DrawMatch, draw_match_id)
    if not dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진 경기를 찾을 수 없습니다.")
    draw = db.get(Draw, dm.draw_id)
    _require_organizer(db, draw.gathering_id, current_user)
    db.delete(dm)
    db.commit()


# --- 결과 입력 → 전적 반영 --------------------------------------------------
@router.post("/draw-matches/{draw_match_id}/result", response_model=DrawMatchRead)
def record_draw_match_result(
    draw_match_id: int,
    payload: DrawMatchResultInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """대진 결과 입력 → Match 생성 후 전적에 반영하고 대진에 연결한다."""
    dm = db.get(DrawMatch, draw_match_id)
    if not dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진 경기를 찾을 수 없습니다.")
    draw = db.get(Draw, dm.draw_id)
    gathering = _require_organizer(db, draw.gathering_id, current_user)

    if dm.result_match_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="이미 결과가 입력된 대진입니다. 먼저 해당 경기를 삭제하세요.",
        )

    team1_ids = [pid for pid in (dm.team1_player1_id, dm.team1_player2_id) if pid is not None]
    team2_ids = [pid for pid in (dm.team2_player1_id, dm.team2_player2_id) if pid is not None]
    need = 1 if dm.match_type == MatchType.SINGLES else 2
    if len(team1_ids) != need or len(team2_ids) != need:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="대진의 선수 구성이 완전하지 않습니다."
        )

    winner = payload.winner_team
    if winner is None:
        if payload.team1_score > payload.team2_score:
            winner = TeamSide.TEAM_1
        elif payload.team2_score > payload.team1_score:
            winner = TeamSide.TEAM_2

    match = Match(
        match_type=dm.match_type,
        played_at=payload.played_at or gathering.event_date,
        location=payload.location or gathering.location,
        team1_score=payload.team1_score,
        team2_score=payload.team2_score,
        winner_team=winner,
        gathering_id=gathering.id,
        recorded_by=current_user.id,
        note=payload.note,
        players=(
            [MatchPlayer(user_id=uid, team=TeamSide.TEAM_1) for uid in team1_ids]
            + [MatchPlayer(user_id=uid, team=TeamSide.TEAM_2) for uid in team2_ids]
        ),
    )
    db.add(match)
    db.flush()  # match.id 확보
    dm.result_match_id = match.id
    db.commit()
    db.refresh(dm)
    return _single_draw_match_read(dm, db)


# --- 단건 직렬화 ------------------------------------------------------------
def _single_draw_match_read(dm: DrawMatch, db: Session) -> DrawMatchRead:
    ids = _draw_match_player_ids(dm)
    users = {
        u.id: UserBrief.model_validate(u)
        for u in (db.scalars(select(User).where(User.id.in_(ids))).all() if ids else [])
    }

    def briefs(*pids):
        return [users[p] for p in pids if p is not None and p in users]

    return DrawMatchRead(
        id=dm.id,
        court_number=dm.court_number,
        round_number=dm.round_number,
        match_type=dm.match_type,
        team1=briefs(dm.team1_player1_id, dm.team1_player2_id),
        team2=briefs(dm.team2_player1_id, dm.team2_player2_id),
        result_match_id=dm.result_match_id,
    )
