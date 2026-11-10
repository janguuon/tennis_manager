"""
교류전 라우터: 오테식 대 상대 클럽 (교류전 일정 하나에 하나, 주소는 일정 id).

1. 캘린더에 교류전(회비·참가비) 일정을 만들면 교류전 목록(GET /exchanges)에 바로 보인다.
2. 운영진이 상대 클럽 이름·상대 선수(이름·성별)를 적고, 코트 수 × 라운드 수로 대진을 짠다
   (POST /exchanges/{id}/draw: 자동 또는 빈 표, 칸마다 직접: PUT .../matches/{m},
    라운드 하나만 다시: POST .../rounds/{n}/draw, 라운드 더하기·지우기: POST .../rounds, DELETE .../rounds/{n}).
   우리 팀은 그 일정에 참석한 회원·초대 게스트다. 상대 선수는 일정 참가자가 아니라 정산·출석에 잡히지 않는다.
3. 경기마다 점수를 적는다 (운영진과 그 경기에 뛴 우리 선수). 이긴 경기마다 그 팀이 1승.
   못 친 경기는 취소한다 (POST .../matches/{m}/cancel): 점수판·남은 경기에서 빠지고 되돌릴 수 있다.
4. POST /exchanges/{id}/finish → 승리팀(이긴 경기 수 → 게임 득실 → 무승부, 운영진이 바꿀 수 있다)을 정하고
   알리기로 했으면 클럽 소식으로 결과 팝업(오테식 승·무승부는 축하, 상대 승은 수고 인사)을 띄운다.
   마친 교류전은 점수·대진을 바꾸지 못한다(마치기를 취소하면 된다).

레이팅에는 넣지 않는다. 게스트는 일정 화면의 점수판(GET /exchanges/{id})만 본다.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import exchange as X
from .. import matchmaking, visibility
from ..database import get_db
from ..deps import get_current_member, get_current_user
from ..models import (
    EXCHANGE_KINDS,
    AttendanceStatus,
    Exchange,
    ExchangeMatch,
    ExchangeOpponent,
    Gathering,
    GatheringStatus,
    MatchType,
    Notice,
    Participant,
    User,
)
from ..schedule_import import KIND_TITLE
from ..schemas import (
    ExchangeDetail,
    ExchangeDrawRequest,
    ExchangeFinish,
    ExchangeLineup,
    ExchangeMatchRead,
    ExchangeMatchScore,
    ExchangeOpponentRead,
    ExchangeOpponentsAdd,
    ExchangeOpponentUpdate,
    ExchangeOurPlayer,
    ExchangeRoundAdd,
    ExchangeScoreRead,
    ExchangeSummary,
    ExchangeUpdate,
    UserBrief,
)

router = APIRouter(prefix="/exchanges", tags=["exchanges"])

STAFF_ONLY = "교류전은 운영진(관리자·임원진)이 꾸려요."


# --- 불러오기 · 권한 --------------------------------------------------------
def _load(db: Session, gathering_id: int) -> Gathering:
    g = db.scalar(
        select(Gathering)
        .where(Gathering.id == gathering_id)
        .options(
            selectinload(Gathering.participants).selectinload(Participant.user),
            selectinload(Gathering.exchange).selectinload(Exchange.opponents),
            selectinload(Gathering.exchange).selectinload(Exchange.matches),
        )
    )
    if g is None or g.kind not in EXCHANGE_KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="교류전을 찾을 수 없어요.")
    return g


def _require_visible(g: Gathering, user: User) -> None:
    if not visibility.is_open_for(user, g):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="아직 공개되지 않은 일정이에요.")


def _require_manage(user: User) -> None:
    if not user.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=STAFF_ONLY)


def _require_editable(g: Gathering) -> None:
    """취소된 일정, 마친 교류전은 명단·대진·점수를 바꾸지 않는다."""
    if g.status == GatheringStatus.CANCELED:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="취소된 교류전이에요.")
    if g.exchange is not None and g.exchange.finished_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="마친 교류전이에요. 고치려면 먼저 ‘마치기 취소’를 눌러 주세요."
        )


def _ensure(db: Session, g: Gathering) -> Exchange:
    if g.exchange is None:
        g.exchange = Exchange(gathering_id=g.id)
        db.flush()
    return g.exchange


def _opponent_name(g: Gathering) -> str | None:
    ex = g.exchange
    return (ex.opponent_name if ex and ex.opponent_name else None) or X.default_opponent(g.title)


def _court_count(g: Gathering) -> int:
    ex = g.exchange
    return (ex.court_count if ex and ex.court_count else None) or g.court_count or 1


def _rounds(g: Gathering) -> int:
    ex = g.exchange
    return (ex.rounds if ex and ex.rounds else None) or matchmaking.suggested_rounds(g.start_time, g.end_time)


def _attending(g: Gathering) -> list[User]:
    """우리 팀: 참석한 회원·초대 게스트 (회원 먼저, 이름순)."""
    people = [p.user for p in g.participants if p.status == AttendanceStatus.ATTENDING]
    return sorted(people, key=lambda u: (u.is_guest, u.name))


def _matches(ex: Exchange | None) -> list[ExchangeMatch]:
    return sorted(ex.matches, key=lambda m: (m.round_number, m.court, m.id)) if ex else []


def _filled(m: ExchangeMatch) -> bool:
    return bool(m.ours_ids) and bool(m.theirs_ids)


def _live(m: ExchangeMatch) -> bool:
    """칠 경기: 선수가 다 있고 취소하지 않았다 (점수판의 경기 수·남은 경기)."""
    return _filled(m) and not m.canceled


def _score(ex: Exchange | None) -> X.Score:
    return X.score([(m.winner, m.ours_score or 0, m.theirs_score or 0) for m in _matches(ex) if m.recorded])


def _suggested(s: X.Score, played: int) -> str | None:
    if not played:
        return None
    return s.leader or "draw"


# --- 직렬화 -----------------------------------------------------------------
def _summary(g: Gathering) -> dict:
    ex = g.exchange
    matches = _matches(ex)
    s = _score(ex)
    return dict(
        gathering_id=g.id,
        title=g.title,
        kind=g.kind,
        event_date=g.event_date,
        start_time=g.start_time,
        end_time=g.end_time,
        location=g.location,
        canceled=g.status == GatheringStatus.CANCELED,
        opponent_name=_opponent_name(g),
        ours_count=sum(1 for p in g.participants if p.status == AttendanceStatus.ATTENDING),
        theirs_count=len(ex.opponents) if ex else 0,
        played=sum(1 for m in matches if m.recorded),
        total=sum(1 for m in matches if _live(m)),
        score=ExchangeScoreRead(**vars(s)),
        winner=ex.winner if ex else None,
        finished_at=ex.finished_at if ex else None,
    )


def _detail(db: Session, g: Gathering, user: User) -> ExchangeDetail:
    ex = g.exchange
    matches = _matches(ex)
    attending = _attending(g)
    attending_ids = {u.id for u in attending}
    users = {u.id: u for u in attending}
    missing = {p for m in matches for p in m.ours_ids} - set(users)
    if missing:
        users.update({u.id: u for u in db.scalars(select(User).where(User.id.in_(missing)))})
    briefs = {uid: UserBrief.model_validate(u) for uid, u in users.items()}
    opponents = {o.id: o for o in (ex.opponents if ex else [])}
    lines_o, lines_t = X.player_lines(
        [(m.ours_ids, m.theirs_ids, m.winner, m.ours_score, m.theirs_score) for m in matches if m.recorded]
    )

    def opponent(o: ExchangeOpponent) -> ExchangeOpponentRead:
        line = lines_t.get(o.id, X.PlayerLine())
        return ExchangeOpponentRead(id=o.id, name=o.name, gender=o.gender, games=line.games, wins=line.wins)

    manage = user.is_staff
    locked = g.status == GatheringStatus.CANCELED or (ex is not None and ex.finished_at is not None)
    s = _score(ex)
    played = sum(1 for m in matches if m.recorded)
    return ExchangeDetail(
        **_summary(g),
        court_numbers=g.court_numbers,
        court_count=_court_count(g),
        rounds=_rounds(g),
        cancel_reason=g.cancel_reason,
        ours=[
            ExchangeOurPlayer(
                user=briefs[u.id],
                games=lines_o.get(u.id, X.PlayerLine()).games,
                wins=lines_o.get(u.id, X.PlayerLine()).wins,
            )
            for u in attending
        ],
        opponents=[opponent(o) for o in opponents.values()],
        matches=[
            ExchangeMatchRead(
                id=m.id,
                round_number=m.round_number,
                court=m.court,
                match_type=m.match_type,
                ours=[briefs[p] for p in m.ours_ids if p in briefs],
                theirs=[opponent(opponents[x]) for x in m.theirs_ids if x in opponents],
                ours_score=m.ours_score,
                theirs_score=m.theirs_score,
                winner=m.winner,
                recorded=m.recorded,
                can_score=not locked and _live(m) and not user.is_guest
                and (manage or user.id in m.ours_ids),
                canceled=m.canceled,
                absent_ids=[p for p in m.ours_ids if p not in attending_ids],
            )
            for m in matches
        ],
        suggested_winner=_suggested(s, played),
        mvp=[briefs[u] for u in X.mvp(lines_o) if u in briefs],
        can_manage=manage and not user.is_guest,
        announced=bool(ex and ex.notice_id and db.get(Notice, ex.notice_id)),
    )


# --- 목록 · 보기 · 설정 -----------------------------------------------------
@router.get("", response_model=list[ExchangeSummary])
def list_exchanges(db: Session = Depends(get_db), current_user: User = Depends(get_current_member)):
    """교류전 일정 전체 (최근 날짜 먼저). 아직 공개 전인 일정은 볼 수 있는 사람에게만."""
    gatherings = db.scalars(
        select(Gathering)
        .where(Gathering.kind.in_(EXCHANGE_KINDS))
        .order_by(Gathering.event_date.desc(), Gathering.start_time.desc(), Gathering.id.desc())
        .options(
            selectinload(Gathering.participants),
            selectinload(Gathering.exchange).selectinload(Exchange.opponents),
            selectinload(Gathering.exchange).selectinload(Exchange.matches),
        )
    ).all()
    return [ExchangeSummary(**_summary(g)) for g in gatherings if visibility.is_open_for(current_user, g)]


@router.get("/{gathering_id}", response_model=ExchangeDetail)
def get_exchange(
    gathering_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """교류전 화면 (게스트도 일정 화면의 점수판으로 본다)."""
    g = _load(db, gathering_id)
    _require_visible(g, current_user)
    return _detail(db, g, current_user)


def _done(db: Session, g: Gathering, user: User) -> ExchangeDetail:
    db.commit()
    db.expire_all()
    return _detail(db, _load(db, g.id), user)


@router.patch("/{gathering_id}", response_model=ExchangeDetail)
def update_exchange(
    gathering_id: int,
    payload: ExchangeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """상대 클럽 이름, 대진 코트 수·라운드 수 (보낸 칸만)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    ex = _ensure(db, g)
    fields = payload.model_dump(exclude_unset=True)
    if "opponent_name" in fields:
        ex.opponent_name = " ".join((fields["opponent_name"] or "").split()) or None
    for key in ("court_count", "rounds"):
        if key in fields:
            setattr(ex, key, fields[key])
    return _done(db, g, current_user)


