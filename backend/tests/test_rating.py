"""레이팅 엔진(순수 함수): 게임 득점률 Elo, 배치 K, 티어 경계 여유, 수렴 시뮬레이션."""
import random
import statistics
from datetime import date, timedelta

from app import rating as R


def g(mid, t1, t2, s1, s2, day=1):
    return R.RatedGame(mid, date(2026, 1, day), tuple(t1), tuple(t2), s1, s2)


def test_everyone_starts_equal():
    book = R.compute([])
    p = book.get(1)
    assert (p.rating, p.tier, p.games, p.provisional) == (R.BASE, "C", 0, True)


def test_game_share_counts_margin():
    big = R.compute([g(1, [1, 2], [3, 4], 6, 0)])
    close = R.compute([g(1, [1, 2], [3, 4], 6, 4)])
    assert big.rating(1) - R.BASE > close.rating(1) - R.BASE > 0
    # 같은 팀은 같이 오르고, 상대는 같은 만큼 내려간다 (합은 그대로)
    assert big.rating(1) == big.rating(2)
    assert round(sum(big.rating(u) for u in (1, 2, 3, 4)), 6) == 4 * R.BASE
    # 배치 경기: K_PLACEMENT × (1.0 − 0.5)
    assert big.rating(1) == R.BASE + R.K_PLACEMENT * 0.5


def test_happy_game_draw_and_tiebreak():
    even = R.compute([g(1, [1, 2], [3, 4], 5, 5)])
    assert even.rating(1) == R.BASE
    p = even.get(1)
    assert (p.wins, p.losses, p.draws) == (0, 0, 1)
    # 강한 팀이 5:5 로 비기면 기대보다 못한 것 → 내려간다
    games = [g(1, [1, 2], [3, 4], 6, 0), g(2, [1, 2], [3, 4], 5, 5, day=2)]
    book = R.compute(games)
    assert book.get(1).history[-1].delta < 0
    # 타이브레이크 6:5 는 근소한 승리
    tb = R.compute([g(1, [1, 2], [3, 4], 6, 5)])
    assert 0 < tb.rating(1) - R.BASE < 5


def test_zero_score_ignored_and_order_by_date():
    book = R.compute([g(2, [1, 2], [3, 4], 0, 0, day=1)])
    assert book.games == [] and book.players == {}
    # 날짜 순으로 다시 돌린다 (입력 순서와 무관)
    a = R.compute([g(1, [1, 2], [3, 4], 6, 1, day=1), g(2, [1, 3], [2, 4], 6, 2, day=2)])
    b = R.compute([g(2, [1, 3], [2, 4], 6, 2, day=2), g(1, [1, 2], [3, 4], 6, 1, day=1)])
    assert a.rating(1) == b.rating(1)
    assert set(a.pre_match) == {1, 2}


def test_k_drops_after_placement():
    assert R.k_factor(0) == R.K_PLACEMENT
    assert R.k_factor(R.PLACEMENT_GAMES - 1) == R.K_PLACEMENT
    assert R.k_factor(R.PLACEMENT_GAMES) == R.K_REGULAR


def test_tier_hysteresis():
    h = R.HYSTERESIS
    assert R.tier_for(1000) == "C" and R.tier_for(1150) == "A" and R.tier_for(800) == "E"
    # B 하한(1050)을 넘었지만 여유(h)만큼은 아니면 그대로 C
    assert R.next_tier("C", 1050 + h - 1) == "C"
    assert R.next_tier("C", 1050 + h) == "B"
    # B 에서 1050 아래로 조금 내려와도 유지
    assert R.next_tier("B", 1050 - h) == "B"
    assert R.next_tier("B", 1050 - h - 1) == "C"
    # 크게 움직이면 여러 칸
    assert R.next_tier("C", 1300) == "A"
    assert R.next_tier("C", 700) == "E"


def _play_set(p, rng):
    a = b = 0
    while True:
        if rng.random() < p:
            a += 1
        else:
            b += 1
        if a == 5 and b == 5 and rng.random() < 0.5:
            return a, b  # 해피게임
        if (a >= 6 or b >= 6) and abs(a - b) >= 2 or a == 7 or b == 7:
            return a, b


def _ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0] * len(v)
    for k, i in enumerate(order):
        r[i] = k
    return r


def test_simulated_club_converges():
    """24명, 주 1회(12~16명 참석, 3코트 4라운드) 무작위 대진 16주.
    실제 실력 순서와 레이팅 순서가 꽤 맞고, 티어는 대부분 한 칸 이내여야 한다."""
    rhos, near = [], []
    for seed in range(5):
        rng = random.Random(seed)
        truth = {i: rng.gauss(1000, 130) for i in range(24)}
        games, mid = [], 0
        for week in range(16):
            day = date(2026, 1, 1) + timedelta(days=7 * week)
            attending = rng.sample(range(24), rng.randint(12, 16))
            for _ in range(4):
                rng.shuffle(attending)
                for c in range(3):
                    t1, t2 = attending[c * 4 : c * 4 + 2], attending[c * 4 + 2 : c * 4 + 4]
                    e = R.expected(sum(truth[u] for u in t1) / 2, sum(truth[u] for u in t2) / 2)
                    s1, s2 = _play_set(e, rng)
                    mid += 1
                    games.append(R.RatedGame(mid, day, tuple(t1), tuple(t2), s1, s2))
        book = R.compute(games)
        ids = sorted(book.players)
        rhos.append(
            statistics.correlation(
                _ranks([book.rating(i) for i in ids]), _ranks([truth[i] for i in ids])
            )
        )
        near.append(
            sum(
                abs(R.TIERS.index(book.get(i).tier) - R.TIERS.index(R.tier_for(truth[i]))) <= 1
                for i in ids
            )
            / len(ids)
        )
    assert statistics.mean(rhos) >= 0.8
    assert statistics.mean(near) >= 0.9
