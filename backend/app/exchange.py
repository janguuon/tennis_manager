"""
교류전 대진·점수 계산 (routers/exchanges.py 가 쓴다).

- 상대 선수 명단 붙여 넣기: "홍길동 남, 김영희 여" → [(이름, 성별)]
- 대진 자동 짜기: 라운드 × 코트. 라운드마다 우리 팀·상대 팀에서 경기를 덜 뛴 사람부터 넣고(같으면 연달아
  오래 쉰 사람 먼저), 남복은 남복끼리·여복은 여복끼리·혼복은 혼복끼리 맞붙게, 같은 짝·같은 상대가 겹치지 않게 고른다.
  사람이 모자란 코트는 빈칸으로 남긴다(직접 채울 수 있다).
- 점수판: 이긴 경기 수 → 같으면 딴 게임 수 합 → 그래도 같으면 무승부.
- 오늘의 MVP: 우리 팀에서 가장 많이 이긴 사람(같으면 게임 득실), 1승 이상.
"""
from __future__ import annotations

import random
import re
from collections import Counter
from dataclasses import dataclass, field

from .matchmaking import classify
from .models import Gender, MatchType

OURS_LABEL = "오테식"
DEFAULT_OPPONENT_LABEL = "상대 클럽"
MAX_OPPONENTS = 60
MAX_ROUNDS = 12
MAX_COURTS = 30
TRIES = 120  # 라운드마다 짝·상대를 섞어 보는 횟수
PLANS = 24  # 잡복이 생기면 전체를 다시 짜 보는 횟수
W_OPEN = 30.0  # 성별이 안 맞는 복식(잡복) 한 경기 — 피할 수 있으면 피한다
W_PARTNER = 4.0  # 오늘 또 같은 짝
W_OPPONENT = 1.0  # 오늘 또 같은 상대

_GENDER_WORDS = {
    "남": Gender.MALE, "남자": Gender.MALE, "남성": Gender.MALE, "m": Gender.MALE, "male": Gender.MALE,
    "여": Gender.FEMALE, "여자": Gender.FEMALE, "여성": Gender.FEMALE, "f": Gender.FEMALE, "female": Gender.FEMALE,
}


def default_opponent(title: str | None) -> str | None:
    """일정 제목에서 상대 클럽 이름을 짐작한다: 'A클럽 교류전' → 'A클럽', '교류전' → None.
    제목에 '교류전'·'대항전'·'vs' 가 없으면 짐작하지 않는다(그냥 '상대 클럽')."""
    if not re.search(r"교류전|대항전|vs", title or "", re.IGNORECASE):
        return None
    name = re.sub(r"[\[\]()]", " ", title or "")
    name = re.sub(rf"교류전|대항전|vs\.?|{OURS_LABEL}", " ", name, flags=re.IGNORECASE)
    name = " ".join(name.split()).strip(" -·:,")
    return name[:50] or None


def parse_opponents(text: str) -> list[tuple[str, Gender | None]]:
    """'홍길동 남, 김영희(여)\\n박철수' → [('홍길동', 남), ('김영희', 여), ('박철수', None)].
    쉼표·줄바꿈·가운뎃점·세미콜론으로 나누고, 끝에 붙은 성별 말(남/여/남자/여성/M/F…)을 성별로 읽는다."""
    out: list[tuple[str, Gender | None]] = []
    for piece in re.split(r"[,\n;·/]", text or ""):
        part = re.sub(r"[()\[\]]", " ", piece).split()
        if not part:
            continue
        gender = None
        # 이름 뒤에 띄어 쓴 성별 말만 읽는다 ('홍길동남'처럼 붙여 쓴 건 이름일 수 있어 그대로)
        if len(part) > 1 and part[-1].lower() in _GENDER_WORDS:
            gender = _GENDER_WORDS[part.pop().lower()]
        name = " ".join(part)[:30]
        if name:
            out.append((name, gender))
    return out


# --- 대진 짜기 ---------------------------------------------------------------
Pair = tuple[int, ...]


def _type_key(pair: Pair, genders: dict[int, Gender | None]) -> str:
    gs = [genders.get(p) for p in pair]
    if None in gs:
        return "?"
    return "".join(sorted("M" if g == Gender.MALE else "F" for g in gs))


@dataclass
class _History:
    """오늘 대진에서 이미 정해진 경기들: 뛴 수, 같은 짝, 같은 상대."""

    played_ours: Counter = field(default_factory=Counter)
    played_theirs: Counter = field(default_factory=Counter)
    partners: Counter = field(default_factory=Counter)  # ('o'|'t', frozenset) → 횟수
    meetings: Counter = field(default_factory=Counter)  # (우리 id, 상대 id) → 횟수

    def add(self, ours: list[int], theirs: list[int]) -> None:
        self.played_ours.update(ours)
        self.played_theirs.update(theirs)
        if len(ours) == 2:
            self.partners[("o", frozenset(ours))] += 1
        if len(theirs) == 2:
            self.partners[("t", frozenset(theirs))] += 1
        for a in ours:
            for x in theirs:
                self.meetings[(a, x)] += 1