@router.delete("/{gathering_id}", status_code=status.HTTP_204_NO_CONTENT)
def reset_exchange(
    gathering_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """교류전 기록 지우기: 상대 명단·대진·점수·결과(올린 소식도). 일정은 그대로."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    if g.exchange is not None:
        _drop_notice(db, g.exchange)
        db.delete(g.exchange)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 상대 선수 --------------------------------------------------------------
def _opponent(g: Gathering, opponent_id: int) -> ExchangeOpponent:
    o = next((o for o in (g.exchange.opponents if g.exchange else []) if o.id == opponent_id), None)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="상대 선수를 찾을 수 없어요.")
    return o


def _retype(g: Gathering) -> None:
    """선수 성별이 바뀌면 점수 전 경기의 종목(남복·여복·혼복)을 다시 정한다."""
    ex = g.exchange
    ours_g = {p.user_id: p.user.gender for p in g.participants}
    theirs_g = {o.id: o.gender for o in ex.opponents}
    for m in ex.matches:
        if _filled(m) and not m.recorded:
            m.match_type = X.match_type(m.ours_ids, m.theirs_ids, ours_g, theirs_g)


@router.post("/{gathering_id}/opponents", response_model=ExchangeDetail)
def add_opponents(
    gathering_id: int,
    payload: ExchangeOpponentsAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """상대 선수 넣기: '홍길동 남, 김영희 여' (쉼표·줄바꿈으로 여러 명, 성별은 이름 뒤에 띄어 쓴다)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    people = X.parse_opponents(payload.text)
    if not people:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="상대 선수 이름을 적어 주세요. (예: 홍길동 남, 김영희 여)")
    ex = _ensure(db, g)
    if len(ex.opponents) + len(people) > X.MAX_OPPONENTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"상대 선수는 {X.MAX_OPPONENTS}명까지 넣을 수 있어요.")
    for name, gender in people:
        ex.opponents.append(ExchangeOpponent(name=name, gender=gender))
    return _done(db, g, current_user)


@router.patch("/{gathering_id}/opponents/{opponent_id}", response_model=ExchangeDetail)
def update_opponent(
    gathering_id: int,
    opponent_id: int,
    payload: ExchangeOpponentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """상대 선수 이름·성별 고치기 (보낸 칸만)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    o = _opponent(g, opponent_id)
    fields = payload.model_dump(exclude_unset=True)
    if fields.get("name"):
        o.name = " ".join(fields["name"].split())[:30]
    if "gender" in fields:
        o.gender = fields["gender"]
        _retype(g)
    return _done(db, g, current_user)


@router.delete("/{gathering_id}/opponents/{opponent_id}", response_model=ExchangeDetail)
def remove_opponent(
    gathering_id: int,
    opponent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """상대 선수 빼기. 점수 전 경기의 그 자리는 비운다 (점수가 들어간 경기에 뛰었으면 뺄 수 없다)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    o = _opponent(g, opponent_id)
    seats = [m for m in g.exchange.matches if o.id in m.theirs_ids]
    if any(m.recorded for m in seats):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"{o.name} 님은 점수가 들어간 경기에 뛰어서 뺄 수 없어요."
        )
    for m in seats:
        _clear(m)
    g.exchange.opponents.remove(o)
    return _done(db, g, current_user)


