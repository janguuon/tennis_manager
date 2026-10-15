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

from .. import matchmaking, rating, visibility
from ..database import get_db
from ..deps import GUEST_ONLY_VIEW_AND_VOTE, get_current_user
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
    DrawBalance,
    DrawCreate,
    DrawSlotChange,
    DrawGenerateRequest,
    DrawMatchCreate,
    DrawMatchEdit,
    DrawMatchRead,
    DrawMatchResultInput,
    DrawMatchResultUpdate,
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


def _balance(
    dm: DrawMatch, book: rating.RatingBook | None
) -> DrawBalance | None:
    """관리자에게만 보여 주는 예상 밸런스. 결과가 있으면 그 경기 직전 값."""
    if book is None:
        return None
    t1 = [p for p in (dm.team1_player1_id, dm.team1_player2_id) if p is not None]
    t2 = [p for p in (dm.team2_player1_id, dm.team2_player2_id) if p is not None]
    if not t1 or not t2:
        return None
    tiers = {uid: book.get(uid).tier for uid in t1 + t2}
    pre = book.pre_match.get(dm.result_match_id) if dm.result_match_id else None
    if pre is not None:
        r1, r2, e1 = pre.team1_rating, pre.team2_rating, pre.expected_team1
    else:
        r1 = sum(book.rating(u) for u in t1) / len(t1)
        r2 = sum(book.rating(u) for u in t2) / len(t2)
        e1 = rating.expected(r1, r2)
    return DrawBalance(
        team1_rating=round(r1), team2_rating=round(r2), expected_team1=round(e1, 3), tiers=tiers
    )


def _draw_match_reads(
    dms: list[DrawMatch], db: Session, book: rating.RatingBook | None = None
) -> list[DrawMatchRead]:
    # 대진에 등장하는 모든 회원과 입력된 결과를 한 번에 로드
    ids: set[int] = set()
    for dm in dms:
        ids.update(_draw_match_player_ids(dm))
    users = {
        u.id: UserBrief.model_validate(u)
        for u in (db.scalars(select(User).where(User.id.in_(ids))).all() if ids else [])
    }
    result_ids = [dm.result_match_id for dm in dms if dm.result_match_id is not None]
    results = {
        m.id: m
        for m in (
            db.scalars(select(Match).where(Match.id.in_(result_ids))).all() if result_ids else []
        )
    }

    def briefs(*pids):
        return [users[p] for p in pids if p is not None and p in users]

    reads = []
    for dm in dms:
        result = results.get(dm.result_match_id) if dm.result_match_id else None
        reads.append(
            DrawMatchRead(
                id=dm.id,
                court_number=dm.court_number,
                round_number=dm.round_number,
                match_type=dm.match_type,
                team1=briefs(dm.team1_player1_id, dm.team1_player2_id),
                team2=briefs(dm.team2_player1_id, dm.team2_player2_id),
                result_match_id=dm.result_match_id,
                team1_score=result.team1_score if result else None,
                team2_score=result.team2_score if result else None,
                balance=_balance(dm, book),
                slot_ids=[getattr(dm, slot) for slot in _SLOT_COLUMNS],
            )
        )
    return reads


def _build_draw_read(draw: Draw, db: Session, book: rating.RatingBook | None = None) -> DrawRead:
    ordered = sorted(
        draw.draw_matches, key=lambda d: ((d.round_number or 0), (d.court_number or 0))
    )
    return DrawRead(
        id=draw.id,
        gathering_id=draw.gathering_id,
        name=draw.name,
        generation_method=draw.generation_method,
        created_at=draw.created_at,
        matches=_draw_match_reads(ordered, db, book),
    )


def _book_for(db: Session, user: User) -> rating.RatingBook | None:
    """티어·레이팅은 관리자만 본다."""
    return rating.load(db) if user.is_admin else None


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
    # 모임 관리 권한과 같다: 오테식 모임은 클럽 일정이라 임원진도 대진을 짜고 결과를 입력한다.
    # 게스트는 보기와 투표만 한다
    if not user.is_guest and (g.created_by == user.id or user.is_admin or (g.is_club and user.is_staff)):
        return g
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="모임 주최자 또는 관리자만 가능합니다.")


_SLOT_COLUMNS = ("team1_player1_id", "team1_player2_id", "team2_player1_id", "team2_player2_id")


