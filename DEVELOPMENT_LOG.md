# 🎾 오테식 매니저 개발 기록

테니스 팀 **오테식**(오순도순 테니스 식구) 매니지먼트 웹 서비스 — 회원 / 전적 / 모임 / 회비 관리.
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
tennis_manager/
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

### ⑤ nginx.conf 수정이 컨테이너에 반영 안 됨 (단일 파일 bind-mount inode 문제)
- **증상**: 호스트의 `nginx.conf`에 sslip.io 블록을 추가하고 `nginx -t`/`reload`가 "성공"인데도 실제로는 적용 안 됨. `docker exec nginx_proxy nginx -T | grep sslip` 결과가 비어 있음(=컨테이너는 옛 설정을 봄).
- **원인**: **단일 파일**을 bind-mount한 경우, 편집기(vim/nano)나 `sed -i`로 저장하면 파일이 **새 inode로 교체**되어 컨테이너는 마운트 시점의 옛 inode를 계속 참조. → 컨테이너 안 nginx는 옛 파일 기준으로 -t/reload "성공".
- **해결**: **`docker restart nginx_proxy`**로 마운트를 다시 해석시켜 새 파일을 읽게 함. 단, 재시작 전 인증서가 실제 존재해야 함(443 블록이 없는 cert를 참조하면 nginx 起動 실패 → 전체 다운). 재시작 전 임시 컨테이너로 안전 검증 권장:
  `docker run --rm -v .../nginx.conf:/etc/nginx/nginx.conf:ro -v .../certbot/conf:/etc/letsencrypt:ro nginx:latest nginx -t`
- **검증**: 재시작 후 `docker exec nginx_proxy grep -c sslip /etc/nginx/nginx.conf` > 0.

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
- 따라서 **호스트 nginx 설치 불가**(80 점유 충돌) → **systemd 방식 폐기**, 오테식 매니저도 **Docker로 패키징**해 기존 `nginx_proxy`에 연동하기로 결정.

### Docker 패키징 (구성)
- 추가 파일: `backend/Dockerfile`, `frontend/Dockerfile`(멀티스테이지), 각 `.dockerignore`,
  루트 `docker-compose.yml`, `.env.docker.example`, 루트 `.gitignore`(.env 제외).
- `app/database.py`가 `DATABASE_URL` 환경변수 지원 → 컨테이너에서 볼륨(`tennis-data:/app/data`)에 SQLite 영속.
- 구조: `tennis-backend`(5005, 내부) + `tennis-frontend`(5555, 호스트 공개). 프론트→백엔드는 compose 네트워크(`http://tennis-backend:5005`).
- 실행: 루트에 `.env`(SECRET_KEY/SESSION_SECRET) 생성 후 `docker compose up -d --build`.
- **도메인 정책**: DuckDNS는 쓰지 않음(그 컨테이너는 다른 프로젝트용). 오테식 매니저는 **sslip.io**(`13.125.173.69.sslip.io`)로 IP 기반 접속/HTTPS.

### 기존 nginx_proxy(UsUniverse) 연동 — 실제 적용
- 공용 프록시: `nginx_proxy`(nginx:latest), 네트워크 **`usuniverse_app-network`**, 설정 단일 파일 `/home/ubuntu/UsUniverse/nginx/nginx.conf`(컨테이너에 bind-mount), 인증서 `certbot/certbot` 컨테이너(webroot `/var/www/certbot`, 저장 `/home/ubuntu/UsUniverse/certbot/conf`).
- 기존 프록시는 **컨테이너 이름으로 proxy_pass**(`http://frontend:3000`, `resolver 127.0.0.11`) → 테니스도 같은 네트워크에 연결해 **`tennis-frontend:5555`로 프록시**.
- 적용 절차:
  1. `docker network connect usuniverse_app-network tennis-frontend tennis-backend` (compose에도 external 네트워크로 반영).
  2. `nginx.conf`에 테니스용 **80 블록(ACME+리다이렉트)** + **443 블록(sslip.io → tennis-frontend:5555)** 추가(기존 블록과 나란히).
  3. certbot webroot로 `13.125.173.69.sslip.io` 인증서 발급.
  4. `docker restart nginx_proxy`로 반영.
- 우리 앱은 브라우저가 백엔드를 직접 호출하지 않으므로 `/api/` 블록 불필요 — `location /` 하나면 됨.

## 9. 남은 작업(후보)

- 프로필 수정 화면, 친선경기 직접 입력 UI
- 대진 수동 편집 UI(드래그/선수 교체)
- (운영 시) Alembic 마이그레이션 도입

## 10. 추가 작업 로그 (2026-06-27)

### 커밋 메시지
```
feat : UI 리디자인 및 엑셀 참가비/계좌 등록, 리스트 뒤로가기 수정

- 엑셀 일괄 등록에 참가비·은행·계좌번호·예금주 컬럼 추가(양식/텍스트 서식 포함)
- 전체 UI 미니멀+컬러풀 리디자인(그라데이션 버튼·내비, 플로팅 카드, 컬러 통계/정산/랭킹)
- 캘린더 리스트 모드에서 상세 진입 후 뒤로가기 시 월 전체 리스트로 복귀하도록 수정
- 이모지 파비콘 추가로 /favicon.ico 404 제거
```

