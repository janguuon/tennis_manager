# 🎾 팀 브레이커 (Team Breaker)

테니스 팀 매니지먼트 서비스 — 회원/전적/모임 관리.

## 구성

```
teambreaker_manager/
├── backend/    # FastAPI + SQLAlchemy + SQLite
└── frontend/   # Remix + TailwindCSS
```

## 실행 방법

### 1) 백엔드 (FastAPI) — Python 3.11+

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # SECRET_KEY 수정 권장
uvicorn app.main:app --reload
# http://127.0.0.1:8000/docs  (Swagger UI)
```

### 2) 프론트엔드 (Remix) — Node 20+

```powershell
cd frontend
npm install
copy .env.example .env   # API_URL, SESSION_SECRET 설정
npm run dev
# http://localhost:3000
```

> 백엔드를 먼저 띄운 뒤 프론트엔드를 실행하세요.

## 첫 사용 흐름

1. `/signup` 에서 **첫 가입자**로 신청 → 자동으로 **관리자 + 승인** 처리되어 바로 로그인 가능
2. 이후 가입자는 `pending` 상태 → 관리자가 `/app/admin` 에서 **승인**해야 로그인 가능
3. `/app/calendar` 에서 모임 등록 → 참석 투표 → 대진 생성(랜덤/실력) → 결과 입력
4. 결과 입력 시 자동으로 전적에 반영 → `/app/ranking`, `/app/members/{id}` 에서 확인

## 기능 현황

| 영역 | 상태 |
|------|------|
| 회원가입/로그인 (승인제) | ✅ |
| 프로필 / 회원 목록 | ✅ |
| 전적 입력 / 통계 (개인·페어·상대·랭킹) | ✅ |
| 모임/캘린더 + 참석 투표 | ✅ |
| 대진 자동(랜덤·실력)/수동 + 결과→전적 반영 | ✅ |
| 프론트엔드 (로그인·캘린더·모임·랭킹·회원·관리자) | ✅ |
