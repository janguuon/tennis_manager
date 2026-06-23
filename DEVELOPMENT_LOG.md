# 🎾 팀 브레이커(Team Breaker) 개발 기록

테니스 팀 매니지먼트 웹 서비스 — 회원 / 전적 / 모임 관리.
이 문서는 지금까지 진행한 설계·구현·트러블슈팅 전체 내역을 정리한 것이다.

---

## 1. 기술 스택

| 영역 | 스택 |
|------|------|
| Frontend | Remix (React) + TailwindCSS |
| Backend | FastAPI (Python) |
| Database | SQLite + SQLAlchemy 2.0 (ORM) |
| 인증 | JWT (python-jose) + bcrypt 해싱 |

## 2. 프로젝트 구조

```
teambreaker_manager/
├── README.md                 # 실행 가이드
├── DEVELOPMENT_LOG.md         # (이 문서)
│
├── backend/                   # FastAPI
│   ├── requirements.txt
│   ├── .env.example
│   ├── seed.py                # 데모 시드 데이터 생성 스크립트
│   └── app/
│       ├── main.py            # 앱 진입점 + 라우터 등록 + CORS
│       ├── database.py        # 엔진/세션/Base, get_db
│       ├── models.py          # 전체 DB 스키마(ORM)
│       ├── schemas.py         # Pydantic 입출력 스키마
│       ├── config.py          # 설정(SECRET_KEY 등)
│       ├── security.py        # 비밀번호 해싱 + JWT
│       ├── deps.py            # get_current_user / get_current_admin
│       ├── stats.py           # 전적 집계 로직(순수 함수)
│       ├── matchmaking.py     # 자동 대진 생성 로직
│       └── routers/
│           ├── auth.py        # 가입/로그인
│           ├── users.py       # 프로필/회원목록
│           ├── admin.py       # 가입 승인 관리
│           ├── matches.py     # 전적 입력/조회
│           ├── stats.py       # 전적 통계/랭킹
│           ├── gatherings.py  # 모임/캘린더/참석투표
│           └── draws.py       # 대진 생성/편집/결과
│
└── frontend/                  # Remix
    ├── package.json, vite.config.ts, tailwind.config.ts, tsconfig.json
    ├── .env.example
    └── app/
        ├── root.tsx
        ├── tailwind.css       # 디자인 시스템(코트 그린)
        ├── lib/
        │   ├── types.ts           # 백엔드 응답 타입
        │   ├── session.server.ts  # JWT httpOnly 쿠키 세션
        │   └── api.server.ts      # 백엔드 호출 래퍼
        └── routes/
            ├── _index.tsx              # 토큰 유무로 분기
            ├── login.tsx / signup.tsx / logout.tsx
            ├── app.tsx                 # 인증 레이아웃(내비)
            ├── app._index.tsx          # → /app/calendar
            ├── app.calendar.tsx        # 캘린더 + 모임 생성
            ├── app.gatherings.$id.tsx  # 모임 상세(참석/대진/결과)
            ├── app.ranking.tsx         # 팀 랭킹
            ├── app.members._index.tsx  # 회원 목록
            ├── app.members.$id.tsx     # 개인 전적
            └── app.admin.tsx           # 가입 승인
```

---

## 3. 단계별 작업 내역

### Step 1 — DB 모델링 & FastAPI 초기 세팅

**설계한 테이블**

| 테이블 | 역할 |
|--------|------|
| `users` | 회원 (아이디/비번, 이름·성별·NTRP·프로필) |
| `matches` | 경기 1건의 메타(유형/날짜/장소/점수/승팀) |
| `match_players` | 경기↔회원 연결(`team` 1/2) — **페어·상대 전적의 핵심** |
| `gatherings` | 모임(캘린더 날짜/시간/코트 면수) |
| `participants` | 모임 참여자 + 참석/불참/미정 투표 |
| `draws` / `draw_matches` | 모임 참여자 기반 대진표(자동/수동) |

