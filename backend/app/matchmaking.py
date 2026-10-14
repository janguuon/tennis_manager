"""
자동 대진 생성 로직.

- random   (다양하게)   : 이번 대진과 최근 오테식 경기에서 덜 만난 사람끼리 짝·상대가 되게 짠다.
- balanced (실력 밸런스): 위의 다양성에 더해, 코트마다 두 팀 레이팅 평균이 비슷하게(접전) 짠다.
                          한 코트 안에 잘하는 사람과 막 시작한 사람이 섞여도 팀끼리만 비슷하면 된다.
- skill    : 예전 이름. balanced 와 같다.

NTRP 는 쓰지 않는다. 레이팅은 rating.py 가 오테식 모임 대진 결과로만 계산한 값이다.

rounds 만큼 라운드를 만들고 라운드마다 코트 수만큼 경기를 채운다. 코트보다 사람이 많으면
이번 대진에서 덜 뛴 사람이 먼저 들어가고, 같은 사람이 연달아 쉬지 않게 한다.
rounds 를 주지 않으면 모두가 한 경기 이상 뛰도록 라운드 수를 정한다.

반환값은 라우터가 DrawMatch 로 저장하기 쉬운 dict 리스트.
각 dict: {court_number, round_number, team1_ids, team2_ids}
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from itertools import combinations

from .models import Gender, MatchType, User
from .rating import BASE, RatedGame

# --- 비용 가중치 ------------------------------------------------------------
# 팀 평균 레이팅이 BALANCE_UNIT 만큼 차이 나면 비용 W_BALANCE (제곱으로 커진다).
BALANCE_UNIT = 50.0
W_BALANCE = 1.0
# 같은 대진(오늘) 안에서 또 같은 편 / 또 상대
W_PARTNER_TODAY = 4.0
W_OPPONENT_TODAY = 1.0
# 최근 오테식 경기에서 같은 편 / 상대였던 횟수(오래될수록 옅어진다)
W_PARTNER_RECENT = 0.6
W_OPPONENT_RECENT = 0.15
RECENT_HALF_LIFE_DAYS = 28


@dataclass
class MatchContext:
    """대진을 짤 때 참고하는 기록: 레이팅과 최근에 함께/맞서 뛴 정도."""

    ratings: dict[int, float] = field(default_factory=dict)
    partners: dict[frozenset[int], float] = field(default_factory=dict)
    opponents: dict[frozenset[int], float] = field(default_factory=dict)
    # 같은 모임에 이미 있는 대진의 경기들 (팀1, 팀2) — '오늘' 만난 것으로 친다.
    earlier: list[tuple[list[int], list[int]]] = field(default_factory=list)

    def rating(self, user_id: int) -> float:
        return self.ratings.get(user_id, BASE)


def recent_meetings(
    games: list[RatedGame], today: date
) -> tuple[dict[frozenset[int], float], dict[frozenset[int], float]]:
    """최근 경기에서 같은 편·상대로 만난 정도. 4주 전 경기는 절반만 센다."""
    partners: dict[frozenset[int], float] = defaultdict(float)
    opponents: dict[frozenset[int], float] = defaultdict(float)
    for g in games:
        days = max((today - g.played_at).days, 0)
        w = 0.5 ** (days / RECENT_HALF_LIFE_DAYS)
        for team in (g.team1, g.team2):
            for a, b in combinations(team, 2):
                partners[frozenset((a, b))] += w
        for a in g.team1:
            for b in g.team2:
                opponents[frozenset((a, b))] += w
    return dict(partners), dict(opponents)


# --- 한 라운드 배치 ---------------------------------------------------------
class _Planner:
    def __init__(self, method: str, context: MatchContext, rng: random.Random):
        self.balanced = method in ("balanced", "skill")
        self.ctx = context
        self.rng = rng
        self.partner_today: dict[frozenset[int], int] = defaultdict(int)
        self.opponent_today: dict[frozenset[int], int] = defaultdict(int)

    def team_cost(self, team: list[int]) -> float:
        c = 0.0
        for a, b in combinations(team, 2):
            key = frozenset((a, b))
            c += W_PARTNER_TODAY * self.partner_today[key]
            c += W_PARTNER_RECENT * self.ctx.partners.get(key, 0.0)
        return c

    def match_cost(self, t1: list[int], t2: list[int]) -> float:
        c = self.team_cost(t1) + self.team_cost(t2)
        for a in t1:
            for b in t2:
                key = frozenset((a, b))
                c += W_OPPONENT_TODAY * self.opponent_today[key]
                c += W_OPPONENT_RECENT * self.ctx.opponents.get(key, 0.0)
        if self.balanced:
            r1 = sum(self.ctx.rating(u) for u in t1) / len(t1)
            r2 = sum(self.ctx.rating(u) for u in t2) / len(t2)
            c += W_BALANCE * ((r1 - r2) / BALANCE_UNIT) ** 2
        return c

    def remember(self, t1: list[int], t2: list[int]) -> None:
        for team in (t1, t2):
            for a, b in combinations(team, 2):
                self.partner_today[frozenset((a, b))] += 1
        for a in t1:
            for b in t2:
                self.opponent_today[frozenset((a, b))] += 1

    def arrange(self, slots: list[int], unit: int, groups: list[int]) -> list[tuple[list[int], list[int]]]:
        """slots 를 unit 명씩 끊어 경기로 보고(앞 절반이 팀1), 비용이 가장 낮은 배치를 찾는다.

        groups[i] 가 같은 자리끼리만 맞바꾼다(혼복: 남자 자리 ↔ 남자 자리).
        여러 번 무작위로 섞은 뒤 맞바꾸기로 다듬는 지역 탐색 — 동호회 인원이면 충분히 빠르다.
        """
        n_matches = len(slots) // unit
        half = unit // 2

        def cost_of(arr: list[int], m: int) -> float:
            seg = arr[m * unit : (m + 1) * unit]
            return self.match_cost(seg[:half], seg[half:])

        swaps = [
            (i, j)
            for i in range(len(slots))
            for j in range(i + 1, len(slots))
            if groups[i] == groups[j] and not (i // unit == j // unit and (i % unit < half) == (j % unit < half))
        ]
        restarts = 10 if len(slots) <= 16 else 5
        best: list[int] | None = None
        best_cost = math.inf
        for _ in range(restarts):
            arr = list(slots)
            for g in set(groups):
                idx = [i for i, gg in enumerate(groups) if gg == g]
                vals = [arr[i] for i in idx]
                self.rng.shuffle(vals)
                for i, v in zip(idx, vals):
                    arr[i] = v
            costs = [cost_of(arr, m) for m in range(n_matches)]
            improved = True
            while improved:
                improved = False
                self.rng.shuffle(swaps)
                for i, j in swaps:
                    mi, mj = i // unit, j // unit
                    before = costs[mi] + (costs[mj] if mj != mi else 0.0)
                    arr[i], arr[j] = arr[j], arr[i]
                    ci = cost_of(arr, mi)
                    cj = cost_of(arr, mj) if mj != mi else 0.0
                    if ci + cj < before - 1e-9:
                        costs[mi] = ci
                        if mj != mi:
                            costs[mj] = cj
                        improved = True
                    else:
                        arr[i], arr[j] = arr[j], arr[i]
            total = sum(costs)
            if total < best_cost - 1e-9:
                best, best_cost = arr, total
        assert best is not None
        return [
            (best[m * unit : m * unit + half], best[m * unit + half : (m + 1) * unit])
            for m in range(n_matches)
        ]


# --- 진입점 -----------------------------------------------------------------
def _pool(participants: list[User], match_type: MatchType) -> list[User]:
    """종목에 맞는 인원. 남복/여복은 해당 성별이 4명 미만이면 전체로 짠다."""
    if match_type == MatchType.MENS_DOUBLES:
        men = [p for p in participants if p.gender == Gender.MALE]
        return men if len(men) >= 4 else list(participants)
    if match_type == MatchType.WOMENS_DOUBLES:
        women = [p for p in participants if p.gender == Gender.FEMALE]
        return women if len(women) >= 4 else list(participants)
    return list(participants)


def _pick(ids: list[int], k: int, played: dict[int, int], rested: set[int], rng: random.Random) -> list[int]:
    """덜 뛴 사람 → 지난 라운드에 쉰 사람 순으로 k명."""
    order = sorted(ids, key=lambda u: (played[u], 0 if u in rested else 1, rng.random()))
    return order[:k]


def generate(
    participants: list[User],
    court_count: int,
    match_type: MatchType,
    method: str = "random",
    rounds: int | None = None,
    context: MatchContext | None = None,
    rng: random.Random | None = None,
) -> list[dict]:
    """참석자 목록으로 대진을 생성한다. 짝이 맞지 않으면 ValueError."""
    rng = rng or random.Random()
    ctx = context or MatchContext()
    planner = _Planner(method, ctx, rng)
    for t1, t2 in ctx.earlier:
        planner.remember(t1, t2)
    courts = max(court_count, 1)

    if match_type == MatchType.MIXED_DOUBLES:
        men = [p.id for p in participants if p.gender == Gender.MALE]
        women = [p.id for p in participants if p.gender == Gender.FEMALE]
        per_round = min(courts, len(men) // 2, len(women) // 2)
        if per_round < 1:
            raise ValueError("혼복 대진엔 성별을 등록한 남녀가 각각 2명 이상 필요해요.")
        everyone = men + women
        need_rounds = math.ceil(max(len(men), len(women)) / (2 * per_round))
    else:
        unit_size = 2 if match_type == MatchType.SINGLES else 4
        everyone = [p.id for p in _pool(participants, match_type)]
        per_round = min(courts, len(everyone) // unit_size)
        if per_round < 1:
            raise ValueError(f"대진을 만들기엔 인원이 부족해요. (최소 {unit_size}명)")
        need_rounds = math.ceil(len(everyone) / (unit_size * per_round))

    total_rounds = rounds or need_rounds
    played: dict[int, int] = {u: 0 for u in everyone}
    rested: set[int] = set()
    out: list[dict] = []

    for rnd in range(1, total_rounds + 1):
        if match_type == MatchType.MIXED_DOUBLES:
            m = _pick(men, 2 * per_round, played, rested, rng)
            w = _pick(women, 2 * per_round, played, rested, rng)
            # 경기마다 [남, 여 | 남, 여]
            slots, groups = [], []
            for i in range(per_round):
                slots += [m[2 * i], w[2 * i], m[2 * i + 1], w[2 * i + 1]]
                groups += [0, 1, 0, 1]
            unit = 4
        else:
            unit = 2 if match_type == MatchType.SINGLES else 4
            slots = _pick(everyone, unit * per_round, played, rested, rng)
            groups = [0] * len(slots)

        matches = planner.arrange(slots, unit, groups)
        on_court = set(slots)
        rested = {u for u in everyone if u not in on_court}
        for court, (t1, t2) in enumerate(matches, start=1):
            planner.remember(t1, t2)
            for u in t1 + t2:
                played[u] += 1
            out.append(
                {
                    "court_number": court,
                    "round_number": rnd,
                    "team1_ids": list(t1),
                    "team2_ids": list(t2),
                }
            )
    return out