# --- 대진 -------------------------------------------------------------------
def _clear(m: ExchangeMatch) -> None:
    """빈 코트로 (양쪽 선수를 모두 뺀다: 한쪽만 남은 칸은 경기가 아니다). 취소 표시도 지운다."""
    m.ours_p1_id = m.ours_p2_id = m.theirs_p1_id = m.theirs_p2_id = None
    m.match_type = MatchType.OPEN_DOUBLES
    m.canceled_at = None


def _rosters(g: Gathering) -> tuple[dict, dict]:
    ours = {u.id: u.gender for u in _attending(g)}
    theirs = {o.id: o.gender for o in g.exchange.opponents} if g.exchange else {}
    return ours, theirs


def _require_players(ours: dict, theirs: dict) -> None:
    if len(ours) < 2 or len(theirs) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"복식 대진을 짜려면 양쪽에 2명 이상 있어야 해요. (지금 {X.OURS_LABEL} {len(ours)}명 · 상대 {len(theirs)}명)",
        )


def _empty(rounds: list[int], courts: int) -> list[dict]:
    """빈 대진표: 라운드마다 courts 칸 (선수는 칸마다 직접 넣는다)."""
    return [
        dict(round_number=r, court=c, ours_ids=[], theirs_ids=[], match_type=MatchType.OPEN_DOUBLES)
        for r in rounds
        for c in range(1, courts + 1)
    ]


def _put(ex: Exchange, rows: list[dict]) -> None:
    for r in rows:
        o, t = r["ours_ids"] + [None, None], r["theirs_ids"] + [None, None]
        ex.matches.append(
            ExchangeMatch(
                round_number=r["round_number"],
                court=r["court"],
                match_type=r["match_type"],
                ours_p1_id=o[0],
                ours_p2_id=o[1],
                theirs_p1_id=t[0],
                theirs_p2_id=t[1],
            )
        )