**핵심 설계 결정**
1. **`MatchPlayer` 연결 테이블 분리** — 각 행에 `team`(1/2)을 기록해서 단식(2명)/복식(4명)을 한 구조로 표현. 같은 팀=페어, 반대 팀=상대 → 페어/상대 전적을 self-join으로 계산.
2. **랭킹·승률은 저장하지 않고 실시간 집계(derived)** — `matches`/`match_players`만이 단일 진실 공급원. 집계 규칙을 바꿔도 마이그레이션 불필요.
3. **`Draw`(예정 대진)와 `Match`(실제 결과)를 분리** — `draw_matches.result_match_id`로 연결.

### Step 2 — 회원가입/로그인(인증)

- **로그인 ID는 `username`(원하는 아이디)**, 이메일은 선택 항목.
- **가입 승인제**: 가입 시 `pending` → 관리자가 승인해야 로그인 가능. `approval_status`(pending/approved/rejected).
- **최초 가입자 = 자동 관리자 + 승인** (닭-달걀 문제 해결, 부트스트랩).
- JWT 발급/검증, `get_current_user` / `get_current_admin` 의존성.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/signup` | 가입 신청 |
| POST | `/auth/login` | 로그인 → JWT |
| GET/PATCH | `/users/me` | 내 프로필 조회/수정 |
| GET | `/users`, `/users/{id}` | 회원 목록/단건 |
| GET | `/admin/signups/pending` | 승인 대기 목록 |
| POST | `/admin/signups/{id}/approve`·`/reject` | 승인/거절 |
| POST | `/admin/users/{id}/set-admin` | 관리자 권한 부여/회수 |

### Step 3 — 전적 관리

- 경기 입력 시 단식=각 팀 1명, 복식=각 팀 2명 검증(Pydantic `model_validator`).
- 승팀 미지정 시 점수로 자동 판정(동점=무승부).
- 통계는 `stats.py`에서 실시간 집계. 승률은 **승부 난 경기(승+패) 기준**.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST/GET | `/matches` | 경기 입력 / 히스토리(필터: 회원·모임·유형·기간) |
| PATCH/DELETE | `/matches/{id}` | 수정/삭제(기록자·관리자) |
| GET | `/stats/users/{id}` | 개인 종합 + 단식/남복/여복/혼복별 승률 |
| GET | `/stats/users/{id}/partners` | 페어(파트너) 전적 |
| GET | `/stats/users/{id}/opponents` | 상대 전적 |
| GET | `/stats/ranking` | 팀 랭킹(승률→승수) |

### Step 4 — 모임 / 캘린더

- **코트 면수(`court_count`)**가 자동 대진에서 **한 라운드 동시 진행 매치 수**로 사용됨. 초과분은 다음 라운드로.
- 자동 대진 2모드: `random`(무작위) / `skill`(NTRP 균형 — 복식은 최강+최약 vs 중간 둘).
- 참석(ATTENDING) 인원만 대진 대상.
- **대진 결과 입력 → Match 생성 → 전적 반영** (`result_match_id`로 추적).

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST/GET | `/gatherings` | 모임 생성 / 캘린더 조회(기간) |
| GET/PATCH/DELETE | `/gatherings/{id}` | 상세/수정/삭제 |
| PUT/DELETE | `/gatherings/{id}/attendance` | 참석 투표/취소 |
| POST | `/gatherings/{id}/draws/generate` | 자동 대진 생성 |
| POST | `/gatherings/{id}/draws` | 빈 수동 대진표 |
| PATCH/DELETE | `/draw-matches/{id}` | 대진 수동 편집/삭제 |
| POST | `/draw-matches/{id}/result` | 결과 입력 → 전적 반영 |

### Step 5 — 프론트엔드(Remix)

**아키텍처 결정**: JWT를 **httpOnly 세션 쿠키**에 저장하고, 모든 백엔드 호출을 **Remix 로더/액션(서버 사이드)**에서 수행.
→ ① 토큰이 브라우저 JS에 노출 안 됨(XSS 방어) ② 서버-서버 호출이라 CORS 불필요.

**구현 화면**: 로그인 / 가입 / 로그아웃 / 공통 레이아웃(내비+현재 유저) / 캘린더(월 이동·모임 생성) / 모임 상세(참석투표·대진 생성·점수 입력) / 랭킹 / 회원 목록 / 개인 전적 / 관리자(가입 승인).

전체 흐름이 화면으로 연결됨:
`로그인 → 모임 생성 → 참석 투표 → 대진 생성(랜덤/실력) → 점수 입력 → 전적·랭킹 반영`

---

## 4. 실행 방법

### 백엔드 (Python 3.12~3.13 권장)
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs
```

