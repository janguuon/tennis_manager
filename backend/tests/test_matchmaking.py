"""대진 생성(순수 함수): 다양하게 / 실력 밸런스, 라운드·휴식 순환, 혼복 구성."""
import random
from collections import Counter
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app import matchmaking as M
from app.models import Gender, MatchType
from app.rating import RatedGame


def people(n, gender=Gender.MALE):
    return [SimpleNamespace(id=i, gender=gender) for i in range(1, n + 1)]


def pairs(out):
    return Counter(frozenset(m[k]) for m in out for k in ("team1_ids", "team2_ids"))


def plays(out):
    return Counter(u for m in out for u in m["team1_ids"] + m["team2_ids"])


def test_default_rounds_everyone_plays():
    out = M.generate(people(10), 2, MatchType.MENS_DOUBLES, rng=random.Random(1))
    # 10명 · 2코트 → 라운드당 8명, 모두 한 번 이상 뛰려면 2라운드
    assert {m["round_number"] for m in out} == {1, 2}
    assert set(plays(out)) == set(range(1, 11))
    assert all(m["court_number"] in (1, 2) for m in out)


def test_rest_rotation_is_fair_and_partners_vary():
    out = M.generate(people(10), 2, MatchType.MENS_DOUBLES, rounds=5, rng=random.Random(2))
    c = plays(out)
    assert max(c.values()) - min(c.values()) <= 1
    # 아무도 두 라운드 연속으로 쉬지 않는다
    for rnd in range(1, 5):
        on = lambda r: {u for m in out if m["round_number"] == r for u in m["team1_ids"] + m["team2_ids"]}
        assert not ({u for u in range(1, 11)} - on(rnd) - on(rnd + 1))
    assert max(pairs(out).values()) == 1


def test_eight_players_three_rounds_no_repeat_partner():
    for seed in range(5):
        for method in ("random", "balanced"):
            out = M.generate(people(8), 2, MatchType.MENS_DOUBLES, method, 3, rng=random.Random(seed))
            assert max(pairs(out).values()) == 1


def test_balanced_makes_close_matches():
    ratings = {1: 1300, 2: 1290, 3: 710, 4: 700}
    ctx = M.MatchContext(ratings=ratings)
    for seed in range(5):
        (m,) = M.generate(people(4), 1, MatchType.MENS_DOUBLES, "balanced", context=ctx, rng=random.Random(seed))
        # 잘하는 사람끼리 한 팀이 되지 않는다
        assert frozenset(m["team1_ids"]) not in ({1, 2}, {3, 4})
    # skill 은 balanced 의 예전 이름
    (m,) = M.generate(people(4), 1, MatchType.MENS_DOUBLES, "skill", context=ctx, rng=random.Random(0))
    assert frozenset(m["team1_ids"]) not in ({1, 2}, {3, 4})


def test_recent_partners_are_avoided():
    last_week = [RatedGame(1, date(2026, 1, 1), (1, 2), (3, 4), 6, 3)]
    p, o = M.recent_meetings(last_week, date(2026, 1, 8))
    ctx = M.MatchContext(partners=p, opponents=o)
    for seed in range(5):
        (m,) = M.generate(people(4), 1, MatchType.MENS_DOUBLES, context=ctx, rng=random.Random(seed))
        assert frozenset(m["team1_ids"]) not in ({1, 2}, {3, 4})


def test_recent_meetings_fade():
    old = RatedGame(1, date(2026, 1, 1), (1, 2), (3, 4), 6, 3)
    p, o = M.recent_meetings([old], date(2026, 1, 1) + timedelta(days=M.RECENT_HALF_LIFE_DAYS))
    assert p[frozenset((1, 2))] == pytest.approx(0.5)
    assert o[frozenset((1, 3))] == pytest.approx(0.5)


def test_earlier_draw_counts_as_today():
    ctx = M.MatchContext(earlier=[([1, 2], [3, 4])])
    for seed in range(5):
        (m,) = M.generate(people(4), 1, MatchType.MENS_DOUBLES, context=ctx, rng=random.Random(seed))
        assert frozenset(m["team1_ids"]) not in ({1, 2}, {3, 4})


def test_mixed_doubles_pairs_man_and_woman():
    roster = people(6, Gender.MALE) + [
        SimpleNamespace(id=i, gender=Gender.FEMALE) for i in range(7, 13)
    ]
    gender = {p.id: p.gender for p in roster}
    out = M.generate(roster, 3, MatchType.MIXED_DOUBLES, "balanced", rounds=3, rng=random.Random(0))
    assert len(out) == 9
    for m in out:
        for team in (m["team1_ids"], m["team2_ids"]):
            assert sorted(gender[u] for u in team) == [Gender.FEMALE, Gender.MALE]
    with pytest.raises(ValueError):
        M.generate(people(6) + [SimpleNamespace(id=99, gender=Gender.FEMALE)], 2, MatchType.MIXED_DOUBLES)


def test_singles_and_gender_fallback():
    out = M.generate(people(5), 2, MatchType.SINGLES, rng=random.Random(0))
    assert all(len(m["team1_ids"]) == len(m["team2_ids"]) == 1 for m in out)
    assert set(plays(out)) == set(range(1, 6))
    # 여복인데 여자가 4명 미만이면 전체로 짠다
    out = M.generate(people(4), 1, MatchType.WOMENS_DOUBLES, rng=random.Random(0))
    assert len(out) == 1
    with pytest.raises(ValueError):
        M.generate(people(3), 1, MatchType.MENS_DOUBLES)