def _pick(ids: list[int], k: int, played: Counter, streak: dict[int, int], rng: random.Random) -> list[int]:
    """덜 뛴 사람부터, 같으면 연달아 오래 쉰 사람 먼저, 그래도 같으면 랜덤으로 k명."""
    order = list(ids)
    rng.shuffle(order)
    order.sort(key=lambda u: (played[u], -streak.get(u, 0)))
    return order[:k]


def _rest_streak(ids, rnd: int, by_round: dict[int, set[int]]) -> dict[int, int]:
    """rnd 라운드 바로 앞까지 연달아 쉰 라운드 수."""
    out = {}
    for u in ids:
        n = 0
        while (rnd - n - 1) in by_round and u not in by_round[rnd - n - 1]:
            n += 1
        out[u] = n
    return out


def _pairs(ids: list[int], rng: random.Random) -> list[Pair]:
    order = list(ids)
    rng.shuffle(order)
    return [tuple(order[i : i + 2]) for i in range(0, len(order), 2)]


def _face_off(ours: list[Pair], theirs: list[Pair], genders_o: dict, genders_t: dict) -> list[tuple[Pair, Pair]]:
    """같은 성별 구성(남복·여복·혼복)끼리 먼저 맞붙이고, 남는 짝끼리 붙인다."""
    left_t = list(theirs)
    games: list[tuple[Pair, Pair]] = []
    rest_o: list[Pair] = []
    for pair in ours:
        key = _type_key(pair, genders_o)
        match = next((t for t in left_t if key != "?" and _type_key(t, genders_t) == key), None)
        if match is None:
            rest_o.append(pair)
            continue
        left_t.remove(match)
        games.append((pair, match))
    games += list(zip(rest_o, left_t))
    return games


