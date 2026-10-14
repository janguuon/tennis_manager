"""프로필 사진 올리기·지우기·보기."""
from io import BytesIO

from PIL import Image

from app import avatars


def _png(w=900, h=600, color=(220, 60, 40, 255)) -> bytes:
    buf = BytesIO()
    Image.new("RGBA", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def _upload(club, name, data, filename="me.png", ctype="image/png"):
    return club.c.post(
        "/users/me/avatar",
        files={"file": (filename, data, ctype)},
        headers=club.headers[name],
    )


def test_upload_makes_square_jpeg_and_replaces_old(club):
    club.add_members("amy")
    r = _upload(club, "amy", _png())
    assert r.status_code == 200
    url = r.json()["avatar_url"]
    assert url.startswith("/avatars/")

    # 로그인한 회원은 볼 수 있고, 정사각형 400px JPEG 다
    img = club.c.get(url, headers=club.admin)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert Image.open(BytesIO(img.content)).size == (avatars.AVATAR_SIZE, avatars.AVATAR_SIZE)
    # 로그인하지 않으면 볼 수 없다
    assert club.c.get(url).status_code == 401

    # 다시 올리면 주소가 바뀌고 예전 파일은 지워진다
    r2 = _upload(club, "amy", _png(300, 800))
    url2 = r2.json()["avatar_url"]
    assert url2 != url
    assert club.c.get(url, headers=club.admin).status_code == 404
    assert club.c.get(url2, headers=club.admin).status_code == 200


def test_avatar_shows_in_member_lists(club):
    club.add_members("amy", "ben")
    url = _upload(club, "amy", _png()).json()["avatar_url"]
    gid = club.gathering(fee=0)
    club.vote(gid, "amy")
    members = club.c.get("/users", headers=club.headers["ben"]).json()
    assert next(u for u in members if u["username"] == "amy")["avatar_url"] == url
    p = next(p for p in club.detail(gid)["participants"] if p["user"]["username"] == "amy")
    assert p["user"]["avatar_url"] == url


def test_delete_avatar(club):
    club.add_members("amy")
    url = _upload(club, "amy", _png()).json()["avatar_url"]
    r = club.c.delete("/users/me/avatar", headers=club.headers["amy"])
    assert r.status_code == 200 and r.json()["avatar_url"] is None
    assert club.c.get(url, headers=club.admin).status_code == 404


def test_rejects_non_images_and_bad_paths(club):
    club.add_members("amy")
    r = _upload(club, "amy", b"not an image", filename="x.txt", ctype="text/plain")
    assert r.status_code == 400 and "사진 파일" in r.json()["detail"]
    assert club.c.get("/avatars/..%2Fsecret.jpg", headers=club.admin).status_code == 404
    assert club.c.get("/avatars/whatever.png", headers=club.admin).status_code == 404


def test_profile_update_cannot_set_avatar_url(club):
    club.add_members("amy")
    r = club.c.patch("/users/me", json={"avatar_url": "https://evil.example/x.jpg"}, headers=club.headers["amy"])
    assert r.status_code == 200 and r.json()["avatar_url"] is None


def test_deleting_member_removes_photo(club):
    club.add_members("amy")
    url = _upload(club, "amy", _png()).json()["avatar_url"]
    amy = club.ids["amy"]
    r = club.c.delete(f"/admin/users/{amy}", headers=club.admin)
    assert r.json()["result"] == "deleted"
    assert avatars.file_for(url.removeprefix("/avatars/")) is None