### 프론트엔드 (Node 20+)
```powershell
cd frontend
copy .env.example .env
npm install
npm run dev                         # http://localhost:3000
```

> 백엔드를 먼저 띄운 뒤 프론트엔드를 실행한다.

### 데모 데이터 채우기 (선택)
```powershell
cd backend
python seed.py        # 회원 9명 + 경기 18건 + 모임/대진 생성
```
- 데모 회원 비밀번호: 전원 `test1234`
- 초기화: `backend/tennismanager.db` 삭제 후 백엔드 재시작 → `python seed.py` 재실행

---

## 5. 트러블슈팅 기록

### ① Python 3.14 — pydantic-core 빌드 실패
- **증상**: `pip install` 중 `error: the configured Python interpreter version (3.14) is newer than PyO3's maximum supported version (3.13)` → `Failed building wheel for pydantic-core`.
- **원인**: Python 3.14가 너무 최신이라, 구버전 핀(`pydantic==2.10.4`)에는 3.14용 미리 빌드된 wheel이 없어 Rust 소스 빌드를 시도하다 실패.
- **해결**: `requirements.txt`의 정확한 핀을 하한선(`>=`)으로 풀어 pip이 최신 호환 wheel을 받도록 함. (Python 3.13 사용도 안전한 대안)

### ② 가입 신청 500 에러 — passlib × bcrypt 비호환
- **증상**: 가입 시 프론트에 "가입 신청에 실패했습니다." (백엔드는 500 + 빈 응답).
- **진단**: 프론트 메시지가 **일반 문구**라는 건 백엔드 응답을 못 받았다는 신호 → 백엔드 직접 호출로 **500 확인** → 해싱 코드 단독 실행으로 예외 재현.
- **원인**: `passlib 1.7.4`가 `bcrypt 5.0.0`과 비호환. bcrypt 백엔드 로드 중 `module 'bcrypt' has no attribute '__about__'` → 내부 자체 점검에서 `ValueError: password cannot be longer than 72 bytes` 발생.
- **해결**: `passlib`를 제거하고 **`bcrypt`를 직접 사용**하도록 `security.py` 수정. `requirements.txt`에서도 `passlib[bcrypt]` → `bcrypt`로 교체.
- **검증**: 수정 후 가입·로그인 정상 동작 확인 완료.

```python
# security.py (수정 후)
import bcrypt

def hash_password(plain_password: str) -> str:
    pw_bytes = plain_password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pw_bytes = plain_password.encode("utf-8")[:72]
    try:
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except ValueError:
        return False
```

### ③ Windows 한글 콘솔(cp949) — 이모지 출력 에러
- **증상**: `seed.py` 실행 시 데이터는 생성됐으나 마지막 `print("✅ …")`에서 `UnicodeEncodeError: 'cp949' codec can't encode character '✅'`.
- **원인**: Windows 기본 콘솔 인코딩(cp949)이 이모지(유니코드)를 표현하지 못함. (데이터 저장은 그 전에 모두 커밋되어 정상)
- **해결**: 스크립트 상단에서 `sys.stdout.reconfigure(encoding="utf-8")` 적용.

### ④ 라이트 모드인데 다크 스타일이 적용됨
- **증상**: 토글은 라이트(🌙)인데 화면(달력·헤더 등)이 어둡게 표시됨.
- **원인**: `tailwind.config.ts`의 `darkMode: "class"` 변경이 **dev 서버에 반영되지 않음**. Tailwind 기본값은 `darkMode: "media"`라 **OS 다크모드 설정**이 그대로 `dark:` 스타일을 켜버림.
- **해결**: `tailwind.config.ts` 변경은 HMR로 자동 반영되지 않으므로 **dev 서버 재시작 필요**. 확실히 하려면 `node_modules/.vite` 캐시 삭제 후 재시작.