### 1) 엑셀 일괄 등록에 참가비·계좌 추가
- `backend/app/routers/gatherings.py`
  - `IMPORT_HEADER_MAP`에 `참가비→fee`, `은행→bank`, `계좌번호→account_number`, `예금주→account_holder` 추가.
  - `_cell_value`: 참가비는 `"5,000"`/`5000.0`도 정수로 변환, 계좌번호는 숫자 인식(`...0.0`) 시 정수 문자열로 보정.
  - 다운로드 양식(`import_template`)에 새 컬럼·예시 반영 + 계좌번호 열을 텍스트 서식(`@`)으로 지정.

### 2) UI 미니멀 + 컬러풀 리디자인
- `frontend/tailwind.config.ts` — court 팔레트 보강(300/950), `soft`/`soft-lg` 그림자, Pretendard 폰트 스택, fade-in 애니메이션.
- `frontend/app/tailwind.css` — 그라데이션 알약 버튼(`.btn-primary`), 테두리 최소화·큰 라운드 플로팅 카드(`.card`), 채움형 인풋, 컬러 메시 배경, `.icon-chip`/`.chip` 추가.
- `app/routes/app.tsx` — 헤더 반투명/블러, 브랜드 그라데이션, 활성 내비 그라데이션 알약(관리자=앰버), 페이지 페이드인.
- `login.tsx`/`signup.tsx` — 로고 배지 + 그라데이션 타이틀.
- `app.members.$id.tsx` — 종합 전적 컬러 블록(슬레이트/그린/로즈/스카이).
- `app.payments.tsx` — 월 합계 그라데이션 카드(걷힘=그린, 미납=앰버).
- `app.ranking.tsx` — 상위 3위 컬러 하이라이트 + 메달 확대.
- `app.members._index.tsx` — 그라데이션 아바타.

### 3) 캘린더 리스트 모드 뒤로가기 수정
- 증상: 리스트 모드에서 일정 상세 진입 후 "← 목록" 시 해당 **일자 페이지**(특정 일만)로 이동.
- 해결: 상세 진입 시 `from` 출처를 구분.
  - `list:YYYY-MM` → 캘린더 리스트 모드(월 전체)로 복귀.
  - `YYYY-MM-DD` → 일자 페이지, `YYYY-MM` → 달력 모드(기존 유지).
- 파일: `app.calendar.tsx`(리스트 카드가 `?from=list:{월}` 전달), `app.gatherings.$id.tsx`(뒤로가기/삭제 리다이렉트 분기).

### 4) 콘솔 노이즈 정리
- `app/root.tsx` — 🎾 이모지 파비콘(SVG data URI) 추가로 `/favicon.ico` 404 스택트레이스 제거.
- 참고: `tailwind.config.ts` 변경 시 dev 서버 재시작 필요(설정 HMR 불안정). `com.chrome.devtools.json` 404는 DevTools 자동 요청으로 무해.

### 검증
- 백엔드 임포트 OK, 엑셀 임포트 엔드투엔드(참가비 5,000·계좌 등록) 통과.
- 프론트 `typecheck` 0 에러, 프로덕션 `build` 통과.

## 11. 추가 작업 로그 (2026-07-03)

관련 커밋: `카톡방 공유 기능` → `카톡 공유 기능 추가` → `공유 메시지 수정` → `정산 시스템 변경`

### 1) 카카오톡 공유 기능
- 모임 상세에 **`💬 공유` 버튼** 추가. 카카오 JS SDK `Kakao.Share.sendDefault`(objectType: text)로 공유창을 띄워 **사용자가 오픈톡방을 선택**해 모임 요약을 전송.
- 오픈채팅 자동 전송 API는 없으므로 **사람이 눌러 톡방 선택 후 전송**하는 방식(정책상 한계). 발신자는 **누른 사람 본인 카카오 계정**.
- `app/root.tsx` — 카카오 SDK 스크립트 로드 + JS 키를 `window.ENV`로 클라이언트에 전달.
- `app/routes/app.gatherings.$id.tsx` — `KakaoShareButton` 컴포넌트.
- 키 주입: `frontend/.env`(개발) / 루트 `.env`(운영 Docker `env_file`)에 `KAKAO_JS_KEY`. `.env.example`·`.env.docker.example`에 문서화.
- 카카오 디벨로퍼스 설정: **플랫폼 키 > JavaScript SDK 도메인**에 `http://localhost:3000`·운영 도메인 등록 필요.

### 2) 개발환경 .env 로딩 + SDK URL 버그 수정
- `frontend/vite.config.ts` — **Remix+Vite dev 서버는 `.env`를 `process.env`로 자동 로드하지 않음** → `loadEnv`로 읽어 `process.env`에 주입(기존 값은 유지해 운영 환경변수와 충돌 방지). 이로써 `KAKAO_JS_KEY`(및 `API_URL`/`SESSION_SECRET`)가 loader에서 읽힘.
- `app/root.tsx` — 카카오 SDK CDN 주소 오타 수정: `t1.kakao.com`(불가) → **`t1.kakaocdn.net`**(정상).
- 운영(Docker)은 `remix-serve`라 vite 트릭이 안 먹으므로 **컨테이너 실제 환경변수**(`env_file: .env`)로 키 주입 + `docker compose up -d --build --force-recreate` 필요.

