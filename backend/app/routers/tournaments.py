"""
대회 라우터: 청백전 / 단식·복식 토너먼트.

청백전
------
1. 참가자를 넣고 팀별 인원 수·팀장을 정한다. 원하는 사람은 직접 청팀·백팀에 넣는다.
2. POST /tournaments/{id}/teams/random → 팀이 없는 나머지를 랜덤으로 배정 (다시 누르면 랜덤으로 넣은 사람만 다시)
3. 경기는 직접 짜거나(POST /matches) 랜덤으로 한 판씩(POST /matches/random). 이긴 경기 수로 청·백 승패.

토너먼트
--------
1. 참가자를 넣는다. 복식은 짝을 직접 짓거나 나머지를 랜덤으로 짝짓는다.
2. POST /tournaments/{id}/bracket → 추첨해 대진표(1라운드 → 결승). 2의 거듭제곱이 아니면 부전승이 생긴다.
3. 점수를 적으면 이긴 엔트리가 다음 라운드로 올라가고, 결승이 끝나면 우승.

대회 경기는 전적·티어(Match)에 넣지 않는다. 대회는 운영진이 만들고 꾸리며, 점수는 운영진·청백전 팀장·
그 경기에 뛴 선수가 적는다. 게스트는 대회 화면을 보지 않는다.
"""
import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import matchmaking
from ..database import get_db
from ..deps import get_current_member
from ..models import (
    ApprovalStatus,
    Gender,
    MatchType,
    Tournament,
    TournamentEntry,
    TournamentKind,
    TournamentMatch,
    User,
)
from ..schemas import (
    TeamBattleScore,
    TournamentCreate,
    TournamentDetail,
    TournamentEntryRead,
    TournamentEntryUpdate,
    TournamentMatchCreate,
    TournamentMatchRead,
    TournamentPair,
    TournamentPlayersAdd,
    TournamentRandomMatches,
    TournamentScore,
    TournamentSummary,
    TournamentUpdate,
    UserBrief,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])

TEAMS = ("blue", "white")
TEAM_LABEL = {"blue": "청팀", "white": "백팀"}
_SEATS = ("team1_player1_id", "team1_player2_id", "team2_player1_id", "team2_player2_id")


# --- 불러오기 · 권한 --------------------------------------------------------
def _load(db: Session, tournament_id: int) -> Tournament:
    t = db.scalar(
        select(Tournament)
        .where(Tournament.id == tournament_id)
        .options(selectinload(Tournament.entries), selectinload(Tournament.matches))
    )
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="대회를 찾을 수 없어요.")
    return t


def _can_manage(t: Tournament, user: User) -> bool:
    return user.is_staff or t.created_by == user.id


def _require_manager(t: Tournament, user: User) -> None:
    if not _can_manage(t, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="대회는 운영진만 꾸릴 수 있어요.")


def _captain_team(t: Tournament, user: User) -> str | None:
    """청백전에서 이 회원이 팀장인 팀."""
    return next(
        (e.team for e in t.entries if e.is_captain and e.team and e.player1_id == user.id), None
    )


def _require_lineup(t: Tournament, user: User) -> None:
    """청백전 경기 짜기·빼기: 운영진과 팀장."""
    if t.kind != TournamentKind.TEAM_BATTLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="청백전에서만 경기를 직접 짤 수 있어요.")
    if not (_can_manage(t, user) or _captain_team(t, user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="청백전 경기는 운영진과 팀장이 짜요.")


def _require_kind(t: Tournament, *kinds: TournamentKind) -> None:
    if t.kind not in kinds:
        names = {
            TournamentKind.TEAM_BATTLE: "청백전",
            TournamentKind.SINGLES: "단식 토너먼트",
            TournamentKind.DOUBLES: "복식 토너먼트",
        }
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"{'·'.join(names[k] for k in kinds)}에서만 할 수 있어요.",
        )


def _require_no_bracket(t: Tournament) -> None:
    """토너먼트는 대진표를 만든 뒤에는 참가자·짝을 바꾸지 않는다 (청백전은 언제든)."""
    if t.kind != TournamentKind.TEAM_BATTLE and t.matches:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="대진표를 만든 뒤에는 참가자를 바꿀 수 없어요. 대진표를 지우고 다시 해 주세요.",
        )