---

## 6. UI/UX 개선 (반복 작업)

초기 화면 구축 이후 사용자 피드백을 반영해 다듬은 내용.

### 브랜딩
- 화면 전체의 "팀 브레이커" → **"테니스 매니저"**로 변경 (헤더 로고, 모든 페이지 탭 제목).

### 캘린더 (코트 일정)
- 아젠다 리스트 → **월(月) 달력 그리드**로 교체. 날짜 칸에 모임 칩 표시, 빈 칸 클릭 시 그 날짜로 모임 등록 모달.
- 모임 등록 시 **종료 시간** 입력 추가.
- 시간 입력을 **드롭다운(06:00~22:00, 정시 단위)**으로 제한 (네이티브 input의 분 단위 타이핑 방지).
- **시작 시간 선택 시 종료 시간 자동 +2시간** 설정 (사용자가 종료를 직접 바꾸면 자동 변경 중단).
- **코트 번호 등록** (쉼표 구분, 예: `3, 5`) → 면수 자동 계산. 대진표의 코트 순번을 실제 번호로 표시.
- **최대 참석 인원** 설정 + 정원 초과 시 참석 투표 차단(백엔드 `409`).
- **보던 달 유지**: 보던 달은 URL(`?month=`)에 저장되어 브라우저 뒤로가기 시 유지됨. 추가로 모임 칩이 현재 달을 `?from=`으로 넘기고, 상세의 "← 캘린더"/삭제 후 이동도 그 달(없으면 모임의 달)로 복귀하도록 처리.

### 모임 상세
- **수정/삭제 기능** 추가 (주최자·관리자만). 수정은 모달에서 전 필드 편집(상태 포함), 삭제는 확인 후 `DELETE` → 캘린더 이동.

### 참석 변경 마감 규칙
- **모임 시작 3일 전부터** 일반 회원은 **불참/미정으로 변경(및 참석 취소) 불가**. 참석 유지/참석으로 전환은 가능.
- 잠금 기간에는 **관리자만** 변경 가능.
- 백엔드 `gatherings.py` `_attendance_locked()`(상수 `ATTENDANCE_LOCK_DAYS=3`)로 `vote_attendance`/`cancel_attendance`에서 403 처리.
- 프론트는 모임 상세에서 불참/미정 버튼 비활성화 + 안내 문구.

### 엑셀(.xlsx) 일괄 업로드
- 캘린더 "📤 엑셀 업로드" → **양식 다운로드 → 작성 → 업로드**로 모임 일괄 등록.
- **한 행 = 한 모임**, 모든 회원 가능, **정상 행만 등록 + 오류 행 보고**(부분 성공).
- 컬럼(한국어 헤더, 순서 무관): 날짜·제목(필수) / 시작시간·종료시간·장소·코트번호·최대인원·설명.
- 백엔드 `openpyxl`로 파싱, `GatheringCreate` 검증 + `_normalize_courts()` 재사용.
- 관련: `backend` `POST /gatherings/import`·`GET /gatherings/import/template`,
  `frontend` `lib/api.server.ts`(multipart/`apiRaw`) + `resources.gatherings-import.tsx`·`resources.gatherings-template.tsx`.

### 다크 모드
- **테마 토글**(헤더 🌙/☀️) 추가. 테마는 **쿠키 저장 → 서버에서 `<html>`에 class 적용**(새로고침 깜빡임 없음).
- 색상: 배경 `slate-900` / 카드 `slate-800` / 테두리 `slate-700` / 텍스트 `slate-100`, 강조색(court green) 유지.
- 관련 파일: `tailwind.config.ts`(`darkMode:"class"`), `lib/theme.server.ts`, `routes/resources.theme.tsx`, `root.tsx`.

---

## 7. 기능 현황