def _round(
    ours: dict[int, Gender | None],
    theirs: dict[int, Gender | None],
    courts: int,
    history: _History,
    streak_ours: dict[int, int],
    streak_theirs: dict[int, int],
    rng: random.Random,
) -> tuple[list[tuple[list[int], list[int]]], float]:
    """한 라운드: 코트 수만큼 (우리 선수, 상대 선수) 복식과 그 비용. 사람이 모자라면 짤 수 있는 만큼만."""
    k = min(courts, len(ours) // 2, len(theirs) // 2)
    if k == 0:
        return [], 0.0
    # 성별 구성을 비교하려면 우리·상대 id 가 겹치지 않게 따로 표시한다
    genders = {("o", u): g for u, g in ours.items()} | {("t", x): g for x, g in theirs.items()}
    best: tuple[float, list[tuple[Pair, Pair]]] | None = None
    for _ in range(TRIES):
        pick_o = _pick(list(ours), 2 * k, history.played_ours, streak_ours, rng)
        pick_t = _pick(list(theirs), 2 * k, history.played_theirs, streak_theirs, rng)
        games = _face_off(_pairs(pick_o, rng), _pairs(pick_t, rng), ours, theirs)
        tagged = [(tuple(("o", u) for u in o), tuple(("t", x) for x in t)) for o, t in games]
        open_cost = sum(
            W_OPEN for o, t in tagged if classify(list(o), list(t), genders) == MatchType.OPEN_DOUBLES
        )
        cost = open_cost + _cost_repeats(games, history)
        if best is None or cost < best[0]:
            best = (cost, games)
        if cost == 0:
            break
    return [(list(o), list(t)) for o, t in best[1]], best[0]


def _cost_repeats(games: list[tuple[Pair, Pair]], history: _History) -> float:
    cost = 0.0
    for o, t in games:
        cost += W_PARTNER * history.partners[("o", frozenset(o))]
        cost += W_PARTNER * history.partners[("t", frozenset(t))]
        cost += W_OPPONENT * sum(history.meetings[(a, x)] for a in o for x in t)
    return cost


def generate(
    ours: dict[int, Gender | None],
    theirs: dict[int, Gender | None],
    rounds: list[int],
    courts: int,
    kept: list[tuple[int, list[int], list[int]]] | None = None,
    rng: random.Random | None = None,
) -> list[dict]:
    """rounds 의 라운드들을 새로 짠다. kept: 그대로 두는 다른 라운드 경기 (라운드, 우리, 상대) — 뛴 수·짝 계산에 넣는다.

    라운드를 앞에서부터 차례로 짜면 마지막 라운드에 남는 사람들의 성별이 안 맞을 수 있어,
    전체를 여러 번 짜 보고 잡복이 없는(없으면 비용이 가장 적은) 짜임을 고른다.
    반환: [{round_number, court, ours_ids, theirs_ids, match_type}] — 라운드마다 courts 칸 (모자라면 빈칸).
    """
    rng = rng or random.Random()
    best: tuple[float, list[dict]] | None = None
    for _ in range(PLANS):
        cost, rows = _plan(ours, theirs, rounds, courts, kept or [], rng)
        if best is None or cost < best[0]:
            best = (cost, rows)
        if not any(r["ours_ids"] and r["match_type"] == MatchType.OPEN_DOUBLES for r in rows):
            break
    return best[1]


def _plan(
    ours: dict[int, Gender | None],
    theirs: dict[int, Gender | None],
    rounds: list[int],
    courts: int,
    kept: list[tuple[int, list[int], list[int]]],
    rng: random.Random,
) -> tuple[float, list[dict]]:
    history = _History()
    by_round: dict[int, set[int]] = {}
    by_round_t: dict[int, set[int]] = {}
    for rnd, o, t in kept:
        history.add(o, t)
        by_round.setdefault(rnd, set()).update(o)
        by_round_t.setdefault(rnd, set()).update(t)
    genders = {("o", u): g for u, g in ours.items()} | {("t", x): g for x, g in theirs.items()}
    total = 0.0
    out: list[dict] = []
    for rnd in sorted(rounds):
        streak_o = _rest_streak(ours, rnd, by_round)
        streak_t = _rest_streak(theirs, rnd, by_round_t)
        games, cost = _round(ours, theirs, courts, history, streak_o, streak_t, rng)
        total += cost
        for o, t in games:
            history.add(o, t)
        by_round[rnd] = {u for o, _ in games for u in o}
        by_round_t[rnd] = {x for _, t in games for x in t}
        for court in range(1, courts + 1):
            if court <= len(games):
                o, t = games[court - 1]
                kind = classify([("o", u) for u in o], [("t", x) for x in t], genders)
            else:
                o, t, kind = [], [], MatchType.OPEN_DOUBLES
            out.append(dict(round_number=rnd, court=court, ours_ids=o, theirs_ids=t, match_type=kind))
    return total, out


def match_type(ours: list[int], theirs: list[int], ours_g: dict, theirs_g: dict) -> MatchType:
    """직접 짠 경기의 종목 (단식 1:1, 복식은 성별 구성으로)."""
    genders = {("o", u): ours_g.get(u) for u in ours} | {("t", x): theirs_g.get(x) for x in theirs}
    return classify([("o", u) for u in ours], [("t", x) for x in theirs], genders)


# --- 점수판 -----------------------------------------------------------------
@dataclass
class Score:
    ours_wins: int = 0
    theirs_wins: int = 0
    draws: int = 0
    ours_games: int = 0
    theirs_games: int = 0

    @property
    def leader(self) -> str | None:
        """이긴 경기 수 → 같으면 딴 게임 수 합. 그래도 같으면 None(무승부)."""
        if self.ours_wins != self.theirs_wins:
            return "ours" if self.ours_wins > self.theirs_wins else "theirs"
        if self.ours_games != self.theirs_games:
            return "ours" if self.ours_games > self.theirs_games else "theirs"
        return None


def score(results: list[tuple[int | None, int, int]]) -> Score:
    """results: 점수가 들어간 경기들의 (winner, 우리 게임, 상대 게임)."""
    s = Score()
    for winner, o, t in results:
        if winner == 1:
            s.ours_wins += 1
        elif winner == 2:
            s.theirs_wins += 1
        else:
            s.draws += 1
        s.ours_games += o
        s.theirs_games += t
    return s


@dataclass
class PlayerLine:
    games: int = 0
    wins: int = 0
    diff: int = 0  # 딴 게임 - 잃은 게임


def player_lines(matches: list[tuple[list[int], list[int], int | None, int | None, int | None]]) -> tuple[dict, dict]:
    """(우리, 상대, winner, 우리 게임, 상대 게임) → 우리 선수별·상대 선수별 오늘 성적 (점수가 들어간 경기만)."""
    ours: dict[int, PlayerLine] = {}
    theirs: dict[int, PlayerLine] = {}
    for o, t, winner, so, st in matches:
        if so is None or st is None:
            continue
        for u in o:
            line = ours.setdefault(u, PlayerLine())
            line.games += 1
            line.wins += winner == 1
            line.diff += so - st
        for x in t:
            line = theirs.setdefault(x, PlayerLine())
            line.games += 1
            line.wins += winner == 2
            line.diff += st - so
    return ours, theirs


def mvp(lines: dict[int, PlayerLine]) -> list[int]:
    """가장 많이 이긴 사람(같으면 게임 득실). 1승 이상, 같은 성적이면 모두(3명까지)."""
    if not lines:
        return []
    best = max((line.wins, line.diff) for line in lines.values())
    if best[0] < 1:
        return []
    top = [u for u, line in lines.items() if (line.wins, line.diff) == best]
    return top if len(top) <= 3 else []
