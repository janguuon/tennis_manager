"""테스트 공통 설정: 임시 SQLite DB + 동호회(총무·회원·모임) 헬퍼."""
import os
import tempfile

# app 모듈이 import 될 때 DB 엔진이 만들어지므로, 그 전에 임시 DB 경로를 지정한다.
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

# 참석 마감(모임 3일 전)에 걸리지 않도록 먼 미래 날짜를 쓴다.
FAR_DATE = "2099-01-15"
FAR_MONTH = "2099-01"


class Club:
    """테스트용 동호회: 총무(첫 가입자 = 관리자) + 회원들."""

    def __init__(self, client: TestClient):
        self.c = client
        client.post("/auth/signup", json={"username": "admin1", "password": "1234", "name": "총무"})
        self.admin = self._login("admin1")
        self.headers: dict[str, dict] = {}
        self.ids: dict[str, int] = {}

    def _login(self, username: str) -> dict:
        r = self.c.post("/auth/login", data={"username": username, "password": "1234"})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    def add_members(self, *names: str) -> None:
        for n in names:
            self.c.post("/auth/signup", json={"username": n, "password": "1234", "name": n})
        for s in self.c.get("/admin/signups/pending", headers=self.admin).json():
            self.c.post(f"/admin/signups/{s['id']}/approve", headers=self.admin)
        for n in names:
            self.headers[n] = self._login(n)
            self.ids[n] = self.c.get("/users/me", headers=self.headers[n]).json()["id"]

    def gathering(self, fee: int, date: str = FAR_DATE, **extra) -> int:
        body = {"title": "모임", "event_date": date, "fee": fee, **extra}
        return self.c.post("/gatherings", json=body, headers=self.admin).json()["id"]

    def vote(self, gid: int, name: str, status: str = "attending"):
        return self.c.put(
            f"/gatherings/{gid}/attendance", json={"status": status}, headers=self.headers[name]
        )

    def pay(self, gid: int, name: str, paid: bool = True, as_: str | None = None):
        headers = self.headers[as_] if as_ else self.admin
        return self.c.put(
            f"/gatherings/{gid}/participants/{self.ids[name]}/payment",
            json={"paid": paid},
            headers=headers,
        )

    def detail(self, gid: int) -> dict:
        return self.c.get(f"/gatherings/{gid}", headers=self.admin).json()

    def summary(self, month: str = FAR_MONTH) -> dict:
        return self.c.get(f"/gatherings/payments/summary?month={month}", headers=self.admin).json()

    def my_dues(self, name: str) -> list[dict]:
        return self.c.get("/gatherings/payments/me", headers=self.headers[name]).json()


@pytest.fixture
def client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def club(client) -> Club:
    return Club(client)