### 3) 공유 메시지 개선 — URL · 참석자 · 코트
- 메시지에 **모임 URL**(`👉 모임 보기: <origin>/app/gatherings/{id}`) 포함 + 링크로 연결(클릭 시 상세 진입).
- **🟩 코트**(번호/면수), **👥 참석자 목록** 추가.
- 카카오 텍스트 **200자 제한** 대응: 참석자가 많으면 이름을 앞에서부터 채우고 나머지는 `외 N명`으로 자동 축약.

### 4) 캘린더 보기 방식(달력/리스트) 기억
- 마지막 선택을 **쿠키(`cal_view`, 1년)** 에 저장 → 재입장 시 유지.
- `app/routes/app.calendar.tsx` — loader가 쿠키를 읽어 기본값 결정(우선순위: URL `?view` → 쿠키 → 달력). SSR이라 깜빡임 없음. 토글 시 `document.cookie`로 저장.

### 5) 참가비 정산: 총액 → 참석자 1/n
- `fee` 필드 의미를 **1인 금액 → 총 참가비(총액)** 로 변경(컬럼/마이그레이션 변경 없음).
- 정산 계산: `1인당 = round(총액 ÷ 참석자 수)`, 걷힘 = `1인당 × 납부자`, 받을 금액 = `1인당 × 참석자`. 정산 응답에 `per_person` 추가.
- UI: 생성/수정 폼 라벨 `총 참가비`, 상세 정산 섹션 `총 X ÷ 참석 N = 1인 Y` 표시, 정산 페이지 `총·1인·참석` 표기, 공유 메시지 `참가비 총 X (1인 Y)`.
- 파일: `backend/app/schemas.py`, `backend/app/routers/gatherings.py`, `frontend/app/lib/types.ts`, `app.calendar.tsx`, `app.gatherings.$id.tsx`, `app.payments.tsx`.
- ⚠️ 기존 모임의 `fee` 값은 이제 **총액으로 해석**됨 → 필요 시 재입력.

### 검증
- 백엔드 임포트 OK. 정산 1/n 스모크: 총 40,000 ÷ 참석 3명 = 1인 13,333원(반올림) 확인.
- 프론트 `typecheck` 0 에러, 프로덕션 `build` 통과.
- 엑셀/공유/정산 엔드투엔드 TestClient 스모크 통과.

> ⚠️ 이 절의 "반올림" 규칙은 12절 4)에서 **100원 단위 올림**으로 바뀌었다.

## 12. 추가 작업 로그 (2026-09-30)

관련 커밋: `관리자는 모임 참석 관련 수정` → `관리자 모임 참석 관련 없도록 수정` → `관리자 모임 참가 관련 수정` → `정산관련 텍스트 변경` → `로그인 후 원래 페이지로 복귀, 토큰 만료 시 리다이렉트 루프 수정` → (정산 시스템 점검·개선)

### 1) 관리자 참석 투표
- 관리자는 참석 투표를 하지 않는다: 모임 상세에서 **투표 버튼(참석/불참/미정)만 숨기고**, 참석 요약·참여자 명단은 그대로 보인다(섹션 제목 "참석 현황").
- 한때 카드 전체를 숨겼다가 "참가자는 볼 수 있어야 한다"는 요청으로 되돌렸다.
- 관리자는 투표하지 않으므로 참석 인원·1인 참가비 계산에서 빠진다.

### 2) 정산 용어
- "납부/미납" → **"입금/미입금"** (모임 상세 정산 섹션, 정산 페이지 전체).

### 3) 로그인 후 원래 페이지로 복귀
- 비로그인으로 접근하면 `/login?redirectTo=<보던 경로>`로 보내고, 로그인 성공 시 그 경로로 복귀(카톡 공유 링크를 비로그인 상태로 열어도 로그인 후 해당 모임으로 진입).
- `session.server.ts`
  - `getReturnPath` — GET은 요청 URL, 폼 전송(POST)은 Referer 페이지. single fetch 내부 쿼리(`_routes`, `index`)와 `/resources/*`는 제외.
  - `safeRedirect` — 내부 경로(`/...`)만 허용해 `//evil.com` 같은 오픈 리다이렉트 차단.
- **버그 수정: 토큰 무효 시 무한 리다이렉트.** `app.tsx`가 401이면 `GET /logout`으로 보냈는데, GET `/logout`은 세션 쿠키를 지우지 않아 `/login`(토큰 있음 → `/app`) ↔ `/app`(401 → `/logout`)을 반복할 수 있었다. 이제 401이면 세션을 지우고 로그인 화면으로 한 번만 이동한다.
- 검증: 빌드된 서버로 8가지 경우(복귀, 오픈 리다이렉트 차단, 이미 로그인, single fetch, 폼 전송, 백엔드 `SECRET_KEY` 변경 후 루프 없음) 확인.

