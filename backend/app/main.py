"""
Team Breaker 매니지먼트 API — FastAPI 진입점 (Step 1 초기 세팅).

- 앱 시작 시 SQLite 테이블을 생성한다 (개발용; 운영 시 Alembic 마이그레이션 권장).
- Remix 프론트엔드와의 통신을 위해 CORS를 허용한다.
- /health, / 기본 엔드포인트만 우선 제공. (회원/전적/모임 라우터는 이후 Step에서 추가)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (모델 등록을 위해 import 필요)
from .database import Base, engine, run_lightweight_migrations
from .routers import admin, auth, draws, gatherings, matches, stats, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: 테이블 생성 + 기존 DB 컬럼 보강(경량 마이그레이션)
    Base.metadata.create_all(bind=engine)
    run_lightweight_migrations()
    yield
    # 종료 시 정리 로직이 필요하면 여기에 추가


app = FastAPI(
    title="Team Breaker API",
    description="테니스 팀 '팀 브레이커' 회원/전적/모임 관리 서비스",
    version="0.1.0",
    lifespan=lifespan,
)

# Remix 개발 서버(기본 3000 포트) 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 라우터 등록
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(matches.router)
app.include_router(stats.router)
app.include_router(gatherings.router)
app.include_router(draws.router)


@app.get("/")
def root():
    return {"service": "Team Breaker API", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
