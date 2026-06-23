"""
자동 대진 생성 로직.

참석 인원과 코트 면 수(court_count)를 바탕으로 대진을 만든다.
- random : 무작위 배정
- skill  : NTRP 기반으로 팀/매치를 균형 있게 배정

반환값은 라우터가 DrawMatch 로 저장하기 쉬운 dict 리스트.
각 dict: {court_number, round_number, team1_ids, team2_ids}
court_count 만큼을 한 라운드로 보고, 초과분은 다음 라운드로 배치한다.
"""
import random

from .models import Gender, MatchType, User


def _skill(u: User) -> float:
    return u.ntrp if u.ntrp is not None else 0.0


def _split_doubles_teams(group: list[User], method: str) -> tuple[list[User], list[User]]:
    """4명 그룹을 두 팀으로 나눈다."""
    if method == "skill":
        s = sorted(group, key=_skill, reverse=True)
        # 최강+최약 vs 중간 둘 → 팀 전력 균형
        return [s[0], s[3]], [s[1], s[2]]
    g = list(group)
    random.shuffle(g)
    return [g[0], g[1]], [g[2], g[3]]


def _chunk_matches(team_units: list[tuple[list[User], list[User]]], court_count: int) -> list[dict]:
    out = []
    for idx, (t1, t2) in enumerate(team_units):
        out.append(
            {
                "court_number": (idx % court_count) + 1,
                "round_number": (idx // court_count) + 1,
                "team1_ids": [u.id for u in t1],
                "team2_ids": [u.id for u in t2],
            }
        )
    return out


def generate(
    participants: list[User],
    court_count: int,
    match_type: MatchType,
    method: str = "random",
) -> list[dict]:
    """참석자 목록으로 대진을 생성한다. 남는 인원은 대기(미배정)."""
    players = list(participants)
    if method == "skill":
        players.sort(key=_skill, reverse=True)
    else:
        random.shuffle(players)

    units: list[tuple[list[User], list[User]]] = []

    if match_type == MatchType.SINGLES:
        # 2명씩 매칭 (skill이면 인접 실력끼리 → 접전)
        for i in range(0, len(players) - 1, 2):
            units.append(([players[i]], [players[i + 1]]))

    elif match_type == MatchType.MIXED_DOUBLES:
        males = [p for p in players if p.gender == Gender.MALE]
        females = [p for p in players if p.gender == Gender.FEMALE]
        if method != "skill":
            random.shuffle(males)
            random.shuffle(females)
        # (남,여) 혼성 페어 구성 후 두 페어씩 대결
        pairs = [[m, f] for m, f in zip(males, females)]
        for i in range(0, len(pairs) - 1, 2):
            units.append((pairs[i], pairs[i + 1]))

    else:
        # 남복/여복/일반 복식: 가능하면 성별로 필터, 부족하면 전체 풀 사용
        pool = players
        if match_type == MatchType.MENS_DOUBLES:
            men = [p for p in players if p.gender == Gender.MALE]
            pool = men if len(men) >= 4 else players
        elif match_type == MatchType.WOMENS_DOUBLES:
            women = [p for p in players if p.gender == Gender.FEMALE]
            pool = women if len(women) >= 4 else players

        for i in range(0, len(pool) - 3, 4):
            t1, t2 = _split_doubles_teams(pool[i : i + 4], method)
            units.append((t1, t2))

    return _chunk_matches(units, max(court_count, 1))