### 4) 정산 시스템 점검 · 개선
**점검으로 재현한 문제 (수정 전 코드)**

| # | 문제 | 수정 |
|---|---|---|
| ① | 무료 모임(참가비 0원) 참석자가 정산 페이지에 전원 "미입금"으로 표시 | 참가비가 있는 모임만 정산 대상 |
| ② | 1인 금액 반올림이 백엔드(Python `round`, 22,500)와 화면(JS `Math.round`, 22,501)에서 다름 | 서버 한 곳에서만 계산, **100원 단위 올림** |
| ③ | 입금 후 참석자가 늘면 걷힌 돈이 실제(10,000원)가 아니라 새 1인 금액(8,000원)으로 표시 | **입금 당시 금액(`paid_amount`) 기록**, 걷힌 돈 = 실제 입금액 합 |
| ④ | 입금 후 불참으로 바꾸면 입금 기록이 화면에서 사라짐 | "돌려줄 참가비"로 표시 + 환불 완료 처리 |
| ⑤ | 불참자도 입금 처리 가능 | 참석자만 입금 처리(미입금 처리는 누구나) |
| ⑥ | 모임 상세에서 참석 투표 오류(정원 초과·마감)가 화면에 안 뜸(오류 표시가 수정 모달 안에만 있었음) | 모달 밖 오류 알림 추가 |

**계산 규칙 (backend/app/routers/gatherings.py)**
- 1인 금액 `per_person_fee(fee, n)` = 총액 ÷ 참석 인원을 **100원 단위 올림**(`PER_PERSON_UNIT`). 예: 40,000원 ÷ 3명 = 13,400원. 취소된 모임은 0.
- 사람별 정산 `_payment_breakdown`: 참석자가 1인 금액보다 덜 냈으면 **받을 돈(dues)**, 더 냈으면 **돌려줄 돈(refunds)**, 입금 후 불참이면 낸 금액 전부 돌려줄 돈. 금액 기록이 없는 예전 입금은 현재 1인 금액을 낸 것으로 본다.
- 입금 처리(`PUT .../payment`, paid=true)는 그때의 1인 금액을 기록. 이미 입금한 사람에게 다시 보내면 **차액 정산 완료**(현재 1인 금액으로 갱신).

**API**
- 모임 목록/상세에 `per_person`, 상세에 `payment`(정산 요약) 추가 — 화면은 금액을 직접 계산하지 않는다.
- 월별 정산 응답: `dues`/`refunds`(사람별 금액), `outstanding`, `total_outstanding`, `total_refund`.
- 신규 `GET /gatherings/payments/me` — 내가 낼 참가비(미입금·추가 입금) + 입금 계좌.
- DB: `participants.paid_amount` 추가(경량 마이그레이션).

**화면**
- 모임 상세 정산 섹션
  - 회원: **"내 참가비"**(낼 금액/입금 완료/추가 입금/환불 예정) + 계좌 복사.
  - 총무: 사람별 차액 안내 + **"차액 정산"** 버튼, **"돌려줄 참가비"** 목록 + "환불 완료", **"미입금 안내 카톡으로 보내기"**(미입금자 이름·1인 금액·계좌·링크).
- 정산 페이지: 맨 위 **"내가 낼 참가비"**(달과 상관없이 전체, 합계·계좌 복사), 모임별 미입금 금액·돌려줄 돈, 월 합계에 돌려줄 참가비 안내.
- 공용 모듈 분리: `components/CopyButton.tsx`, `lib/kakao.ts`(200자 맞춤 공유), `lib/format.ts`(`won`, `accountText`).

**테스트 (신규)**
- `backend/tests/test_payments.py` — pytest 23개: 1인 금액 계산, 입금 금액 기록, 인원 증가/감소 후 차액, 입금 후 불참 환불, 권한(회원은 입금 처리 불가), 무료·취소 모임, 월 합계, 내 참가비, 상세·월별 결과 일치, 마이그레이션.
- 실행: `cd backend && pip install -r requirements-dev.txt && python -m pytest`
- 화면 E2E(빌드된 서버 + 임시 DB, 역할별 로그인 HTML 검사) 23개 항목 통과.

**배포 시 참고**
- 1인 금액이 반올림 → **100원 단위 올림**으로 바뀌어, 기존 모임의 1인 금액이 최대 99원 올라갈 수 있다.
- 이전에 입금 처리된 기록은 금액이 없으므로 현재 1인 금액을 낸 것으로 계산된다(차액 표시 없음).

## 13. 전체 디자인 리뉴얼 (2026-10-01)

"촌스럽다"는 의견으로 화면 전체를 다시 디자인했다. 1차(정돈) → 2차(홈 대시보드 + 상단 띠) → 브랜드 색 변경(녹색 → 차콜 + 라임) 순서로 진행했다.

