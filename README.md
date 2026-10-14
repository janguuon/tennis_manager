# 🎾 오테식 매니저

테니스 팀 **오테식**(오순도순 테니스 식구) 매니지먼트 서비스 — 회원/전적/모임/회비 관리.

## 구성

```
tennis_manager/
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

### 3) 테스트

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest            # 회비 정산 등 백엔드 테스트 (임시 DB 사용)

cd ../frontend
npm run typecheck           # 타입 검사
```

## 첫 사용 흐름

1. `/signup` 에서 **첫 가입자**로 신청 → 자동으로 **관리자 + 승인** 처리되어 바로 로그인 가능
2. 이후 가입자는 `pending` 상태 → 관리자가 `/app/admin` 에서 **승인**해야 로그인 가능
3. `/app/calendar` 에서 모임 등록 → 참석 투표 → 대진 생성(남복·여복·혼복 자동 구성, 모임 시간 기준 라운드) → 결과 입력
4. 결과 입력 시 자동으로 전적에 반영 → 관리자가 `/app/members/{id}` 에서 확인 (승률·전적은 당분간 관리자만, 랭킹 화면은 숨김: `frontend/app/lib/features.ts`)

## 기능 현황

| 영역 | 상태 |
|------|------|
| 회원가입/로그인 (승인제) | ✅ |
| 프로필 / 회원 목록 | ✅ |
| 전적 입력 / 통계 (개인·페어·상대·랭킹 — 당분간 관리자만 열람, 랭킹 화면은 숨김) | ✅ |
| 모임/캘린더 + 참석 투표 (참석·불참, 정원이 차면 대기 → 자리가 나면 순서대로 자동 참석) | ✅ |
| 대진 자동(남복·여복·혼복 우선·잡복은 불가피할 때만, 모임 시간 기준 라운드, 게임 수 공평, 다양하게·실력 밸런스)/수동 + 결과→전적 반영 | ✅ |
| 대진 직접 바꾸기 (참석자·운영진이 현장에서 자리 맞바꾸기·쉬던 사람 넣기) | ✅ |
| 내부 티어 A~E (오테식 모임 대진 결과로 계산하는 레이팅, 관리자 전용) | ✅ |
| 회비 정산 (총액 1/n, 입금·차액·환불, 내가 낼 참가비) | ✅ |
| 모임 종류별 정산 (오테식 정모·벙개 = 회비 지출·코트비 지급 / 일반 벙개 = 코트비+캔볼값 n빵) | ✅ |
| 오테식 모임 게스트비 · 코트 예약자별 코트비 지급 · 환급 계좌 | ✅ |
| 카카오톡 공유 (모임 요약·미입금 안내) | ✅ |
| 엑셀 일정 자동 등록 (코트 예약 시트: 필수 칸 확인, 같은 모임 묶기, 이미 등록된 일정 건너뛰기, 코트요정, 오테식 모임 정원 코트 수 × 6명) | ✅ |
| 클럽 회칙 (정식 v1.0, 2026.10.14 시행 · 열람·복사·인쇄) | ✅ |
| 프론트엔드 (로그인·캘린더·모임·랭킹·회원·관리자·정산·마이페이지) | ✅ |

작업 이력과 설계 결정은 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) 참고.
