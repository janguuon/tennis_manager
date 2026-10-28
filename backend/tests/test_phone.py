"""전화번호: 관리자가 회원 전화번호를 등록하고, 회원 목록에서 눌러 바로 건다. 번호는 하이픈을 넣어 정리한다."""


def _set(club, name, phone, as_=None):
    return club.c.put(f"/admin/users/{club.ids[name]}/phone", json={"phone": phone}, headers=club.h(as_))


def test_admin_sets_member_phone(club):
    club.add_members("kim", "off", "gst")
    club.set_type("off", "officer")
    club.set_type("gst", "guest")

    # 관리자만 (임원진도 안 된다)
    assert _set(club, "kim", "01012345678", "off").status_code == 403
    r = _set(club, "kim", " 010 1234 5678 ")
    assert (r.status_code, r.json()["phone"]) == (200, "010-1234-5678")
    # 회원 목록에서 보인다 (게스트는 회원 목록을 볼 수 없다)
    rows = club.c.get("/users", headers=club.h("off")).json()
    assert next(u["phone"] for u in rows if u["username"] == "kim") == "010-1234-5678"
    assert club.c.get("/users", headers=club.h("gst")).status_code == 403

    # 숫자가 아니거나 자릿수가 맞지 않으면 안내
    r = _set(club, "kim", "공일공-1234")
    assert r.status_code == 422 and "숫자" in r.json()["detail"][0]["msg"]
    assert _set(club, "kim", "1234").status_code == 422
    # 지역번호·국제번호도 받는다, 비우면 지운다
    assert _set(club, "kim", "0212345678").json()["phone"] == "02-1234-5678"
    assert _set(club, "kim", "031-123-4567").json()["phone"] == "031-123-4567"
    assert _set(club, "kim", "+82 10-1234-5678").json()["phone"] == "+821012345678"
    assert _set(club, "kim", "  ").json()["phone"] is None


def test_only_admin_edits_phone_in_my_profile(club):
    """내 정보의 연락처는 관리자만 고친다. 회원은 관리자가 등록한 번호를 바꿀 수 없다."""
    club.add_members("kim", "off")
    club.set_type("off", "officer")
    _set(club, "kim", "01012345678")
    for name in ("kim", "off"):
        r = club.c.patch("/users/me", json={"phone": "010-9876-5432"}, headers=club.h(name))
        assert r.status_code == 403 and "관리자" in r.json()["detail"]
    assert club.c.patch("/users/me", json={"phone": None}, headers=club.h("kim")).status_code == 403
    # 같은 번호를 그대로 보내거나, 연락처 없이 저장하면 된다
    assert club.c.patch("/users/me", json={"phone": "010-1234-5678"}, headers=club.h("kim")).status_code == 200
    r = club.c.patch("/users/me", json={"bio": "안녕하세요"}, headers=club.h("kim"))
    assert (r.status_code, r.json()["phone"]) == (200, "010-1234-5678")

    # 관리자는 자기 연락처를 고친다 (같은 규칙으로 정리)
    r = club.c.patch("/users/me", json={"phone": "010.9876.5432"}, headers=club.admin)
    assert r.json()["phone"] == "010-9876-5432"
    assert club.c.patch("/users/me", json={"phone": "abc"}, headers=club.admin).status_code == 422