### 1) 디자인 기반
- **폰트**: Pretendard(jsdelivr CDN, `root.tsx`).
- **아이콘**: `lucide-react` 추가 (이모지·텍스트 기호 대체).
- **색** (`tailwind.config.ts`)
  - `slate` 팔레트를 차분한 회색(토스 계열)으로 덮어써 앱 전체 회색 톤 통일.
  - 브랜드 색 `ball`(테니스공 라임, 메인 `ball-400` `#D4F53C`). 바탕·주요 버튼은 **차콜**(`slate-900`), 라임은 선택·활성·강조에만 쓴다. 흰 바탕 위 글자는 `ball-800` 이상(대비 4.5:1↑).
  - 의미 색은 별도 유지: 낼 돈 = 주황(amber), 환불 = 파랑(sky), 주말 = 빨강/파랑.
- **공통 클래스** (`tailwind.css`): `btn-*`, `input`, `card`, `badge-*`(`badge-lime`·`badge-accent` 등), `segmented`, 히어로용(`hero-title`, `btn-hero*`, `segmented-hero*`, `badge-hero`, `back-link-hero`), `alert-*`.
  - `.btn-sm`은 모든 버튼 변형 **뒤에** 선언해야 높이가 덮어써진다(앞에 두면 `@apply btn`의 h-9가 이김).

### 2) 레이아웃
- **헤더 + 페이지 히어로**: 차콜 헤더 아래 같은 색의 띠(`PageHero`)에 제목·요약·주요 버튼을 두고, 본문(`PageBody`)을 `-mt-10`으로 끌어올려 첫 카드가 띠에 걸치게 했다 (`components/Page.tsx`).
- **내비게이션**: 데스크톱 상단 메뉴(활성 = 라임 글자), 모바일 하단 탭바(아이콘 + 라벨, 활성 = 라임 알약). 모임 상세·일자 페이지는 "캘린더" 메뉴로 표시.
- **로고**: 라임 사각형 안 차콜 테니스공(`components/Logo.tsx`), 같은 모양의 파비콘(`LOGO_FAVICON`).
- **모달**: `components/Modal.tsx` — `document.body`로 포털, 모바일은 바텀시트·데스크톱은 가운데, Esc 닫기·배경 스크롤 잠금.
  - 페이지 전환 애니메이션은 `fill-mode: backwards` — `both`면 끝난 뒤 transform이 남아 안쪽 `position: fixed` 모달의 기준이 틀어진다.

### 3) 화면별
- **홈(신규, `/app`)**: 기존엔 캘린더로 바로 이동했으나 대시보드로 변경.
  - 다음 모임 카드(D-day, 일시·장소, 참석자, **바로 참석 투표** — `useFetcher`로 모임 상세 action 호출, 3일 전 잠금 동일, 관리자는 버튼 숨김).
  - 요약 타일: 내가 낼 참가비 / 내 승률 / 가입 신청(관리자) 또는 다가오는 모임.
  - 다가오는 일정 목록.
- **캘린더**: 월 이동·보기 전환·엑셀·일정 등록을 히어로로, 리스트 보기는 날짜별 묶음 + `GatheringRow` 한 줄 행.
- **모임 상세**: 히어로에 제목·상태·정보·공유/수정/삭제, 본문에 참석·참가비(진행 막대, 계좌 2줄 표시)·대진.
- **정산·랭킹·회원·마이페이지·관리자·로그인·가입**: 같은 히어로 + 카드 구조로 통일, 승률·입금률 막대 추가.
- 공용 분리: `components/GatheringRow.tsx`, `lib/status.ts`(모임 상태 라벨·배지·점 색, 요일).
- 한글 줄바꿈: `word-break: keep-all`(단어 중간 끊김 방지), 긴 계좌번호만 `break-all`.

### 검증
- 타입체크·빌드 통과, 화면 E2E 23개 통과, 백엔드 pytest 23개 통과.
- 데모 DB로 데스크톱/모바일 × 라이트/다크 화면 확인.

### 배포 시 참고
- `lucide-react` 의존성이 추가되어 프론트 이미지 재빌드 필요(`docker compose up -d --build`).

## 14. 팀 이름 변경: 오테식 (2026-10-01)

팀 이름이 **오테식**(오순도순 테니스 식구)으로 바뀌어, 서비스 이름을 "테니스 매니저" → **"오테식 매니저"**로 통일했다.
- 화면: 헤더 로고 옆 이름, 로그인 제목(부제 "오순도순 테니스 식구의 일정 · 전적 · 회비"), 모든 페이지 탭 제목.
- 백엔드: API 이름·설명(`main.py`, Swagger 제목), 모델 주석.
- 문서·설정: README, 이 문서 머리말, `deploy/DEPLOY.md`, nginx 블록 주석, systemd `Description`, `docker-compose.yml` 주석, `frontend/package.json` 이름(`otesik-web`).
- **유지**: 서버와 맞물린 식별자는 바꾸지 않았다 — 컨테이너 이름(`tennis-frontend`/`tennis-backend`), DB 파일(`tennismanager.db`), 볼륨(`tennis-data`), 배포 설정 파일명. 바꾸면 기존 DB 볼륨·nginx 프록시 연결이 끊긴다.

## 15. 주소 변경(otesik.duckdns.org) 준비 + 링크 미리보기 (2026-10-01)

