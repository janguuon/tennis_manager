"""
전적 집계 로직 (순수 함수).

Match / MatchPlayer 기록으로부터 개인·페어·상대 전적, 랭킹을 계산한다.
별도 집계 테이블 없이 매 조회 시 계산하므로(= derived) 데이터 정합성이 보장된다.
"""
from collections import defaultdict
from dataclasses import dataclass, field

from .models import Match, MatchType, TeamSide


@dataclass
class Counter:
    wins: int = 0
    losses: int = 0
    draws: int = 0

    def add(self, outcome: str) -> None:
        if outcome == "win":
            self.wins += 1
        elif outcome == "loss":
            self.losses += 1
        else:
            self.draws += 1

    def as_dict(self) -> dict:
        decided = self.wins + self.losses
        total = decided + self.draws
        win_rate = round(self.wins / decided, 3) if decided else 0.0
        return {
            "wins": self.wins,
            "losses": self.losses,
            "draws": self.draws,
            "total": total,
            "win_rate": win_rate,
        }


def outcome_for_team(team: TeamSide, winner_team: TeamSide | None) -> str:
    """해당 팀 입장에서의 결과: win / loss / draw(미정 포함)."""
    if winner_team is None:
        return "draw"
    return "win" if team == winner_team else "loss"


def _user_team(match: Match, user_id: int) -> TeamSide | None:
    for mp in match.players:
        if mp.user_id == user_id:
            return mp.team
    return None


# --- 개인 전적 --------------------------------------------------------------
def player_stats(matches: list[Match], user_id: int) -> dict:
    """개인 종합 전적 + 경기유형(단식/남복/여복/혼복)별 전적."""
    overall = Counter()
    by_type: dict[MatchType, Counter] = defaultdict(Counter)

    for m in matches:
        team = _user_team(m, user_id)
        if team is None:
            continue
        outcome = outcome_for_team(team, m.winner_team)
        overall.add(outcome)
        by_type[m.match_type].add(outcome)

    return {
        "overall": overall.as_dict(),
        "by_type": [
            {"match_type": mt, "record": c.as_dict()} for mt, c in by_type.items()
        ],
    }


# --- 페어(파트너) 전적 ------------------------------------------------------
def partner_stats(matches: list[Match], user_id: int) -> list[dict]:
    """같은 팀으로 함께 뛴 파트너별 전적 (복식 한정)."""
    counters: dict[int, Counter] = defaultdict(Counter)
    partner_obj: dict[int, object] = {}

    for m in matches:
        team = _user_team(m, user_id)
        if team is None:
            continue
        outcome = outcome_for_team(team, m.winner_team)
        for mp in m.players:
            if mp.team == team and mp.user_id != user_id:
                counters[mp.user_id].add(outcome)
                partner_obj[mp.user_id] = mp.user

    return [
        {"partner": partner_obj[uid], "record": c.as_dict()}
        for uid, c in counters.items()
    ]


# --- 상대 전적 --------------------------------------------------------------
def opponent_stats(matches: list[Match], user_id: int) -> list[dict]:
    """상대 팀으로 만난 회원별 상대 전적."""
    counters: dict[int, Counter] = defaultdict(Counter)
    opp_obj: dict[int, object] = {}

    for m in matches:
        team = _user_team(m, user_id)
        if team is None:
            continue
        outcome = outcome_for_team(team, m.winner_team)
        for mp in m.players:
            if mp.team != team:
                counters[mp.user_id].add(outcome)
                opp_obj[mp.user_id] = mp.user

    return [
        {"opponent": opp_obj[uid], "record": c.as_dict()}
        for uid, c in counters.items()
    ]


# --- 랭킹 -------------------------------------------------------------------
@dataclass
class _RankAgg:
    user: object = None
    counter: Counter = field(default_factory=Counter)


def ranking(matches: list[Match], min_games: int = 0) -> list[dict]:
    """
    팀 랭킹. 승부가 난 경기 기준 승률 → 승수 순으로 정렬한다.

    min_games: 랭킹에 포함되기 위한 최소 경기 수(승+패).
    """
    aggs: dict[int, _RankAgg] = defaultdict(_RankAgg)

    for m in matches:
        for mp in m.players:
            agg = aggs[mp.user_id]
            agg.user = mp.user
            agg.counter.add(outcome_for_team(mp.team, m.winner_team))

    rows = []
    for agg in aggs.values():
        rec = agg.counter.as_dict()
        decided = rec["wins"] + rec["losses"]
        if decided < min_games:
            continue
        rows.append({"user": agg.user, "record": rec})

    # 정렬: 승률 desc → 승수 desc → 경기수 desc
    rows.sort(
        key=lambda r: (r["record"]["win_rate"], r["record"]["wins"], r["record"]["total"]),
        reverse=True,
    )
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows
