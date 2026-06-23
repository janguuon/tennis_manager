"""
데모 시드 데이터 생성 스크립트.

실행 (backend 폴더에서, 가상환경 활성화 상태):
    python seed.py

- 데모 회원 9명(모두 승인됨, 비밀번호: test1234)
- 모임 1건 + 전원 참석 + 자동 대진(실력기반) 1개
- 과거 경기 여러 건(단식/남복/여복/혼복) → 랭킹/페어/상대 전적용

이미 데모 데이터가 있으면(아이디 'kim' 존재) 건너뛴다.
실제로 가입한 본인 계정/데이터는 건드리지 않는다.
"""
import random
import sys
from datetime import date, time, timedelta

from sqlalchemy import select

# Windows 한글 콘솔(cp949)에서도 이모지/유니코드 출력이 깨지지 않도록.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from app import matchmaking
from app.database import Base, SessionLocal, engine
from app.models import (
    ApprovalStatus,
    AttendanceStatus,
    Draw,
    DrawMatch,
    Gathering,
    Gender,
    GatheringStatus,
    Match,
    MatchPlayer,
    MatchType,
    Participant,
    TeamSide,
    User,
)
from app.security import hash_password

# (아이디, 이름, 성별, NTRP)
DEMO_USERS = [
    ("kim", "김민준", Gender.MALE, 4.0),
    ("park", "박지호", Gender.MALE, 3.5),
    ("jung", "정우진", Gender.MALE, 3.0),
    ("yoon", "윤도현", Gender.MALE, 4.5),
    ("lim", "임하준", Gender.MALE, 3.0),
    ("lee", "이서연", Gender.FEMALE, 3.5),
    ("choi", "최수아", Gender.FEMALE, 4.0),
    ("kang", "강예은", Gender.FEMALE, 3.5),
    ("song", "송지아", Gender.FEMALE, 3.0),
]

LOCATIONS = ["시민 테니스장", "올림픽공원 코트", "강변 테니스클럽"]
SCORES = [(6, 4), (6, 3), (7, 5), (6, 2), (4, 6), (3, 6), (5, 7), (7, 6)]


def make_match(db, mtype, team1, team2, score, played_at, location, gathering_id=None):
    s1, s2 = score
    winner = TeamSide.TEAM_1 if s1 > s2 else TeamSide.TEAM_2 if s2 > s1 else None
    match = Match(
        match_type=mtype,
        played_at=played_at,
        location=location,
        team1_score=s1,
        team2_score=s2,
        winner_team=winner,
        gathering_id=gathering_id,
        players=(
            [MatchPlayer(user_id=u.id, team=TeamSide.TEAM_1) for u in team1]
            + [MatchPlayer(user_id=u.id, team=TeamSide.TEAM_2) for u in team2]
        ),
    )
    db.add(match)


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    random.seed(42)
    try:
        if db.scalar(select(User).where(User.username == "kim")):
            print("이미 데모 데이터가 있습니다. (아이디 'kim' 존재) — 건너뜁니다.")
            return

        # 1) 회원 생성 ----------------------------------------------------
        users = {}
        for uname, name, gender, ntrp in DEMO_USERS:
            u = User(
                username=uname,
                name=name,
                gender=gender,
                ntrp=ntrp,
                hashed_password=hash_password("test1234"),
                approval_status=ApprovalStatus.APPROVED,
                is_active=True,
            )
            db.add(u)
            users[uname] = u
        db.commit()
        for u in users.values():
            db.refresh(u)

        males = [users[k] for k in ("kim", "park", "jung", "yoon", "lim")]
        females = [users[k] for k in ("lee", "choi", "kang", "song")]
        today = date.today()

        def rday():
            return today - timedelta(days=random.randint(1, 21))

        # 2) 과거 경기(전적) ---------------------------------------------
        # 남복
        for _ in range(6):
            four = random.sample(males, 4)
            make_match(db, MatchType.MENS_DOUBLES, four[:2], four[2:],
                       random.choice(SCORES), rday(), random.choice(LOCATIONS))
        # 여복
        for _ in range(3):
            four = random.sample(females, 4)
            make_match(db, MatchType.WOMENS_DOUBLES, four[:2], four[2:],
                       random.choice(SCORES), rday(), random.choice(LOCATIONS))
        # 혼복
        for _ in range(4):
            ms = random.sample(males, 2)
            fs = random.sample(females, 2)
            make_match(db, MatchType.MIXED_DOUBLES, [ms[0], fs[0]], [ms[1], fs[1]],
                       random.choice(SCORES), rday(), random.choice(LOCATIONS))
        # 단식
        for _ in range(5):
            two = random.sample(males, 2)
            make_match(db, MatchType.SINGLES, [two[0]], [two[1]],
                       random.choice(SCORES), rday(), random.choice(LOCATIONS))
        db.commit()

        # 3) 다가오는 모임 + 전원 참석 -----------------------------------
        gathering = Gathering(
            title="6월 정기 모임",
            description="이번 주 토요일 정기 모임입니다. 많은 참여 바랍니다!",
            event_date=today + timedelta(days=3),
            start_time=time(9, 0),
            end_time=time(12, 0),
            location="시민 테니스장",
            court_count=2,
            status=GatheringStatus.PLANNED,
            created_by=users["kim"].id,
        )
        db.add(gathering)
        db.commit()
        db.refresh(gathering)

        for u in users.values():
            db.add(
                Participant(
                    gathering_id=gathering.id,
                    user_id=u.id,
                    status=AttendanceStatus.ATTENDING,
                )
            )
        db.commit()

        # 4) 자동 대진(남복, 실력기반) -----------------------------------
        generated = matchmaking.generate(
            list(males), gathering.court_count, MatchType.MENS_DOUBLES, "skill"
        )
        draw = Draw(
            gathering_id=gathering.id,
            name="1라운드",
            generation_method="skill",
            draw_matches=[
                DrawMatch(
                    court_number=g["court_number"],
                    round_number=g["round_number"],
                    match_type=MatchType.MENS_DOUBLES,
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

        print("✅ 데모 데이터 생성 완료")
        print(f"   - 회원 {len(users)}명 (비밀번호: test1234)")
        print("   - 과거 경기 18건 (남복/여복/혼복/단식)")
        print(f"   - 모임 '{gathering.title}' + 전원 참석 + 자동 대진 1개")
        print("   브라우저에서 랭킹/회원/캘린더를 확인해 보세요.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