def _require_editor(db: Session, gathering_id: int, user: User) -> Gathering:
    """대진 자리 바꾸기: 운영진(주최자·관리자·오테식 모임 임원진) 또는 그 모임 참석자. 게스트는 보기만."""
    g = db.get(Gathering, gathering_id)
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="모임을 찾을 수 없습니다.")
    if user.is_guest:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=GUEST_ONLY_VIEW_AND_VOTE)
    if g.created_by == user.id or user.is_admin or (g.is_club and user.is_staff):
        return g
    attending = db.scalar(
        select(Participant.id).where(
            Participant.gathering_id == gathering_id,
            Participant.user_id == user.id,
            Participant.status == AttendanceStatus.ATTENDING,
        )
    )
    if attending is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="이 모임 참석자만 대진을 바꿀 수 있어요.")
    return g


def _retype(dm: DrawMatch, genders: dict) -> None:
    """복식은 바뀐 성별 구성으로 남복·여복·혼복·잡복을 다시 붙인다."""
    if dm.match_type == MatchType.SINGLES:
        return
    t1 = [p for p in (dm.team1_player1_id, dm.team1_player2_id) if p is not None]
    t2 = [p for p in (dm.team2_player1_id, dm.team2_player2_id) if p is not None]
    if len(t1) == 2 and len(t2) == 2:
        dm.match_type = matchmaking.classify(t1, t2, genders)


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
    """참석(ATTENDING) 인원으로 코트 수 기준 자동 대진을 생성한다.

    기본은 남복·여복·혼복 자동 구성(어쩔 수 없을 때만 잡복), 라운드 수는 모임 시간 기준.
    """
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

    method = "balanced" if payload.method in ("balanced", "skill") else "random"
    book = rating.load(db)
    partners, opponents = matchmaking.recent_meetings(book.games, gathering.event_date)
    earlier = db.scalars(
        select(DrawMatch).join(Draw).where(Draw.gathering_id == gathering_id)
    ).all()
    context = matchmaking.MatchContext(
        ratings={uid: p.rating for uid, p in book.players.items()},
        partners=partners,
        opponents=opponents,
        earlier=[
            (
                [p for p in (dm.team1_player1_id, dm.team1_player2_id) if p is not None],
                [p for p in (dm.team2_player1_id, dm.team2_player2_id) if p is not None],
            )
            for dm in earlier
        ],
    )
    try:
        generated = matchmaking.generate(
            list(attendees),
            gathering.court_count,
            payload.match_type,
            method,
            rounds=payload.rounds
            or matchmaking.suggested_rounds(gathering.start_time, gathering.end_time),
            context=context,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))

    draw = Draw(
        gathering_id=gathering_id,
        name=payload.name,
        generation_method=method,
        draw_matches=[
            DrawMatch(
                court_number=g["court_number"],
                round_number=g["round_number"],
                match_type=g["match_type"],
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
    return _build_draw_read(_load_draw(db, draw.id), db, book if current_user.is_admin else None)


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
    current_user: User = Depends(get_current_user),
):
    gathering = db.get(Gathering, gathering_id)
    if gathering is not None and not visibility.is_open_for(current_user, gathering):
        opens = visibility.view_open_at_for(current_user, gathering.event_date)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"아직 공개되지 않은 일정이에요. {visibility.format_open_at(opens)}부터 보고 투표할 수 있어요.",
        )
    draws = db.scalars(
        select(Draw)
        .where(Draw.gathering_id == gathering_id)
        .options(selectinload(Draw.draw_matches))
        .order_by(Draw.created_at)
    ).all()
    book = _book_for(db, current_user) if draws else None
    return [_build_draw_read(d, db, book) for d in draws]


@router.get("/draws/{draw_id}", response_model=DrawRead)
def get_draw(
    draw_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_draw_read(_load_draw(db, draw_id), db, _book_for(db, current_user))


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


@router.post("/draw-matches/{draw_match_id}/slot", response_model=DrawRead)
def change_draw_slot(
    draw_match_id: int,
    payload: DrawSlotChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """현장에서 대진 바꾸기: 한 자리에 참석자를 넣는다.

    - 같은 라운드의 다른 경기(또는 같은 경기 다른 자리)에 있던 사람이면 두 사람 자리를 서로 바꾼다.
    - 그 라운드에 쉬던 사람이면 들어가고, 원래 있던 사람이 쉰다.
    결과가 입력된 경기는 바꿀 수 없다. 모임 참석자와 운영진이 쓸 수 있다.
    """
    dm = db.get(DrawMatch, draw_match_id)
    if not dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진 경기를 찾을 수 없습니다.")
    draw = db.get(Draw, dm.draw_id)
    gathering = _require_editor(db, draw.gathering_id, current_user)
    if not visibility.is_open_for(current_user, gathering):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="아직 공개되지 않은 일정이에요.")
    if dm.result_match_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="결과가 입력된 경기는 바꿀 수 없어요.")
    column = f"{payload.slot}_id"
    if dm.match_type == MatchType.SINGLES and column.endswith("player2_id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="단식은 한 팀에 한 명이에요.")

    attendees = {
        p.user_id: p
        for p in db.scalars(
            select(Participant).where(
                Participant.gathering_id == gathering.id,
                Participant.status == AttendanceStatus.ATTENDING,
            )
        )
    }
    if payload.user_id not in attendees:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="이 모임에 참석하는 회원만 넣을 수 있어요.")

    current = getattr(dm, column)
    if current == payload.user_id:
        return _build_draw_read(_load_draw(db, draw.id), db, _book_for(db, current_user))

    changed = [dm]
    # 같은 경기 다른 자리에 있으면 그 자리와 맞바꾼다
    same_match = next((c for c in _SLOT_COLUMNS if getattr(dm, c) == payload.user_id), None)
    if same_match:
        setattr(dm, same_match, current)
    else:
        # 같은 라운드의 다른 경기에 있으면 서로 바꾼다 (없으면 쉬던 사람 → 원래 선수가 쉰다)
        others = db.scalars(
            select(DrawMatch).where(
                DrawMatch.draw_id == draw.id,
                DrawMatch.round_number == dm.round_number,
                DrawMatch.id != dm.id,
            )
        ).all()
        for other in others:
            slot = next((c for c in _SLOT_COLUMNS if getattr(other, c) == payload.user_id), None)
            if slot:
                if other.result_match_id is not None:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        detail="그 회원이 뛴 같은 라운드 경기에 이미 결과가 있어 바꿀 수 없어요.",
                    )
                setattr(other, slot, current)
                changed.append(other)
                break
    setattr(dm, column, payload.user_id)

    ids = {pid for m in changed for pid in _draw_match_player_ids(m)}
    genders = {
        u.id: u.gender for u in db.scalars(select(User).where(User.id.in_(ids)))
    } if ids else {}
    for m in changed:
        _retype(m, genders)
    db.commit()
    return _build_draw_read(_load_draw(db, draw.id), db, _book_for(db, current_user))


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

    if gathering.is_club and payload.team1_score + payload.team2_score == 0:
        # 오테식 모임 대진은 게임 수로 레이팅을 매기므로 점수가 꼭 필요하다.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="점수를 게임 수로 입력해 주세요. (5:5 해피게임은 5:5, 타이브레이크는 6:5)",
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