**문제**: `13.125.173.69.sslip.io` 링크를 카톡(데스크톱)에 올리면 어스유니버스 미리보기가 떴다.
- 점검: 도메인을 붙인 정상 요청은 테니스 앱으로 가지만, **IP로 직접 접속하거나 SNI 없이 접속하면 서버 기본 사이트(어스유니버스)**로 간다.
- 추정 원인: 테니스용 nginx 설정 전(이 주소가 기본 사이트로 가던 때)에 카톡이 미리보기를 캐시했거나, IP가 들어간 주소라 카톡 수집기가 IP 접속처럼 처리.

**대응**
- 새 주소 **`otesik.duckdns.org`** (무료 DuckDNS). nginx에 전용 server 블록 + 인증서, 예전 sslip 주소는 새 주소로 301 (`deploy/nginx-tennismanager-block.conf` [A]/[B]/[C], 절차는 `deploy/DEPLOY.md` "주소 변경").
- **링크 미리보기 태그** (`root.tsx`): `og:title`·`og:description`·`og:image`·`description`. 라우트 `meta`는 부모 것을 덮어쓰므로 Layout `<head>`에 직접 둬 모든 페이지 공통. 비로그인 수집기는 로그인 페이지로 리다이렉트되므로 그 페이지에서 읽힌다.
  - `og:image`는 절대 주소여야 해서, nginx가 넘기는 `X-Forwarded-Proto` + `Host`로 접속 주소를 만든다.
- 미리보기 이미지 `frontend/public/og-image.png` (1200×630, 차콜 + 라임, Pretendard).
- 앱 코드에는 주소가 하드코딩된 곳이 없다(카톡 공유 링크는 `window.location.origin`).

## 16. 디자인 리뉴얼 2: "otesik." 하우스 테마 (2026-10-07)

참고 사이트 두 곳(mosbyfiles.com, units.gr)을 재해석한 시안 2개 중 **B안(units.gr 재해석)**을 실제 앱에 적용했다. 클럽을 하나의 공유 하우스처럼: 크림 바탕 + 원색 타일 벤토.

### 1) 디자인 기반 (`tailwind.config.ts`, `tailwind.css`)
- **색**: `slate`를 따뜻한 크림 톤으로 덮어씀(바탕 `#F3EAE2`). 하우스 원색 `house-{blue,yellow,orange,green,lav,red,ball}`, 글자 `ink #121212`, 중립 카드 `paper`. 이전 `ball`(라임) 팔레트는 제거.
- **페이지별 대표색 = 메뉴 타일 색**: 홈 파랑 · 캘린더 노랑 · 정산 주황 · 랭킹 초록 · 회원 보라 · 관리자 검정.
- **글꼴**: 제목·큰 숫자·로고는 `font-display`(Bricolage Grotesque, Google Fonts) → 한글은 Pretendard로 이어짐. 본문은 Pretendard.
- **공통 클래스**: `tile-*`(원색 카드, 다크 모드에서도 색·검정 글자 유지), `tile-title/sub`, `tile-rows`(밑줄 목록), `card`(중립), 알약 버튼(`btn-primary/accent/ghost/danger`, 타일 안용 `btn-ink/line/white`), 배지(`badge-*`, 타일 안용 `chip-*`), `seg`(한 칸 = 한 명 입금 막대), `segmented`.
- 타일 안에서는 `dark:` 변형이 없는 `btn-ink`·`chip-*`를 쓴다(다크 모드에서 노란 타일 위 글자가 흰색으로 바뀌는 것 방지).

### 2) 레이아웃 (`routes/app.tsx`)
- 데스크톱(md+): 왼쪽 **번호 타일 메뉴**(01 홈 ↗ …), 아래 검정 타일에 내 이름(마이페이지)·테마·로그아웃.
- 모바일: 위 로고 줄(`otesik.` + 테마/로그아웃/아바타) + **떠 있는 검정 탭바**(현재 메뉴는 노란 알약).
- 공통 컴포넌트: `Page.tsx`(`PageHeader`·`PageBody`·`BackLink`·`EmptyCard`), `Logo.tsx`(`Wordmark` + 파비콘), `BallBasket.tsx`(볼 바구니 일러스트), `Marquee.tsx`(흐르는 소식 띠, 움직임 줄이기 설정 시 정지), `AuthLayout.tsx`(로그인·가입).