@router.post("/{gathering_id}/draw", response_model=ExchangeDetail)
def draw_all(
    gathering_id: int,
    payload: ExchangeDrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """대진 전체를 새로 (코트 수 × 라운드 수): 자동으로 짜거나(auto), 빈 표만 만들어 칸마다 직접 넣는다(empty).
    점수가 들어간 경기가 있으면 다시 만들 수 없다."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    ex = _ensure(db, g)
    if any(m.recorded for m in ex.matches):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="점수가 들어간 경기가 있어 전체를 다시 짤 수 없어요. 라운드별로 고쳐 주세요.",
        )
    rounds = list(range(1, payload.rounds + 1))
    if payload.mode == "auto":
        ours, theirs = _rosters(g)
        _require_players(ours, theirs)
        rows = X.generate(ours, theirs, rounds, payload.court_count)
    else:
        rows = _empty(rounds, payload.court_count)
    ex.court_count, ex.rounds = payload.court_count, payload.rounds
    ex.matches.clear()
    db.flush()
    _put(ex, rows)
    return _done(db, g, current_user)


@router.post("/{gathering_id}/rounds", response_model=ExchangeDetail)
def add_round(
    gathering_id: int,
    payload: ExchangeRoundAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """라운드 하나 더 (맨 뒤에): 빈 칸으로(empty) 또는 다른 라운드에서 뛴 수·짝을 보고 자동으로(auto)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    ex = _ensure(db, g)
    last = max((m.round_number for m in ex.matches), default=0)
    if last >= X.MAX_ROUNDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"라운드는 {X.MAX_ROUNDS}개까지 만들 수 있어요.")
    courts = max((m.court for m in ex.matches), default=0) or _court_count(g)
    if payload.mode == "auto":
        ours, theirs = _rosters(g)
        _require_players(ours, theirs)
        kept = [(m.round_number, m.ours_ids, m.theirs_ids) for m in ex.matches if not m.canceled]
        rows = X.generate(ours, theirs, [last + 1], courts, kept=kept)
    else:
        rows = _empty([last + 1], courts)
    _put(ex, rows)
    ex.court_count, ex.rounds = courts, last + 1
    return _done(db, g, current_user)


@router.delete("/{gathering_id}/rounds/{round_number}", response_model=ExchangeDetail)
def delete_round(
    gathering_id: int,
    round_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """라운드 지우기 (점수가 들어간 라운드는 안 된다). 뒤 라운드 번호는 하나씩 당긴다."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    ex = _ensure(db, g)
    target = [m for m in ex.matches if m.round_number == round_number]
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{round_number}라운드가 없어요.")
    if any(m.recorded for m in target):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"{round_number}라운드에 점수가 들어간 경기가 있어 지울 수 없어요."
        )
    for m in target:
        ex.matches.remove(m)
    for m in ex.matches:
        if m.round_number > round_number:
            m.round_number -= 1
    ex.rounds = max((m.round_number for m in ex.matches), default=0) or None
    return _done(db, g, current_user)


@router.post("/{gathering_id}/rounds/{round_number}/draw", response_model=ExchangeDetail)
def draw_round(
    gathering_id: int,
    round_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """라운드 하나만 다시 짠다 (다른 라운드에서 뛴 수·짝을 보고). 점수가 들어간 라운드는 안 된다."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    ex = _ensure(db, g)
    target = [m for m in ex.matches if m.round_number == round_number]
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{round_number}라운드가 없어요.")
    if any(m.recorded for m in target):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"{round_number}라운드에 점수가 들어간 경기가 있어 다시 짤 수 없어요."
        )
    ours, theirs = _rosters(g)
    _require_players(ours, theirs)
    courts = max(m.court for m in target)
    kept = [
        (m.round_number, m.ours_ids, m.theirs_ids)
        for m in ex.matches
        if m.round_number != round_number and not m.canceled
    ]
    for m in target:
        ex.matches.remove(m)
    db.flush()
    _put(ex, X.generate(ours, theirs, [round_number], courts, kept=kept))
    return _done(db, g, current_user)


def _match(g: Gathering, match_id: int) -> ExchangeMatch:
    m = next((m for m in (g.exchange.matches if g.exchange else []) if m.id == match_id), None)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="경기를 찾을 수 없어요.")
    return m