def _entry(t: Tournament, entry_id: int) -> TournamentEntry:
    e = next((e for e in t.entries if e.id == entry_id), None)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="참가자를 찾을 수 없어요.")
    return e


def _match(t: Tournament, match_id: int) -> TournamentMatch:
    m = next((m for m in t.matches if m.id == match_id), None)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="경기를 찾을 수 없어요.")
    return m


# --- 경기 자리 ---------------------------------------------------------------
def _side(m: TournamentMatch, side: int) -> list[int]:
    cols = _SEATS[:2] if side == 1 else _SEATS[2:]
    return [getattr(m, c) for c in cols if getattr(m, c) is not None]


def _is_bye(t: Tournament, m: TournamentMatch) -> bool:
    return (
        t.kind != TournamentKind.TEAM_BATTLE
        and m.round_number == 1
        and (m.entry1_id is None) != (m.entry2_id is None)
    )


def _can_score(t: Tournament, m: TournamentMatch, user: User, manage: bool, captain: str | None) -> bool:
    if _is_bye(t, m) or not _side(m, 1) or not _side(m, 2):
        return False
    return manage or captain is not None or user.id in _side(m, 1) + _side(m, 2)


def _place(m: TournamentMatch, side: int, entry: TournamentEntry | None) -> None:
    """토너먼트 경기의 한쪽에 엔트리를 앉힌다 (None 이면 비운다). 선수 자리도 같이 적는다."""
    players = entry.player_ids if entry else []
    setattr(m, f"entry{side}_id", entry.id if entry else None)
    cols = _SEATS[:2] if side == 1 else _SEATS[2:]
    for i, c in enumerate(cols):
        setattr(m, c, players[i] if i < len(players) else None)


def _next_match(t: Tournament, m: TournamentMatch) -> TournamentMatch | None:
    return next(
        (
            x
            for x in t.matches
            if x.round_number == m.round_number + 1 and x.position == m.position // 2
        ),
        None,
    )


def _advance(t: Tournament, m: TournamentMatch) -> None:
    """이긴 엔트리를 다음 라운드로 올린다 (승자가 없으면 그 자리를 비운다)."""
    nxt = _next_match(t, m)
    if nxt is None:
        return
    winner_id = m.entry1_id if m.winner == 1 else m.entry2_id if m.winner == 2 else None
    entry = next((e for e in t.entries if e.id == winner_id), None)
    _place(nxt, m.position % 2 + 1, entry)


# --- 직렬화 -----------------------------------------------------------------
def _user_map(db: Session, ids: set[int]) -> dict[int, UserBrief]:
    if not ids:
        return {}
    return {u.id: UserBrief.model_validate(u) for u in db.scalars(select(User).where(User.id.in_(ids)))}


def _final(t: Tournament) -> TournamentMatch | None:
    if t.kind == TournamentKind.TEAM_BATTLE or not t.matches:
        return None
    last = max(m.round_number for m in t.matches)
    return next((m for m in t.matches if m.round_number == last), None)


def _champion_ids(t: Tournament) -> list[int] | None:
    final = _final(t)
    if final is None or final.winner is None or not final.recorded:
        return None
    return _side(final, final.winner)


def _summary_fields(t: Tournament, users: dict[int, UserBrief]) -> dict:
    players = {p for e in t.entries for p in e.player_ids}
    games = [m for m in t.matches if not _is_bye(t, m)]
    score = None
    if t.kind == TournamentKind.TEAM_BATTLE:
        score = TeamBattleScore()
        for m in games:
            if not m.recorded:
                continue
            if m.winner == 1:
                score.blue_wins += 1
            elif m.winner == 2:
                score.white_wins += 1
            else:
                score.draws += 1
            score.blue_games += m.team1_score or 0
            score.white_games += m.team2_score or 0
    champion = _champion_ids(t)
    return dict(
        id=t.id,
        title=t.title,
        kind=t.kind,
        event_date=t.event_date,
        location=t.location,
        created_at=t.created_at,
        players=len(players),
        played=sum(1 for m in games if m.recorded),
        total=len(games),
        score=score,
        champion=[users[p] for p in champion if p in users] if champion else None,
    )


