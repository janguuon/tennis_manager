# 🚀 AWS Lightsail 배포 가이드

테니스 매니저(Remix + FastAPI + SQLite)를 **Lightsail 인스턴스 1대**에 배포한다.

> ⚠️ **이 서버는 이미 Docker + 공용 `nginx_proxy`(80/443 점유) 환경이다.**
> 따라서 호스트에 nginx를 까는 아래 1~11절(systemd 방식)은 **사용하지 않는다.**
> **→ [13. Docker 배포](#13-docker-배포-이-서버-환경) 절을 따른다.** (아래 systemd 가이드는 단독 서버용 참고로만 남겨둠)

## 배포 구조 (단독 서버용 — 참고)

```
[인터넷] → Nginx (80/443) → Remix 프론트 (127.0.0.1:5555)
                                   │ 서버 내부 호출
                                   ▼
                            FastAPI 백엔드 (127.0.0.1:5005) → SQLite(tennismanager.db)
```

- 프론트가 **서버 사이드**에서 백엔드를 호출하므로 백엔드는 외부에 노출하지 않는다(내부 전용).
- 외부로 여는 포트는 **80(HTTP), 443(HTTPS)** 뿐.

> ⚠️ **더미 데이터는 배포 서버에 넣지 않는다.** `seed.py`를 **실행하지 않으면** 빈 DB로 시작하고,
> 서버에서 **맨 처음 가입한 사람이 자동으로 관리자**가 된다. (DB 파일 `tennismanager.db`는 `.gitignore`에 있어 git에 포함되지 않음)

---

## 1. Lightsail 인스턴스 생성

1. Lightsail 콘솔 → **Create instance**
2. 플랫폼: **Linux/Unix** → 블루프린트: **OS Only → Ubuntu 22.04 LTS**
3. 플랜: **최소 1GB RAM 이상** 권장 (프론트 빌드가 메모리를 꽤 씀. 512MB면 빌드 중 OOM 가능 — 아래 스왑 팁 참고)
4. 인스턴스 생성 후 **Networking** 탭 → **IPv4 Firewall**에 규칙 추가:
   - **HTTP (80)**, **HTTPS (443)** 허용 (SSH 22는 기본 허용)
   - 5005/5555는 **열지 않는다**(내부 전용)
5. (권장) **Static IP** 연결 → 재부팅해도 IP 고정
6. 브라우저 SSH 또는 본인 터미널로 접속 (`ubuntu` 사용자)

---

## 2. 서버 기본 패키지 설치

```bash
sudo apt update && sudo apt upgrade -y

# Python
sudo apt install -y python3 python3-venv python3-pip git nginx

# Node.js 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 확인
python3 --version   # 3.10+
node --version      # v20+
```

### (512MB~1GB 인스턴스) 스왑 추가 — 빌드 OOM 예방
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. 코드 가져오기

git 저장소가 있다면:
```bash
cd /home/ubuntu
git clone <레포주소> tennis_manager
```

git이 없으면 로컬에서 scp로 업로드 (단, **node_modules / venv / *.db 는 제외**):
```bash
# 로컬(Windows PowerShell)에서 — 더미 DB·캐시 제외하고 압축 업로드 예시
# (또는 GitHub 등에 올린 뒤 clone 하는 것을 권장)
```

업로드 방식으로 했다면 혹시 포함됐을 더미 DB를 삭제:
```bash
rm -f /home/ubuntu/tennis_manager/backend/tennismanager.db
```

---

## 4. 백엔드(FastAPI) 설정

```bash
cd /home/ubuntu/tennis_manager/backend
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# 운영용 .env 생성 (SECRET_KEY는 반드시 새 무작위 값)
cat > .env <<EOF
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
ACCESS_TOKEN_EXPIRE_MINUTES=10080
EOF
```

> **seed.py 는 실행하지 않는다.** 백엔드가 처음 켜질 때 빈 DB(`tennismanager.db`)가 자동 생성된다.

---

## 5. 프론트엔드(Remix) 설정 + 빌드

```bash
cd /home/ubuntu/tennis_manager/frontend
npm ci
npm run build

# 운영용 .env 생성 (SESSION_SECRET은 반드시 새 무작위 값)
cat > .env <<EOF
API_URL=http://127.0.0.1:5005
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF
```

---

## 6. 서비스 등록 (systemd)

배포용 유닛 파일을 복사해 등록한다.

```bash
sudo cp /home/ubuntu/tennis_manager/deploy/tennismanager-backend.service /etc/systemd/system/
sudo cp /home/ubuntu/tennis_manager/deploy/tennismanager-frontend.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now tennismanager-backend
sudo systemctl enable --now tennismanager-frontend

# 상태 확인
sudo systemctl status tennismanager-backend --no-pager
sudo systemctl status tennismanager-frontend --no-pager
# 로그 보기
journalctl -u tennismanager-backend -f
```

> `npm` 경로가 `/usr/bin/npm`이 아니면(`which npm`로 확인) frontend 서비스의 `ExecStart` 경로를 수정한다.

---

## 7. Nginx 리버스 프록시

```bash
sudo cp /home/ubuntu/tennis_manager/deploy/nginx-tennismanager.conf /etc/nginx/sites-available/tennismanager
sudo nano /etc/nginx/sites-available/tennismanager   # server_name 을 도메인/IP로 수정
sudo ln -s /etc/nginx/sites-available/tennismanager /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx
```

> ⚠️ **이 서버에 다른 프로젝트가 이미 돌고 있다면 `rm default`(또는 기존 사이트 삭제)를 하지 말 것.**
> 단독 서버에서 처음 배포할 때만, 기본 페이지가 거슬리면 `sudo rm -f /etc/nginx/sites-enabled/default` 로 제거한다.
> 다른 프로젝트와 함께 운영하는 경우는 **12. 다른 프로젝트와 같은 서버에서 함께 운영하기** 참고.

이 시점에서 `http://13.125.173.69.sslip.io` 접속 시 로그인 화면이 보여야 한다.

---

## 8. HTTPS — 도메인 없이 무료 (sslip.io) · 중요

⚠️ **로그인/테마 쿠키는 운영 모드에서 `Secure` 속성이 붙어 HTTPS에서만 전송된다.**
즉 **HTTP만으로는 로그인 세션이 유지되지 않는다.** 반드시 HTTPS를 붙인다.

도메인이 없으므로 **공인 IP 기반 sslip.io** 주소로 인증서를 받는다.
- 공인 IP: `13.125.173.69` → 접속 주소: **`https://13.125.173.69.sslip.io`**
- sslip.io는 별도 가입/등록 없이 그 주소를 해당 IP로 자동 연결해준다.

전제: ① Lightsail에 **Static IP가 인스턴스에 연결**돼 있을 것(IP가 바뀌면 안 됨) ② 방화벽 80·443 열림.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 13.125.173.69.sslip.io
# 자동 갱신은 certbot이 등록함
```
완료 후 `https://13.125.173.69.sslip.io` 로 접속한다.

> 나중에 실제 도메인이나 DuckDNS로 바꾸려면 nginx `server_name` 수정 후 certbot만 다시 실행하면 된다.
> 정 임시로 HTTP에서만 테스트해야 하면, `frontend/app/lib/session.server.ts`와 `theme.server.ts`의
> 쿠키 `secure` 옵션을 임시로 `false`로 바꿔야 로그인이 유지된다(운영에서는 되돌릴 것).

---

## 9. 첫 관리자 만들기

배포 완료 후 브라우저에서 `/signup` 으로 **가장 먼저 가입** → 자동으로 관리자 + 승인 → 바로 로그인.
이후 가입자는 관리자 승인 후 로그인 가능.

---

## 10. 코드 업데이트(재배포)

```bash
cd /home/ubuntu/tennis_manager
git pull

# 백엔드 의존성 바뀌었으면
./backend/venv/bin/pip install -r backend/requirements.txt
# 프론트 변경 시 재빌드
cd frontend && npm ci && npm run build && cd ..

sudo systemctl restart tennismanager-backend tennismanager-frontend
```

---

## 11. 백업 (SQLite)

DB는 파일 하나(`backend/tennismanager.db`)라 백업이 간단하다.
```bash
cp /home/ubuntu/tennis_manager/backend/tennismanager.db ~/backup-$(date +%F).db
```
> 정기 백업은 cron으로 위 명령을 돌리거나, 주기적으로 로컬로 내려받는다.
> 이용자가 늘어 동시 쓰기가 많아지면 PostgreSQL로 이전을 검토(현재 SQLite는 소규모 팀에 충분).

---

## 12. 다른 프로젝트와 같은 서버에서 함께 운영하기

이미 다른 웹 프로젝트가 돌고 있는 Lightsail 인스턴스에 테니스 매니저를 **추가로** 올려도 된다.
아래 3가지 충돌만 피하면 된다.

### (1) 포트 충돌 — 가장 중요
다른 백엔드 프로젝트와의 충돌을 피하기 위해 테니스 매니저는 **백엔드 5005 / 프론트 5555**를 사용한다
(아래 배포 파일에 이미 반영됨). 배포 전 두 포트가 비어 있는지 확인한다:
```bash
sudo ss -tlnp | grep -E ':(5005|5555)'    # 아무것도 안 나오면 OK
```
만약 둘 중 하나가 이미 쓰이고 있으면 다른 빈 포트로 바꾸고, 아래 4곳을 함께 수정한다:
- `deploy/tennismanager-backend.service` → `--port 5005`
- `deploy/tennismanager-frontend.service` → `Environment=PORT=5555`
- `frontend/.env` → `API_URL=http://127.0.0.1:5005`
- `deploy/nginx-tennismanager.conf` → `proxy_pass http://127.0.0.1:5555;`

> 5005/5555는 **서버 내부에서만** 쓰이므로 Lightsail 방화벽에는 열지 않는다(80/443만).

### (2) Nginx — 도메인/서브도메인으로 구분
두 사이트는 같은 80/443을 **`server_name`(도메인)으로 구분**해 공유한다(name-based virtual host).

현재 Nginx 사이트 확인:
```bash
ls -l /etc/nginx/sites-enabled/
```
규칙:
- **기존 사이트 설정은 절대 지우지 않는다** (`rm default` 등 금지).
- 테니스 매니저용 **별도 서브도메인**을 정한다. 예:
  ```
  project-A.com         → 기존 프로젝트
  tennis.project-A.com  → 테니스 매니저   (DNS A레코드를 같은 공인 IP로 추가)
  ```
- `nginx-tennismanager.conf`의 `server_name`을 그 서브도메인으로 설정하고 그 사이트만 추가로 enable.
- HTTPS도 도메인별로 따로 발급:
  ```bash
  sudo certbot --nginx -d tennis.project-A.com
  ```

### (3) 서버 자원(RAM)
두 앱이 동시에 뜨므로 메모리를 확인한다:
```bash
free -h
```
- 여유가 빠듯하면(특히 1GB 이하) **스왑 추가**(2번 항목) 필수.
- 프론트 **빌드(`npm run build`)** 가 메모리를 많이 쓰므로, 트래픽 적은 시간에 빌드하거나
  **로컬에서 빌드 후 `build/` 폴더만 업로드**하는 방법도 있다.

### 정리
1. 포트 안 겹치게 (백엔드 5005 / 프론트 5555 — 사용 중이면 변경)
2. Nginx는 **서브도메인으로 분리**, 기존 설정 건드리지 말 것
3. RAM 여유 확인 + 스왑

---

## 13. Docker 배포 (이 서버 환경)

**실제 운영 서버는 Docker + 공용 `nginx_proxy`(80/443) + `duckdns` 구조다.** 다른 프로젝트들도 전부 컨테이너로 돌고 있어,
호스트 nginx를 새로 깔 수 없다(80 충돌). 그래서 테니스 매니저도 **컨테이너로 패키징**해 기존 `nginx_proxy`에 연동한다.

### 구성 파일 (레포에 포함)
- `backend/Dockerfile` (FastAPI/uvicorn, 5005), `frontend/Dockerfile` (Remix 멀티스테이지, 5555)
- 루트 `docker-compose.yml` — `tennis-backend`(내부) + `tennis-frontend`(호스트 5555 공개), SQLite는 `tennis-data` 볼륨에 영속
- `.env.docker.example` — `SECRET_KEY`, `SESSION_SECRET`
- `app/database.py`는 `DATABASE_URL` 환경변수 지원 (compose에서 `sqlite:////app/data/tennismanager.db`)

### 컨테이너 띄우기
```bash
cd /home/ubuntu/tennis_manager

# (호스트 systemd 방식 쓰던 게 있으면) 중지/비활성화
sudo systemctl disable --now tennismanager-backend tennismanager-frontend 2>/dev/null

# 시크릿 .env 생성 (레포 루트)
cat > .env <<EOF
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
SESSION_SECRET=$(openssl rand -hex 32)
EOF

# 빌드 + 실행
docker compose up -d --build
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5555   # 200/302 면 정상
```
> 더미 데이터는 넣지 않는다(`seed.py` 미실행). 빈 DB로 시작 → 첫 가입자가 관리자.

### 기존 nginx_proxy 연동 (HTTPS)
프론트가 호스트 `5555`로 공개되므로, **기존 `nginx_proxy` 컨테이너에 서버 블록 하나만 추가**해
DuckDNS 서브도메인 → `호스트:5555`로 프록시한다. 정확한 경로/인증서 방식은 기존 설정을 보고 맞춘다:
```bash
docker inspect nginx_proxy --format '{{json .Mounts}}'   # 설정/인증서 호스트 경로
docker inspect duckdns     --format '{{json .Config.Env}}' # 현재 도메인
```
- 새 DuckDNS 서브도메인을 같은 IP에 추가 → `nginx_proxy` 설정에 server 블록 추가(`proxy_pass`는 기존 사이트와 동일한 호스트 게이트웨이 방식) → 인증서 발급(기존 체계 재사용) → reload.

### 업데이트(재배포)
```bash
cd /home/ubuntu/tennis_manager && git pull
docker compose up -d --build
```