@router.put("/{gathering_id}/matches/{match_id}", response_model=ExchangeDetail)
def set_lineup(
    gathering_id: int,
    match_id: int,
    payload: ExchangeLineup,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """대진 한 칸의 선수를 직접 정한다 (단식 1:1, 복식 2:2, 둘 다 비우면 빈 코트)."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    m = _match(g, match_id)
    if m.recorded:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="점수가 들어간 경기는 선수를 바꿀 수 없어요. 점수를 먼저 지워 주세요."
        )
    if m.canceled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="취소한 경기예요. 선수를 바꾸려면 먼저 '취소 되돌리기'를 눌러 주세요.")
    o, t = payload.ours_ids, payload.theirs_ids
    if not o and not t:
        _clear(m)
        return _done(db, g, current_user)
    if len(o) != len(t) or not o:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="양쪽 선수 수가 같아야 해요. (단식 1명, 복식 2명)")
    if len(set(o)) != len(o) or len(set(t)) != len(t):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="같은 사람을 두 자리에 넣을 수 없어요.")
    ours, theirs = _rosters(g)
    if any(u not in ours for u in o):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{X.OURS_LABEL} 자리에는 참석한 사람만 넣을 수 있어요.")
    if any(x not in theirs for x in t):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="상대 자리에는 상대 선수 명단의 사람만 넣을 수 있어요.")
    m.ours_p1_id, m.ours_p2_id = (o + [None])[:2]
    m.theirs_p1_id, m.theirs_p2_id = (t + [None])[:2]
    m.match_type = X.match_type(o, t, ours, theirs)
    return _done(db, g, current_user)


@router.post("/{gathering_id}/matches/{match_id}/cancel", response_model=ExchangeDetail)
def cancel_match(
    gathering_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """못 친 경기 취소 (비·부상·시간 부족 등): 점수를 받지 않고 점수판·남은 경기·자동 대진의 뛴 수에서 빠진다.
    점수가 들어간 경기는 점수를 먼저 지운다. 선수 자리는 그대로 남겨 두어 되돌릴 수 있다."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    m = _match(g, match_id)
    if not _filled(m):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="선수가 정해지지 않은 코트예요.")
    if m.recorded:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="점수가 들어간 경기는 취소할 수 없어요. 점수를 먼저 지워 주세요."
        )
    m.canceled_at = m.canceled_at or datetime.now()
    return _done(db, g, current_user)