def _recorded(db: Session, draw_match_id: int, user: User) -> tuple[DrawMatch, Match, Gathering]:
    """결과가 입력된 대진 경기와 그 결과, 모임. 결과를 입력할 수 있는 사람(주최자·관리자·오테식 모임 임원진)만."""
    dm = db.get(DrawMatch, draw_match_id)
    if not dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대진 경기를 찾을 수 없습니다.")
    draw = db.get(Draw, dm.draw_id)
    gathering = _require_organizer(db, draw.gathering_id, user)
    match = db.get(Match, dm.result_match_id) if dm.result_match_id else None
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="아직 결과가 입력되지 않은 경기예요.")
    return dm, match, gathering


@router.patch("/draw-matches/{draw_match_id}/result", response_model=DrawMatchRead)
def update_draw_match_result(
    draw_match_id: int,
    payload: DrawMatchResultUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """입력한 결과의 점수 고치기. 승패를 다시 판정하고, 전적·랭킹·티어는 볼 때 다시 계산되므로 바로 반영된다."""
    dm, match, gathering = _recorded(db, draw_match_id, current_user)
    if gathering.is_club and payload.team1_score + payload.team2_score == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="점수를 게임 수로 입력해 주세요. (5:5 해피게임은 5:5, 타이브레이크는 6:5)",
        )
    match.team1_score = payload.team1_score
    match.team2_score = payload.team2_score
    match.winner_team = (
        TeamSide.TEAM_1
        if payload.team1_score > payload.team2_score
        else TeamSide.TEAM_2
        if payload.team2_score > payload.team1_score
        else None
    )
    db.commit()
    db.refresh(dm)
    return _single_draw_match_read(dm, db)


@router.delete("/draw-matches/{draw_match_id}/result", response_model=DrawMatchRead)
def delete_draw_match_result(
    draw_match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """입력한 결과 지우기: 전적에서 빠지고, 대진 경기는 다시 '결과 기록 전'이 된다."""
    dm, match, _ = _recorded(db, draw_match_id, current_user)
    dm.result_match_id = None
    db.flush()
    db.delete(match)
    db.commit()
    db.refresh(dm)
    return _single_draw_match_read(dm, db)


# --- 단건 직렬화 ------------------------------------------------------------
def _single_draw_match_read(dm: DrawMatch, db: Session) -> DrawMatchRead:
    return _draw_match_reads([dm], db)[0]