def _detail(db: Session, t: Tournament, user: User) -> TournamentDetail:
    ids = {p for e in t.entries for p in e.player_ids}
    ids.update(p for m in t.matches for p in _side(m, 1) + _side(m, 2))
    if t.created_by:
        ids.add(t.created_by)
    users = _user_map(db, ids)

    def briefs(pids: list[int]) -> list[UserBrief]:
        return [users[p] for p in pids if p in users]

    manage = _can_manage(t, user)
    captain = _captain_team(t, user) if t.kind == TournamentKind.TEAM_BATTLE else None
    matches = sorted(t.matches, key=lambda m: (m.round_number, m.position, m.id))
    return TournamentDetail(
        **_summary_fields(t, users),
        note=t.note,
        blue_size=t.blue_size,
        white_size=t.white_size,
        created_by_name=users[t.created_by].name if t.created_by in users else None,
        entries=[
            TournamentEntryRead(
                id=e.id,
                players=briefs(e.player_ids),
                team=e.team,
                is_captain=e.is_captain,
                random_pick=e.random_pick,
            )
            for e in t.entries
        ],
        matches=[
            TournamentMatchRead(
                id=m.id,
                round_number=m.round_number,
                position=m.position,
                match_type=m.match_type,
                entry1_id=m.entry1_id,
                entry2_id=m.entry2_id,
                team1=briefs(_side(m, 1)),
                team2=briefs(_side(m, 2)),
                team1_score=m.team1_score,
                team2_score=m.team2_score,
                winner=m.winner,
                recorded=m.recorded,
                bye=_is_bye(t, m),
                can_score=_can_score(t, m, user, manage, captain),
            )
            for m in matches
        ],
        rounds=max((m.round_number for m in t.matches), default=0)
        if t.kind != TournamentKind.TEAM_BATTLE
        else 0,
        can_manage=manage,
        captain_of=captain,
    )


# --- 대회 -------------------------------------------------------------------
@router.get("", response_model=list[TournamentSummary])
def list_tournaments(db: Session = Depends(get_db), current_user: User = Depends(get_current_member)):
    """대회 목록 (최근에 만든 대회부터)."""
    tournaments = db.scalars(
        select(Tournament)
        .options(selectinload(Tournament.entries), selectinload(Tournament.matches))
        .order_by(Tournament.created_at.desc(), Tournament.id.desc())
    ).all()
    champions = {p for t in tournaments for p in (_champion_ids(t) or [])}
    users = _user_map(db, champions)
    return [TournamentSummary(**_summary_fields(t, users)) for t in tournaments]


@router.post("", response_model=TournamentDetail, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    if not current_user.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="대회는 운영진만 만들 수 있어요.")
    t = Tournament(**payload.model_dump(), created_by=current_user.id)
    db.add(t)
    db.commit()
    return _detail(db, t, current_user)


