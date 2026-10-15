"""
내부 레이팅 · 티어(A~E) 엔진 — 관리자 전용.

반영 경기
---------
오테식 모임(정모·벙개)에서 **대진표로 치르고 결과를 입력한 경기만** 반영한다.
일반 벙개, 직접 입력한 경기, 취소된 모임, 점수 없는(0:0) 결과, 탈퇴한 회원이 뛴 경기,
이름만 적어 초대한 게스트(가입하지 않은 사람)가 뛴 경기는 빠진다. 자동 대진에서 초대 게스트는 출발점으로 본다.

계산
----
- 모두 같은 출발점(BASE)에서 시작한다. NTRP 는 프로필 기록용이라 쓰지 않는다.
- 팀 레이팅 = 팀원 평균. 기대 득점률 E = 1 / (1 + 10^((상대 - 우리) / 400)).
- 실제 득점률 S = 우리 게임 / 전체 게임.
  → 6:4 와 6:0 승리가 다르게 반영되고, 5:5 해피게임 무승부는 0.5, 타이브레이크로 끝내면 6:5.
- 변화량 = K × (S − E). 처음 PLACEMENT_GAMES 경기는 K 를 크게 줘서 빨리 자리를 찾는다.
- 티어는 레이팅 구간으로 정하되, 경계에서 오락가락하지 않도록 구간을 HYSTERESIS 만큼
  넘어서야 오르내린다.

stats.py 와 같이 별도 저장 없이 매번 Match 기록에서 다시 계산(derived)하므로
경기 수정·삭제가 곧바로 반영된다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import CLUB_KINDS, DrawMatch, Gathering, GatheringStatus, Match, TeamSide
from .stats import without_invited_guests, without_withdrawn

BASE = 1000.0
# 시뮬레이션(tests/test_rating.py)으로 고른 값: 처음엔 빨리 자리를 찾고, 이후엔 덜 출렁이게.
K_PLACEMENT = 96
K_REGULAR = 32
PLACEMENT_GAMES = 10
HYSTERESIS = 20

# 티어 하한선 (위에서부터). E 는 그 아래 전부.
TIER_FLOORS: list[tuple[str, float]] = [("A", 1150), ("B", 1050), ("C", 950), ("D", 850)]
TIERS = ["A", "B", "C", "D", "E"]
START_TIER = "C"


def expected(rating: float, opponent: float) -> float:
    """rating 쪽의 기대 득점률 (0~1)."""
    return 1.0 / (1.0 + 10 ** ((opponent - rating) / 400.0))


def k_factor(games_before: int) -> int:
    return K_PLACEMENT if games_before < PLACEMENT_GAMES else K_REGULAR


def tier_band(tier: str) -> tuple[float, float]:
    """티어의 [하한, 상한) 레이팅."""
    floors = dict(TIER_FLOORS)
    idx = TIERS.index(tier)
    low = floors.get(tier, float("-inf"))
    high = floors[TIERS[idx - 1]] if idx > 0 else float("inf")
    return low, high


def tier_for(rating: float) -> str:
    """경계 여유 없이 레이팅이 속한 구간."""
    for tier, floor in TIER_FLOORS:
        if rating >= floor:
            return tier
    return TIERS[-1]


def next_tier(current: str, rating: float) -> str:
    """현재 티어에서 시작해, 구간을 HYSTERESIS 이상 벗어났을 때만 한 칸씩 옮긴다."""
    tier = current
    while True:
        low, high = tier_band(tier)
        idx = TIERS.index(tier)
        if rating >= high + HYSTERESIS and idx > 0:
            tier = TIERS[idx - 1]
        elif rating < low - HYSTERESIS and idx < len(TIERS) - 1:
            tier = TIERS[idx + 1]
        else:
            return tier


# --- 입력 / 출력 ------------------------------------------------------------
@dataclass(frozen=True)
class RatedGame:
    """레이팅 계산에 쓰는 경기 한 건 (DB 와 무관한 순수 데이터)."""

    match_id: int
    played_at: date
    team1: tuple[int, ...]
    team2: tuple[int, ...]
    score1: int
    score2: int
    gathering_id: int | None = None
    gathering_title: str | None = None


@dataclass
class RatingEvent:
    """한 선수의 경기 한 건에 대한 레이팅 변화."""

    match_id: int
    played_at: date
    gathering_id: int | None
    gathering_title: str | None
    partners: list[int]
    opponents: list[int]
    games_for: int
    games_against: int
    outcome: str  # win / loss / draw
    expected: float
    actual: float
    delta: float
    rating_before: float
    rating_after: float
    tier_after: str


@dataclass
class PlayerRating:
    user_id: int
    rating: float = BASE
    tier: str = START_TIER
    games: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    peak: float = BASE
    last_played: date | None = None
    history: list[RatingEvent] = field(default_factory=list)

    @property
    def provisional(self) -> bool:
        """배치 경기 중 (아직 레이팅이 크게 움직이는 단계)."""
        return self.games < PLACEMENT_GAMES


@dataclass(frozen=True)
class PreMatch:
    """경기 직전 두 팀의 레이팅과 팀1 기대 득점률."""

    team1_rating: float
    team2_rating: float
    expected_team1: float


@dataclass
class RatingBook:
    """전체 계산 결과: 선수별 레이팅 + 반영된 경기(매칭 다양성 계산에도 쓴다)."""

    players: dict[int, PlayerRating]
    games: list[RatedGame]
    pre_match: dict[int, PreMatch]

    def get(self, user_id: int) -> PlayerRating:
        return self.players.get(user_id) or PlayerRating(user_id=user_id)

    def rating(self, user_id: int) -> float:
        return self.get(user_id).rating


def compute(games: list[RatedGame]) -> RatingBook:
    """경기들을 날짜·입력 순으로 다시 돌려 레이팅을 계산한다."""
    players: dict[int, PlayerRating] = {}
    counted: list[RatedGame] = []
    pre_match: dict[int, PreMatch] = {}

    def player(uid: int) -> PlayerRating:
        if uid not in players:
            players[uid] = PlayerRating(user_id=uid)
        return players[uid]

    ordered = sorted(games, key=lambda g: (g.played_at, g.match_id))
    for g in ordered:
        total = g.score1 + g.score2
        if total <= 0 or not g.team1 or not g.team2:
            continue
        r1 = sum(player(u).rating for u in g.team1) / len(g.team1)
        r2 = sum(player(u).rating for u in g.team2) / len(g.team2)
        e1 = expected(r1, r2)
        s1 = g.score1 / total
        counted.append(g)
        pre_match[g.match_id] = PreMatch(r1, r2, e1)

        for team, opp, exp, act, gf, ga in (
            (g.team1, g.team2, e1, s1, g.score1, g.score2),
            (g.team2, g.team1, 1 - e1, 1 - s1, g.score2, g.score1),
        ):
            outcome = "win" if gf > ga else "loss" if gf < ga else "draw"
            for uid in team:
                p = player(uid)
                before = p.rating
                delta = k_factor(p.games) * (act - exp)
                p.rating = before + delta
                p.games += 1
                if outcome == "win":
                    p.wins += 1
                elif outcome == "loss":
                    p.losses += 1
                else:
                    p.draws += 1
                p.tier = next_tier(p.tier, p.rating)
                p.peak = max(p.peak, p.rating)
                p.last_played = g.played_at
                p.history.append(
                    RatingEvent(
                        match_id=g.match_id,
                        played_at=g.played_at,
                        gathering_id=g.gathering_id,
                        gathering_title=g.gathering_title,
                        partners=[u for u in team if u != uid],
                        opponents=list(opp),
                        games_for=gf,
                        games_against=ga,
                        outcome=outcome,
                        expected=exp,
                        actual=act,
                        delta=delta,
                        rating_before=before,
                        rating_after=p.rating,
                        tier_after=p.tier,
                    )
                )

    return RatingBook(players=players, games=counted, pre_match=pre_match)


# --- DB 에서 반영 대상 경기 모으기 -----------------------------------------
def rated_games(db: Session) -> list[RatedGame]:
    """오테식 모임 대진표에서 결과를 입력한 경기만 모은다."""
    rows = db.execute(
        select(Match, Gathering.title)
        .join(DrawMatch, DrawMatch.result_match_id == Match.id)
        .join(Gathering, Gathering.id == Match.gathering_id)
        .where(
            Gathering.kind.in_(CLUB_KINDS),
            Gathering.status != GatheringStatus.CANCELED,
            without_withdrawn(),
            without_invited_guests(),
        )
        .options(selectinload(Match.players))
    ).all()
    out: list[RatedGame] = []
    seen: set[int] = set()
    for match, title in rows:
        if match.id in seen:
            continue
        seen.add(match.id)
        out.append(
            RatedGame(
                match_id=match.id,
                played_at=match.played_at,
                team1=tuple(sorted(p.user_id for p in match.players if p.team == TeamSide.TEAM_1)),
                team2=tuple(sorted(p.user_id for p in match.players if p.team == TeamSide.TEAM_2)),
                score1=match.team1_score or 0,
                score2=match.team2_score or 0,
                gathering_id=match.gathering_id,
                gathering_title=title,
            )
        )
    return out


def load(db: Session) -> RatingBook:
    return compute(rated_games(db))