@router.delete("/{gathering_id}/matches/{match_id}/cancel", response_model=ExchangeDetail)
def restore_match(
    gathering_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """경기 취소 되돌리기."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    _require_editable(g)
    _match(g, match_id).canceled_at = None
    return _done(db, g, current_user)


# --- 점수 -------------------------------------------------------------------
def _scorable(g: Gathering, match_id: int, user: User) -> ExchangeMatch:
    _require_editable(g)
    m = _match(g, match_id)
    if not _filled(m):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="선수가 정해지지 않은 코트예요.")
    if m.canceled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="취소한 경기예요. 점수를 적으려면 먼저 '취소 되돌리기'를 눌러 주세요.")
    if not (user.is_staff or user.id in m.ours_ids):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="점수는 운영진과 그 경기에 뛴 선수가 적어요.")
    return m


@router.put("/{gathering_id}/matches/{match_id}/result", response_model=ExchangeDetail)
def record_result(
    gathering_id: int,
    match_id: int,
    payload: ExchangeMatchScore,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """점수 적기·고치기 (게임 수, 비기면 무승부)."""
    g = _load(db, gathering_id)
    m = _scorable(g, match_id, current_user)
    so, st = payload.ours_score, payload.theirs_score
    if so + st == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="점수를 게임 수로 입력해 주세요. (예: 6:4)")
    m.ours_score, m.theirs_score = so, st
    m.winner = 1 if so > st else 2 if st > so else None
    m.recorded_at = datetime.now()
    return _done(db, g, current_user)


@router.delete("/{gathering_id}/matches/{match_id}/result", response_model=ExchangeDetail)
def delete_result(
    gathering_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    g = _load(db, gathering_id)
    m = _scorable(g, match_id, current_user)
    if not m.recorded:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="아직 점수가 없는 경기예요.")
    m.ours_score = m.theirs_score = m.winner = None
    m.recorded_at = None
    return _done(db, g, current_user)


# --- 마치기 · 결과 소식 -----------------------------------------------------
def _drop_notice(db: Session, ex: Exchange) -> None:
    if ex.notice_id:
        old = db.get(Notice, ex.notice_id)
        if old is not None:
            db.delete(old)
        ex.notice_id = None


def _event_title(g: Gathering, opponent: str) -> str:
    """소식 제목에 쓸 교류전 이름: 제목이 그냥 '교류전'이면 'A클럽 교류전'."""
    title = " ".join((g.title or "").split())
    if not title or title == KIND_TITLE[g.kind]:
        return f"{opponent} 교류전"
    return title


def _announce(db: Session, g: Gathering, user: User) -> None:
    """결과 소식: 오테식 승·무승부는 축하(🎉), 상대 승은 수고 인사. 회원이 들어올 때 팝업으로 뜬다 (2주)."""
    ex = g.exchange
    opponent = _opponent_name(g) or X.DEFAULT_OPPONENT_LABEL
    matches = [m for m in _matches(ex) if m.recorded]
    s = _score(ex)
    lines_o, _ = X.player_lines([(m.ours_ids, m.theirs_ids, m.winner, m.ours_score, m.theirs_score) for m in matches])
    names = {u.id: u.name for u in _attending(g)}
    missing = set(lines_o) - set(names)
    if missing:
        names.update({u.id: u.name for u in db.scalars(select(User).where(User.id.in_(missing)))})

    event = _event_title(g, opponent)
    body: list[str] = []
    if matches:
        line = f"{X.OURS_LABEL} {s.ours_wins}승 · {opponent} {s.theirs_wins}승"
        if s.draws:
            line += f" · 무승부 {s.draws}"
        body.append(f"{line} (게임 {s.ours_games}:{s.theirs_games})")
    best = X.mvp(lines_o)
    if best:
        top = lines_o[best[0]]
        body.append(f"오늘의 MVP {', '.join(names.get(u, '') for u in best)} ({top.games}전 {top.wins}승)")
    players = [names[u] for u in sorted(lines_o, key=lambda u: names.get(u, ""))] or [u.name for u in _attending(g)]
    if players:
        body.append(f"함께한 선수: {', '.join(players)}")
    if ex.winner == "ours":
        title, kind = f"{event}, {X.OURS_LABEL} 승리!", "celebrate"
        body.append("모두 축하해요! 정말 수고 많으셨어요.")
    elif ex.winner == "draw":
        title, kind = f"{event}, 무승부!", "celebrate"
        body.append("두 클럽 모두 멋진 경기였어요. 수고 많으셨어요!")
    else:
        title, kind = f"{event}, {opponent} 승리", "news"
        body.append(f"아쉽지만 모두 수고 많으셨어요! {opponent}의 승리도 축하해요. 다음엔 우리가 이겨요.")
    notice = Notice(
        kind=kind,
        title=title[:100],
        body="\n".join(body)[:1000],
        show_until=date.today() + timedelta(days=14),
        created_by=user.id,
    )
    db.add(notice)
    db.flush()
    ex.notice_id = notice.id


@router.post("/{gathering_id}/finish", response_model=ExchangeDetail)
def finish_exchange(
    gathering_id: int,
    payload: ExchangeFinish,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """교류전 마치기 (마친 뒤 다시 누르면 결과를 바꾼다). winner 를 비우면 점수판대로 정한다.
    알리기로 하면 결과 소식을 올리고, 결과를 바꾸면 소식도 새로 쓴다."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    if g.status == GatheringStatus.CANCELED:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="취소된 교류전이에요.")
    ex = _ensure(db, g)
    played = sum(1 for m in ex.matches if m.recorded)
    winner = payload.winner or _suggested(_score(ex), played)
    if winner is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="점수가 들어간 경기가 없어요. 점수를 적거나 결과를 직접 골라 주세요."
        )
    if ex.finished_at is not None and ex.winner == winner and payload.announce == bool(ex.notice_id):
        return _done(db, g, current_user)  # 같은 결과를 다시 눌렀다
    _drop_notice(db, ex)
    ex.winner = winner
    ex.finished_at = ex.finished_at or datetime.now()
    if payload.announce:
        _announce(db, g, current_user)
    return _done(db, g, current_user)


@router.delete("/{gathering_id}/finish", response_model=ExchangeDetail)
def reopen_exchange(
    gathering_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """마치기 취소: 결과와 올린 소식을 지우고 다시 점수·대진을 고칠 수 있게."""
    g = _load(db, gathering_id)
    _require_manage(current_user)
    ex = g.exchange
    if ex is None or ex.finished_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="아직 마치지 않은 교류전이에요.")
    _drop_notice(db, ex)
    ex.winner = None
    ex.finished_at = None
    return _done(db, g, current_user)
