"""참석 현황 (관리자): 회원마다 그 달·그 해 참석한 모임 수·모임. 취소된 모임·대기·불참은 세지 않는다."""
from datetime import datetime


def test_monthly_attendance_counts_attending_only(club, fixed_now):
    club.add_members("amy", "ben", "cal", "gus")
    club.set_type("gus", "guest")
    g1 = club.create(kind="club_regular", event_date="2099-01-15", title="정모", max_participants=2).json()["id"]
    g2 = club.create(kind="flash", event_date="2099-01-20", title="벙개").json()["id"]
    g3 = club.create(kind="club_flash", event_date="2099-01-22", title="취소될 벙개").json()["id"]
    feb = club.create(kind="club_regular", event_date="2099-02-03", title="다음 달").json()["id"]
    club.vote(g1, "amy")
    club.vote(g1, "ben")
    assert club.vote(g1, "cal").json()["status"] == "waiting"  # 정원(2명)이 차서 대기
    fixed_now["now"] = datetime(2099, 1, 16, 11, 0)  # 다음 주 일정이 공개된 뒤
    assert club.vote(g2, "amy").status_code == 200
    assert club.vote(g2, "ben", "absent").status_code == 200
    club.c.put(f"/gatherings/{g2}/attendance", json={"status": "attending"}, headers=club.admin)
    # 이름만 적은 초대 게스트: 모임 인원에는 들어가지만 회원 줄은 아니다
    club.c.post(f"/gatherings/{g2}/guests", json={"name": "홍길동"}, headers=club.admin)
    assert club.vote(g3, "cal").status_code == 200
    club.c.post(f"/gatherings/{g3}/cancel", json={"reason": "우천 취소"}, headers=club.admin)
    fixed_now["now"] = datetime(2099, 1, 30, 11, 0)
    assert club.vote(feb, "cal").status_code == 200
    # 1/18 기준: 1/15 정모는 지난 모임, 1/20 벙개는 예정
    fixed_now["now"] = datetime(2099, 1, 18, 12, 0)

    r = club.c.get("/admin/attendance?month=2099-01", headers=club.admin)
    assert r.status_code == 200
    data = r.json()
    assert (data["unit"], data["period"], data["today"]) == ("month", "2099-01", "2099-01-18")
    assert [(g["title"], g["attending"]) for g in data["gatherings"]] == [("정모", 2), ("벙개", 3)]

    rows = {row["user"]["username"]: row for row in data["rows"]}
    # 회원 목록 사람은 0회도 나오고, 직함 없는 관리자 계정은 참석했을 때만
    assert set(rows) == {"amy", "ben", "cal", "gus", "admin1"}
    assert [row["user"]["username"] for row in data["rows"]][:1] == ["amy"]
    # 횟수는 오늘까지 지난 모임만, 오늘 뒤는 예정으로 따로 (모임 목록에는 예정도)
    amy = rows["amy"]
    assert (amy["total"], amy["upcoming"], amy["gathering_ids"]) == (1, 1, [g1, g2])
    assert amy["by_kind"] == {"club_regular": 1, "club_flash": 0, "flash": 0}
    assert (rows["ben"]["total"], rows["ben"]["gathering_ids"]) == (1, [g1])  # 불참은 안 센다
    assert rows["cal"]["total"] == 0  # 대기·취소된 모임·다음 달은 안 센다
    assert (rows["admin1"]["total"], rows["admin1"]["upcoming"], rows["admin1"]["gathering_ids"]) == (0, 1, [g2])
    assert rows["gus"]["total"] == 0

    # 참석하지 않은 달엔 관리자 계정 줄이 없다
    feb_rows = club.c.get("/admin/attendance?month=2099-02", headers=club.admin).json()["rows"]
    assert "admin1" not in {row["user"]["username"] for row in feb_rows}
    assert next(row for row in feb_rows if row["user"]["username"] == "cal")["gathering_ids"] == [feb]

    # 연간: 1·2월을 함께 (취소된 모임은 여전히 빠진다)
    year = club.c.get("/admin/attendance?year=2099", headers=club.admin).json()
    assert (year["unit"], year["period"]) == ("year", "2099")
    assert [g["title"] for g in year["gatherings"]] == ["정모", "벙개", "다음 달"]
    rows = {row["user"]["username"]: row for row in year["rows"]}
    assert (rows["amy"]["total"], rows["amy"]["upcoming"]) == (1, 1)
    assert (rows["cal"]["total"], rows["cal"]["upcoming"], rows["cal"]["gathering_ids"]) == (0, 1, [feb])
    # 날이 지나면 횟수로 넘어간다
    fixed_now["now"] = datetime(2099, 3, 1, 9, 0)
    rows = {row["user"]["username"]: row for row in club.c.get("/admin/attendance?year=2099", headers=club.admin).json()["rows"]}
    assert (rows["amy"]["total"], rows["amy"]["upcoming"], rows["cal"]["total"]) == (2, 0, 1)
    assert club.c.get("/admin/attendance?year=2098", headers=club.admin).json()["gatherings"] == []


def test_monthly_attendance_is_admin_only(club):
    club.add_members("off")
    club.set_type("off", "president")
    assert club.c.get("/admin/attendance?month=2099-01", headers=club.h("off")).status_code == 403
    assert club.c.get("/admin/attendance?year=2099", headers=club.h("off")).status_code == 403
    for q in ("month=2099-13", "year=99", "", "month=2099-01&year=2099"):
        assert club.c.get(f"/admin/attendance?{q}", headers=club.admin).status_code == 400, q