### 3) 화면별
- **홈**: 소식 띠(다음 모임·이번 주 모임 수·내 참가비·랭킹 1위·다가오는 일정·가입 대기) + 벤토 — 오렌지 "다음 모임"(바로 투표), 노랑 "내가 낼 참가비"(계좌 복사), 검정 "내 승률", 초록 "다가오는 일정", 파랑 **코트 배정**(배정 코트를 위에서 본 모양 + 네이버 지도 검색 링크), 보라 **랭킹 TOP 5**(로더에 `/stats/ranking` 추가).
- **모임 상세**: 오렌지 정보 타일(상태·D-day·정보 칩) + 파랑 참석(큰 숫자 + 투표) / 노랑 참가비 정산(칸 막대, 내 참가비, 계좌, 입금 토글, 환불, 미입금 안내) · 보라 참석 명단 · 초록 대진(만들기 + 대진표, 점수 기록).
- **캘린더**: 노란 요일 줄, 오늘은 검정 원, 일정 칩은 상태색 알약. **정산**: 오렌지 "내가 낼 참가비"(계좌가 같으면 한 번만) + 초록/노랑/검정 합계 타일 + 모임별 카드(칸 막대). **랭킹**: 1~3위 시상대 타일 + 초록 전체 순위. **회원**: 색 아바타 카드 그리드. **회원 전적**: 보라 프로필 + 검정 승률 + 종목/파트너/상대 타일. **마이페이지·관리자·로그인·가입**도 같은 언어로.
- 링크 미리보기 이미지 `public/og-image.png`를 새 디자인으로 교체, 파비콘은 검정 사각형 + 노란 공.

### 검증
- 타입체크·빌드 통과. 데모 DB로 데스크톱/모바일 × 라이트/다크, 회원·관리자 계정에서 확인.
- 동작 확인: 홈에서 바로 투표, 관리자 입금 토글(입금 3→4명 반영), 일정 등록 모달, 메뉴 이동. 프로덕션 빌드에서 콘솔 오류 없음.

## 17. 승인 시안 전체 적용: 오테식 클럽하우스 (2026-10-08)

기존 하우스 테마의 크림 바탕과 다섯 가지 색, 볼 바구니 일러스트를 유지하면서 승인된 `/design-preview` 시안을 실제 데이터 화면에 적용했다.

### 화면 및 공통 디자인
- 가벼운 사이드바와 색상 아이콘, 모바일 하단 메뉴, 페이지 제목·여백·버튼·입력 폼을 통일했다.
- 홈은 다음 모임, 개인 참가비, 예정 일정, 코트, 전적, TOP 3 순으로 정보를 배치했다. 소식은 정적인 한 줄로 표시한다.
- 캘린더의 월 이동과 보기 전환을 정리하고 모바일 달력 아래에 이번 달 모임 목록을 추가했다.
- 모임 상세는 모임 정보·참석 현황, 참석자·정산, 대진 카드로 구분했다. 투표, 입금·환불, 대진 생성과 결과 기록은 기존 API를 사용한다.
- 정산, 랭킹, 회원 목록·전적, 마이페이지, 관리자, 로그인·가입까지 같은 디자인으로 적용했다.
- 공용 `Club.tsx`에서 회원 아바타, 소제목, 일러스트, 코트 표시를 제공한다. 모달은 네이티브 `dialog`로 전환해 포커스 이동·복원과 Escape 닫기를 지원한다.
- 작은 화면에서는 홈 일러스트와 제목을 별도 영역에 배치해 일정 정보가 겹치지 않도록 했다. 라이트·다크 모드와 움직임 줄이기 설정을 지원한다.
- 홈에서는 예정·진행 중인 모임만 다음 모임으로 선택한다. 정산 계좌를 합쳐 보여줄 때 은행도 함께 비교한다.

### 검증
- 프론트엔드 타입 검사, 미사용 코드 검사, 배포용 빌드 통과. 백엔드 pytest **23개 통과**.
- 별도 임시 SQLite DB로 회원·관리자 로그인, 참석 변경과 회비 재계산, 일정 등록·수정, 가입 승인, 입금 처리, 대진 생성, 결과 기록, 프로필 저장을 브라우저에서 확인했다.
- 360px·390px 모바일 및 1440px 데스크톱, 라이트·다크 모드, 긴 제목과 빈 참석자·대진 상태를 점검했다. 모달 Escape 닫기와 호출 버튼으로 포커스 복원, 엑셀 등록 모달도 확인했다.
- 내장 브라우저 개발 모드에서는 브라우저가 `html` 아래에 삽입하는 주석 도구 요소에 따른 hydration 경고가 관찰된다. 기능 검증은 클라이언트 렌더링 전환 후 수행했다.
- 기존 DB와 배포 설정은 변경하지 않았다. 로컬 미리보기는 테스트 DB를 사용하는 프론트엔드 3010 / 백엔드 8011 포트에서 실행하며, 운영 배포는 수행하지 않았다.

## 18. 클럽 회칙 탭 추가 (2026-10-08)

운영진이 정리한 「오테식 기본 회칙 — 검토용 초안 v0.3」(6장 22조 + 부칙 + 부록 A·B)을 앱 안의 **클럽 회칙** 탭(`/app/rules`)으로 옮겼다. 원본 HTML의 녹색 문서 디자인 대신 클럽하우스 테마(크림 바탕, 원색 타일, 알약 버튼)로 다시 구성했다.