| 영역 | 상태 |
|------|------|
| 회원가입/로그인 (승인제, 최초가입자 자동관리자) | ✅ |
| 프로필 / 회원 목록 | ✅ |
| 전적 입력 / 통계(개인·페어·상대·랭킹) | ✅ |
| 모임/캘린더 + 참석 투표 | ✅ |
| 대진 자동(랜덤·실력)/수동 + 결과→전적 반영 | ✅ |
| 프론트엔드 전 화면 | ✅ |
| 캘린더 월 그리드 + 모임 등록/수정/삭제 | ✅ |
| 코트 번호·정원·시간 드롭다운·종료시간 자동설정 | ✅ |
| 다크 모드 (쿠키 기반 토글) | ✅ |
| 데모 시드 데이터 스크립트 | ✅ (`seed.py` 실행 확인) |
| 실제 구동 검증 | ✅ 가입·로그인 동작 / 백엔드·프론트 구동 / 시드 데이터 주입 완료 |

## 8. 배포

- AWS Lightsail 배포 가이드와 설정 파일을 `deploy/` 에 작성.
  - `deploy/DEPLOY.md` — 단계별 배포 가이드(인스턴스 생성 → 서비스 등록 → Nginx → HTTPS → 백업, **12절: 다른 프로젝트와 한 서버 공존**)
  - `deploy/tennismanager-backend.service`, `deploy/tennismanager-frontend.service` — systemd 유닛
  - `deploy/nginx-tennismanager.conf` — Nginx 리버스 프록시
- 구조: `Nginx(80/443) → Remix(5555) →(내부)→ FastAPI(5005)`. 백엔드는 외부 미노출. (로컬 개발은 3000/8000)
  - **포트 5005/5555 선택 이유**: 같은 서버에 다른 백엔드 프로젝트가 돌고 있어 충돌 회피용. 내부 전용이라 방화벽엔 80/443만 연다.
- 배포 서버는 **더미 데이터 없이** 시작(`seed.py` 미실행, DB는 `.gitignore`).
- ⚠️ 운영 모드 쿠키는 `Secure` → **HTTPS 필수**(미적용 시 로그인 세션 유지 안 됨).

### 배포 환경 (확정)
- 운영 서버: AWS Lightsail (서울 리전), 같은 인스턴스에 다른 프로젝트들과 공존.
- 공인 IP: **`13.125.173.69`** (Static IP 연결 필요 — 바뀌면 주소·인증서 깨짐).

### 서버가 Docker 기반임이 확인됨 → 배포 방식 전환
- `sudo ss -tlnp` 결과 **80/443/8000/8001을 `docker-proxy`가 점유**. `docker ps`로 확인:
  - **`nginx_proxy`(nginx:latest)** 컨테이너가 80/443을 잡는 **공용 리버스 프록시**.
  - **`duckdns`** 컨테이너로 이미 DuckDNS 도메인 운영 중.
  - usuniverse-frontend/backend, pathfinder 등 다른 프로젝트도 전부 컨테이너.
- 따라서 **호스트 nginx 설치 불가**(80 점유 충돌) → **systemd 방식 폐기**, 테니스 매니저도 **Docker로 패키징**해 기존 `nginx_proxy`에 연동하기로 결정.

### Docker 패키징 (구성)
- 추가 파일: `backend/Dockerfile`, `frontend/Dockerfile`(멀티스테이지), 각 `.dockerignore`,
  루트 `docker-compose.yml`, `.env.docker.example`, 루트 `.gitignore`(.env 제외).
- `app/database.py`가 `DATABASE_URL` 환경변수 지원 → 컨테이너에서 볼륨(`tennis-data:/app/data`)에 SQLite 영속.
- 구조: `tennis-backend`(5005, 내부) + `tennis-frontend`(5555, 호스트 공개). 프론트→백엔드는 compose 네트워크(`http://tennis-backend:5005`).
- 실행: 루트에 `.env`(SECRET_KEY/SESSION_SECRET) 생성 후 `docker compose up -d --build`.
- **남은 단계**: 기존 `nginx_proxy`에 서버 블록 추가(호스트 5555로 proxy_pass) + DuckDNS 서브도메인 + HTTPS 인증서. (nginx_proxy 마운트 경로/인증서 방식 확인 후 진행)

## 9. 남은 작업(후보)

- 프로필 수정 화면, 친선경기 직접 입력 UI
- 대진 수동 편집 UI(드래그/선수 교체)
- (운영 시) Alembic 마이그레이션 도입