@router.get("/{tournament_id}", response_model=TournamentDetail)
def get_tournament(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    return _detail(db, _load(db, tournament_id), current_user)


@router.patch("/{tournament_id}", response_model=TournamentDetail)
def update_tournament(
    tournament_id: int,
    payload: TournamentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title" and value is None:
            continue
        setattr(t, field, value)
    db.commit()
    return _detail(db, t, current_user)


@router.delete("/{tournament_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    db.delete(t)
    db.commit()


# --- 참가자 -----------------------------------------------------------------
@router.post("/{tournament_id}/players", response_model=TournamentDetail)
def add_players(
    tournament_id: int,
    payload: TournamentPlayersAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """참가자 넣기. 이미 들어 있는 사람은 건너뛴다. 청백전은 team 을 주면 그 팀으로."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_no_bracket(t)
    if payload.team and t.kind != TournamentKind.TEAM_BATTLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="팀은 청백전에서만 정해요.")
    found = {
        u.id
        for u in db.scalars(
            select(User).where(
                User.id.in_(payload.user_ids),
                User.is_active.is_(True),
                User.approval_status == ApprovalStatus.APPROVED,
            )
        )
    }
    if len(found) != len(set(payload.user_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="회원 목록에 있는 사람만 넣을 수 있어요.")
    joined = {p for e in t.entries for p in e.player_ids}
    for uid in dict.fromkeys(payload.user_ids):
        if uid not in joined:
            t.entries.append(TournamentEntry(player1_id=uid, team=payload.team))
    db.commit()
    return _detail(db, t, current_user)


@router.delete("/{tournament_id}/entries/{entry_id}", response_model=TournamentDetail)
def remove_entry(
    tournament_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """참가자 빼기 (복식은 짝까지 함께). 청백전에서 이미 뛴 경기 기록은 그대로 남는다."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_no_bracket(t)
    t.entries.remove(_entry(t, entry_id))
    db.commit()
    return _detail(db, t, current_user)


# --- 청백전: 팀 -------------------------------------------------------------
@router.patch("/{tournament_id}/entries/{entry_id}", response_model=TournamentDetail)
def update_entry(
    tournament_id: int,
    entry_id: int,
    payload: TournamentEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """청백전: 팀에 직접 넣기·옮기기(team=null 이면 팀 없음), 팀장 정하기(팀마다 한 명)."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.TEAM_BATTLE)
    e = _entry(t, entry_id)
    fields = payload.model_fields_set
    if "team" in fields:
        if payload.team != e.team:
            e.is_captain = False
        e.team = payload.team
        e.random_pick = False
    if "is_captain" in fields and payload.is_captain is not None:
        if payload.is_captain:
            if e.team is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, detail="팀에 들어간 사람만 팀장이 될 수 있어요."
                )
            for other in t.entries:
                if other.team == e.team:
                    other.is_captain = False
            e.random_pick = False
        e.is_captain = payload.is_captain
    db.commit()
    return _detail(db, t, current_user)


def _random_room(t: Tournament, assigned: dict[str, int], total: int) -> dict[str, int]:
    """랜덤 배정으로 팀마다 더 받을 인원. 인원 수를 정하지 않은 팀은 남는 사람을 받는다."""
    size = {"blue": t.blue_size, "white": t.white_size}
    if size["blue"] is None and size["white"] is None:
        # 둘 다 정하지 않았으면 반씩 (홀수면 한 명 더 받는 팀은 랜덤)
        odd = random.choice(TEAMS)
        target = {team: total // 2 + (total % 2 if team == odd else 0) for team in TEAMS}
    else:
        target = {
            team: size[team] if size[team] is not None else total - max(size[other], assigned[other])
            for team, other in (("blue", "white"), ("white", "blue"))
        }
    return {team: max(target[team] - assigned[team], 0) for team in TEAMS}


@router.post("/{tournament_id}/teams/random", response_model=TournamentDetail)
def random_teams(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """팀이 없는 나머지를 청·백에 랜덤으로 넣는다. 정한 인원 수까지만 채우고, 남녀가 한쪽에 몰리지 않게 나눈다.

    다시 누르면 지난번에 랜덤으로 넣은 사람만 다시 돌린다 (직접 넣은 사람·팀장은 그대로).
    """
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.TEAM_BATTLE)
    for e in t.entries:
        if e.random_pick:
            e.team, e.random_pick = None, False
    pool = [e for e in t.entries if e.team is None and e.player1_id is not None]
    if not pool:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="팀을 정할 사람이 없어요. 참가자를 먼저 넣어 주세요.")

    members = [e for e in t.entries if e.team]
    assigned = {team: sum(1 for e in members if e.team == team) for team in TEAMS}
    room = _random_room(t, assigned, len(members) + len(pool))
    if room["blue"] + room["white"] <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="두 팀 인원이 이미 다 찼어요. 팀 인원 수를 늘려 주세요."
        )

    genders = _genders(db, [e.player1_id for e in t.entries if e.player1_id is not None])
    by_gender: dict[str, dict] = {team: {} for team in TEAMS}
    for e in members:
        g = genders.get(e.player1_id)
        by_gender[e.team][g] = by_gender[e.team].get(g, 0) + 1
    # 같은 성별끼리 이어서 나눠야 팀마다 고르게 갈린다 (같은 성별 안에서는 랜덤)
    random.shuffle(pool)
    order = {Gender.FEMALE: 0, Gender.MALE: 1, None: 2}
    pool.sort(key=lambda e: order.get(genders.get(e.player1_id), 2))
    for e in pool:
        open_teams = [team for team in TEAMS if room[team] > 0]
        if not open_teams:
            break
        g = genders.get(e.player1_id)
        random.shuffle(open_teams)
        # 그 성별이 적은 팀 → 남은 자리가 많은 팀
        team = min(open_teams, key=lambda team: (by_gender[team].get(g, 0), -room[team]))
        e.team, e.random_pick = team, True
        room[team] -= 1
        by_gender[team][g] = by_gender[team].get(g, 0) + 1
    db.commit()
    return _detail(db, t, current_user)


# --- 청백전: 경기 -----------------------------------------------------------
def _team_of(t: Tournament) -> dict[int, str]:
    return {e.player1_id: e.team for e in t.entries if e.team and e.player1_id is not None}


def _team_battle_match(
    blue: list[int], white: list[int], genders: dict, round_number: int, position: int
) -> TournamentMatch:
    return TournamentMatch(
        round_number=round_number,
        position=position,
        match_type=matchmaking.classify(blue, white, genders),
        team1_player1_id=blue[0],
        team1_player2_id=blue[1] if len(blue) > 1 else None,
        team2_player1_id=white[0],
        team2_player2_id=white[1] if len(white) > 1 else None,
    )


def _genders(db: Session, ids: list[int]) -> dict:
    return {u.id: u.gender for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


@router.post("/{tournament_id}/matches", response_model=TournamentDetail)
def add_team_battle_match(
    tournament_id: int,
    payload: TournamentMatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """청백전 경기 한 판을 직접 짠다: 청팀 선수 대 백팀 선수 (단식 1:1, 복식 2:2)."""
    t = _load(db, tournament_id)
    _require_lineup(t, current_user)
    blue, white = payload.blue_ids, payload.white_ids
    if len(blue) != len(white):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="두 팀 선수 수가 같아야 해요. (단식 1명, 복식 2명)")
    if len(set(blue + white)) != len(blue) + len(white):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="같은 사람을 두 자리에 넣을 수 없어요.")
    team_of = _team_of(t)
    if any(team_of.get(u) != "blue" for u in blue) or any(team_of.get(u) != "white" for u in white):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="청팀 자리엔 청팀, 백팀 자리엔 백팀 선수를 넣어 주세요.")
    last = max((m.round_number for m in t.matches), default=0)
    t.matches.append(_team_battle_match(blue, white, _genders(db, blue + white), last + 1, 0))
    db.commit()
    return _detail(db, t, current_user)


@router.post("/{tournament_id}/matches/random", response_model=TournamentDetail)
def random_team_battle_matches(
    tournament_id: int,
    payload: TournamentRandomMatches,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """청백전 경기 한 라운드를 랜덤으로 짠다. 팀마다 경기를 덜 뛴 사람부터 넣고, 남는 사람은 쉰다.
    복식은 남복·여복·혼복끼리 맞붙게(잡복이 가장 적게) 짝과 상대를 고른다."""
    t = _load(db, tournament_id)
    _require_lineup(t, current_user)
    need = 1 if payload.match_type == "singles" else 2
    played: dict[int, int] = {}
    for m in t.matches:
        for p in _side(m, 1) + _side(m, 2):
            played[p] = played.get(p, 0) + 1
    teams = {
        team: [e.player1_id for e in t.entries if e.team == team and e.player1_id is not None]
        for team in TEAMS
    }
    count = min(len(teams["blue"]), len(teams["white"])) // need
    if count == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"청팀과 백팀에 {need}명 이상씩 있어야 {'단식' if need == 1 else '복식'} 경기를 짤 수 있어요.",
        )
    chosen = {}
    for team, ids in teams.items():
        random.shuffle(ids)
        ids.sort(key=lambda u: played.get(u, 0))  # 덜 뛴 사람부터 (같으면 랜덤)
        chosen[team] = ids[: count * need]
    genders = _genders(db, chosen["blue"] + chosen["white"])
    # 짝과 상대를 여러 번 섞어 보고 잡복(성별 구성이 안 맞는 복식)이 가장 적은 짜임을 고른다
    best: tuple[int, list] | None = None
    for _ in range(200 if need == 2 else 1):
        for team in TEAMS:
            random.shuffle(chosen[team])
        games = [
            (chosen["blue"][i * need : (i + 1) * need], chosen["white"][i * need : (i + 1) * need])
            for i in range(count)
        ]
        mismatched = sum(matchmaking.classify(b, w, genders) == MatchType.OPEN_DOUBLES for b, w in games)
        if best is None or mismatched < best[0]:
            best = (mismatched, games)
        if mismatched == 0:
            break
    round_number = max((m.round_number for m in t.matches), default=0) + 1
    for i, (blue, white) in enumerate(best[1]):
        t.matches.append(_team_battle_match(blue, white, genders, round_number, i))
    db.commit()
    return _detail(db, t, current_user)


@router.delete("/{tournament_id}/matches/{match_id}", response_model=TournamentDetail)
def delete_team_battle_match(
    tournament_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """청백전 경기 빼기 (점수가 있으면 점수도 함께 빠진다)."""
    t = _load(db, tournament_id)
    _require_lineup(t, current_user)
    t.matches.remove(_match(t, match_id))
    db.commit()
    return _detail(db, t, current_user)


# --- 복식 토너먼트: 짝 ------------------------------------------------------
@router.post("/{tournament_id}/pairs", response_model=TournamentDetail)
def make_pair(
    tournament_id: int,
    payload: TournamentPair,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """짝이 없는 두 사람을 한 팀으로 묶는다."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.DOUBLES)
    _require_no_bracket(t)
    a, b = (_entry(t, i) for i in payload.entry_ids)
    if a is b or a.player2_id is not None or b.player2_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="짝이 없는 두 사람을 골라 주세요.")
    a.player2_id, a.random_pick = b.player1_id, False
    t.entries.remove(b)
    db.commit()
    return _detail(db, t, current_user)


def _split(t: Tournament, e: TournamentEntry) -> None:
    t.entries.append(TournamentEntry(player1_id=e.player2_id))
    e.player2_id, e.random_pick = None, False


@router.post("/{tournament_id}/entries/{entry_id}/split", response_model=TournamentDetail)
def split_pair(
    tournament_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """짝 풀기: 두 사람 모두 짝이 없는 참가자로 돌아간다."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.DOUBLES)
    _require_no_bracket(t)
    e = _entry(t, entry_id)
    if e.player2_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="짝이 없는 참가자예요.")
    _split(t, e)
    db.commit()
    return _detail(db, t, current_user)


@router.post("/{tournament_id}/pairs/random", response_model=TournamentDetail)
def random_pairs(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """짝이 없는 사람끼리 랜덤으로 짝짓는다. 남녀가 같이 있으면 혼복 짝부터 짓는다.

    다시 누르면 지난번에 랜덤으로 지은 짝만 다시 돌린다 (직접 지은 짝은 그대로). 홀수면 한 명이 남는다.
    """
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.DOUBLES)
    _require_no_bracket(t)
    for e in [e for e in t.entries if e.random_pick and e.player2_id is not None]:
        _split(t, e)
    db.flush()
    singles = [e for e in t.entries if e.player2_id is None and e.player1_id is not None]
    if len(singles) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="짝을 지을 사람이 두 명 이상이어야 해요.")
    genders = _genders(db, [e.player1_id for e in singles])
    women = [e for e in singles if genders.get(e.player1_id) == Gender.FEMALE]
    men = [e for e in singles if genders.get(e.player1_id) == Gender.MALE]
    rest = [e for e in singles if genders.get(e.player1_id) not in (Gender.FEMALE, Gender.MALE)]
    for group in (women, men, rest):
        random.shuffle(group)
    pairs = []
    while women and men:
        pairs.append((men.pop(), women.pop()))
    left = men + women + rest
    random.shuffle(left)
    while len(left) >= 2:
        pairs.append((left.pop(), left.pop()))
    for a, b in pairs:
        a.player2_id, a.random_pick = b.player1_id, True
        t.entries.remove(b)
    db.commit()
    return _detail(db, t, current_user)


# --- 토너먼트: 대진표 -------------------------------------------------------
@router.post("/{tournament_id}/bracket", response_model=TournamentDetail)
def make_bracket(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """참가 엔트리를 추첨해 대진표를 만든다. 2의 거듭제곱이 아니면 1라운드에 부전승을 고르게 둔다."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.SINGLES, TournamentKind.DOUBLES)
    if t.matches:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="이미 대진표가 있어요. 다시 짜려면 먼저 대진표를 지워 주세요."
        )
    entries = [e for e in t.entries if e.player_ids]
    if t.kind == TournamentKind.DOUBLES:
        alone = [e for e in entries if len(e.player_ids) < 2]
        if alone:
            names = {
                u.id: u.name
                for u in db.scalars(select(User).where(User.id.in_([e.player1_id for e in alone])))
            }
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"짝이 없는 사람이 있어요: {', '.join(names.get(e.player1_id, '?') for e in alone)}. "
                "짝을 지어 주거나 빼 주세요.",
            )
    if len(entries) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="참가 팀이 둘 이상이어야 대진표를 만들 수 있어요.")

    random.shuffle(entries)
    size = 1 << (len(entries) - 1).bit_length()
    first = size // 2
    byes = size - len(entries)
    bye_at = {i * first // byes for i in range(byes)} if byes else set()
    match_type = MatchType.SINGLES if t.kind == TournamentKind.SINGLES else MatchType.OPEN_DOUBLES
    rounds = size.bit_length() - 1
    queue = iter(entries)
    for r in range(1, rounds + 1):
        for p in range(size >> r):
            m = TournamentMatch(round_number=r, position=p, match_type=match_type)
            t.matches.append(m)
            if r == 1:
                _place(m, 1, next(queue))
                if p not in bye_at:
                    _place(m, 2, next(queue))
    db.flush()
    for m in [m for m in t.matches if _is_bye(t, m)]:
        m.winner = 1
        _advance(t, m)
    db.commit()
    return _detail(db, t, current_user)


@router.delete("/{tournament_id}/bracket", response_model=TournamentDetail)
def delete_bracket(
    tournament_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_member)
):
    """대진표 지우기 (적은 점수도 함께). 참가자는 그대로 남아 다시 추첨할 수 있다."""
    t = _load(db, tournament_id)
    _require_manager(t, current_user)
    _require_kind(t, TournamentKind.SINGLES, TournamentKind.DOUBLES)
    t.matches.clear()
    db.commit()
    return _detail(db, t, current_user)


# --- 점수 -------------------------------------------------------------------
def _scorer_match(
    db: Session, tournament_id: int, match_id: int, user: User
) -> tuple[Tournament, TournamentMatch]:
    t = _load(db, tournament_id)
    m = _match(t, match_id)
    if _is_bye(t, m):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="부전승 경기예요.")
    if not _side(m, 1) or not _side(m, 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="아직 상대가 정해지지 않은 경기예요.")
    captain = _captain_team(t, user) if t.kind == TournamentKind.TEAM_BATTLE else None
    if not _can_score(t, m, user, _can_manage(t, user), captain):
        who = "선수·팀장·운영진" if t.kind == TournamentKind.TEAM_BATTLE else "선수와 운영진"
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=f"이 경기에 뛴 {who}만 점수를 입력할 수 있어요.")
    return t, m