### 구성
- **메뉴**: 사이드바 06번 `클럽 회칙`(라임 `house-ball` 아이콘), 모바일 하단 메뉴 `회칙`. 관리자 메뉴는 07번으로 밀린다.
- **데이터** `app/lib/rules.ts`: 장·조·항, 표시(기존 기준/이번 운영안/문안 제안/확정 필요), 검토 메모, 부칙, 부록을 구조화했다. 본문 표기는 `**굵게**`, `{{확정 필요}}`. 화면과 "회칙 복사" 문구가 모두 이 데이터에서 만들어진다.
- **화면** `app/routes/app.rules.tsx`
  - 핵심 기준 타일 4개(코트 1면 최대 6명 · 4+2 자리 · 월 회비 20,000원 · 게스트비 5,000원) → 해당 조항으로 이동
  - 주황 "이번 버전에 반영했어요"(가입 기준·정원·임기·입단비·게스트비·해산 정산·시행일) + "이렇게 읽어요" 표시 안내
  - 목차: xl 이상은 왼쪽 세로 목록, 그 아래는 위에 붙는 가로 칩. 스크롤 위치에 따라 현재 장을 표시하고, 링크는 부드럽게 이동하며 포커스도 옮긴다. `/app/rules#art-16` 같은 조항 직접 링크 가능.
  - 장마다 색 번호 타일, 조항 카드(항 번호, 굵게, 노란 밑줄 = 확정 필요, 점선 아래 검토 메모)
  - 부록 A: 4+2 자리 점 그림, 배정 흐름 4단계, 최종 구성 예시(정회원·게스트 점), 공지 필수 항목 / 부록 B: 노란 타일의 확정 전 체크리스트(조항 링크)
  - **회칙 복사**: 항 번호를 ①②로, 확정 필요 표시는 〔 〕로 남긴 일반 텍스트. **인쇄**: 메뉴·목차를 빼고 A4로, 다크 모드에서도 밝은 화면 기준으로 인쇄한다.
- 원문 조항은 그대로 옮겼다. 검토 메모 중 초안 작성 과정을 가리키는 표현("사용자가 제시한", "이번 대화" 등)만 "운영진이 제시한", "이번 논의"처럼 바꿨고, 작성 근거에서 단독 HTML 파일에만 해당하던 문장(외부 연결 없음 등)은 뺐다.
- 백엔드·DB 변경 없음. 회칙을 고치려면 `app/lib/rules.ts`를 수정해 배포한다.

### 검증
- `npm run typecheck`, 미사용 코드 검사, `npm run build` 통과. 원본 HTML에서 추출한 조항 제목·본문과 `rules.ts`가 모두 일치함을 스크립트로 확인.
- 임시 SQLite DB + 로컬 서버에서 1440px·1024px·390px·360px, 라이트·다크 모드를 확인. 목차 이동·현재 장 표시·포커스 이동, 조항 직접 링크, 회칙 복사(클립보드), A4 인쇄(다크 모드 포함), 가로 스크롤 없음 확인.

## 19. 회칙 v0.4: 운영진 확정 사항 반영 (2026-10-09)

운영진이 정한 8가지를 `app/lib/rules.ts`의 해당 조항에 반영하고, 채워진 〔확정 필요〕 표시를 없앴다. 버전 v0.3 → **v0.4**(2026.10.09).

| 항목 | 반영 내용 | 조항 |
|---|---|---|
| 가입 절차 | 체험 **3회** 후 **임원진 투표**로 가입 여부 결정 (투표 방식·찬성 기준은 임원진 재량) | 제3·4조 |
| 휴면 | **3개월 무상**, 3개월 연장 시 **월 회비 50%** | 제6·15조 |
| 정기 모임 | **매주 주말(토·일) 중 1회** | 제9조 |
| 자리 배분 | **정회원 선착순** → 남은 자리만큼 **코트 이용일 3일 전 게스트 참석 투표** (기존 4+2 배분안 폐지) | 제9~12조, 부록 A |
| 취소·노쇼 | 환불은 **3일 전까지** 취소 시 · 노쇼 **2회 경고, 3회 강퇴** | 제12·17조 |
| 회비 미납 | **2개월 연속 미납 시 강퇴** (공지 이후 미납부터, 소급 없음) | 제15조 |
| 입단비 | **30,000원 → 50,000원**, 탈퇴 후 재가입 시 **다시 납부** | 제16조 |
| 고액 지출 | 정회원 **참석률만큼** 지원(40% 참석 → 40%), **70% 이상 참석 시 100%** | 제18조 |

- 강퇴 사유가 생겨 제6조(자동 탈퇴 금지 문구)와 제14조(제명 기준)도 제12·15조를 가리키도록 맞췄다.
- "이번 버전에 반영했어요" 목록과 확정 전 체크리스트(부록 B), 작성 근거를 v0.4 기준으로 갱신. 자리 배분 타일 설명을 "코트 이용일 3일 전 잔여 자리 개방"으로 변경.
- 4+2(정회원 우선 4·공통 2) 구분을 없애고 핵심 기준 타일·부록 A(배정 흐름·예시)·공지 필수 항목·부칙을 "정회원 선착순 → 3일 전 게스트 투표" 기준으로 고쳤다. 게스트 투표 이후에는 정회원·게스트 구분 없이 투표 순서로 배정한다.
- 남은 확정 필요: **휴면 연장 이후** 처리, **고액 지출로 보는 금액 기준**.
- 게스트 3일 전 투표는 이후 매니저 앱 기능으로도 만들 예정.