def _require_next_open(t: Tournament, m: TournamentMatch) -> None:
    nxt = _next_match(t, m)
    if nxt is not None and nxt.recorded:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="다음 라운드 경기 결과가 이미 있어 바꿀 수 없어요. 다음 경기 결과를 먼저 지워 주세요.",
        )


@router.put("/{tournament_id}/matches/{match_id}/result", response_model=TournamentDetail)
def record_result(
    tournament_id: int,
    match_id: int,
    payload: TournamentScore,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """점수 적기·고치기. 토너먼트는 이긴 쪽이 다음 라운드로 올라간다 (비기면 안 된다)."""
    t, m = _scorer_match(db, tournament_id, match_id, current_user)
    s1, s2 = payload.team1_score, payload.team2_score
    if s1 + s2 == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="점수를 게임 수로 입력해 주세요. (예: 6:4)")
    winner = 1 if s1 > s2 else 2 if s2 > s1 else None
    if t.kind != TournamentKind.TEAM_BATTLE:
        if winner is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="토너먼트는 승부가 나야 해요. (타이브레이크는 6:5처럼)"
            )
        if m.recorded and winner != m.winner:
            _require_next_open(t, m)
    m.team1_score, m.team2_score, m.winner = s1, s2, winner
    m.recorded_at = datetime.now()
    if t.kind != TournamentKind.TEAM_BATTLE:
        _advance(t, m)
    db.commit()
    return _detail(db, t, current_user)


@router.delete("/{tournament_id}/matches/{match_id}/result", response_model=TournamentDetail)
def delete_result(
    tournament_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_member),
):
    """점수 지우기. 토너먼트는 다음 라운드에 올라간 쪽도 비운다."""
    t, m = _scorer_match(db, tournament_id, match_id, current_user)
    if not m.recorded:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="아직 결과가 없는 경기예요.")
    if t.kind != TournamentKind.TEAM_BATTLE:
        _require_next_open(t, m)
    m.team1_score = m.team2_score = m.winner = None
    m.recorded_at = None
    if t.kind != TournamentKind.TEAM_BATTLE:
        _advance(t, m)
    db.commit()
    return _detail(db, t, current_user)
