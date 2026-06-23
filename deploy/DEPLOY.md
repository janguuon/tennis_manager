# 🚀 AWS Lightsail 배포 가이드

테니스 매니저(Remix + FastAPI + SQLite)를 **Lightsail 인스턴스 1대**에 배포한다.

## 배포 구조

```
[인터넷] → Nginx (80/443) → Remix 프론트 (127.0.0.1:3000)
                                   │ 서버 내부 호출
                                   ▼
                            FastAPI 백엔드 (127.0.0.1:8000) → SQLite(tennismanager.db)
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
   - 8000/3000은 **열지 않는다**(내부 전용)
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
git clone <레포주소> teambreaker_manager
```

git이 없으면 로컬에서 scp로 업로드 (단, **node_modules / venv / *.db 는 제외**):
```bash
# 로컬(Windows PowerShell)에서 — 더미 DB·캐시 제외하고 압축 업로드 예시
# (또는 GitHub 등에 올린 뒤 clone 하는 것을 권장)
```

업로드 방식으로 했다면 혹시 포함됐을 더미 DB를 삭제:
```bash
rm -f /home/ubuntu/teambreaker_manager/backend/tennismanager.db
```

---

## 4. 백엔드(FastAPI) 설정

```bash
cd /home/ubuntu/teambreaker_manager/backend
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
cd /home/ubuntu/teambreaker_manager/frontend
npm ci
npm run build

# 운영용 .env 생성 (SESSION_SECRET은 반드시 새 무작위 값)
cat > .env <<EOF
API_URL=http://127.0.0.1:8000
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF
```

---

## 6. 서비스 등록 (systemd)

배포용 유닛 파일을 복사해 등록한다.

```bash
sudo cp /home/ubuntu/teambreaker_manager/deploy/tennismanager-backend.service /etc/systemd/system/
sudo cp /home/ubuntu/teambreaker_manager/deploy/tennismanager-frontend.service /etc/systemd/system/

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
sudo cp /home/ubuntu/teambreaker_manager/deploy/nginx-tennismanager.conf /etc/nginx/sites-available/tennismanager
sudo nano /etc/nginx/sites-available/tennismanager   # server_name 을 도메인/IP로 수정
sudo ln -s /etc/nginx/sites-available/tennismanager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default            # 기본 페이지 제거

sudo nginx -t && sudo systemctl reload nginx
```

이 시점에서 `http://<공인IP 또는 도메인>` 접속 시 로그인 화면이 보여야 한다.

---

## 8. HTTPS (도메인 필요) — 중요

⚠️ **로그인/테마 쿠키는 운영 모드에서 `Secure` 속성이 붙어 HTTPS에서만 전송된다.**
즉 **HTTP만으로는 로그인 세션이 유지되지 않는다.** 반드시 HTTPS를 붙인다.

도메인을 인스턴스 IP로 연결(A 레코드)한 뒤:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# 자동 갱신은 certbot이 등록함
```

> 도메인이 없다면: 무료 도메인(예: DuckDNS)을 IP에 연결해 certbot으로 인증서를 받는 방법을 권장.
> 정 임시로 HTTP에서 테스트해야 하면, `frontend/app/lib/session.server.ts`와 `theme.server.ts`의
> 쿠키 `secure` 옵션을 임시로 `false`로 바꿔야 로그인이 유지된다(운영에서는 되돌릴 것).

---

## 9. 첫 관리자 만들기

배포 완료 후 브라우저에서 `/signup` 으로 **가장 먼저 가입** → 자동으로 관리자 + 승인 → 바로 로그인.
이후 가입자는 관리자 승인 후 로그인 가능.

---

## 10. 코드 업데이트(재배포)

```bash
cd /home/ubuntu/teambreaker_manager
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
cp /home/ubuntu/teambreaker_manager/backend/tennismanager.db ~/backup-$(date +%F).db
```
> 정기 백업은 cron으로 위 명령을 돌리거나, 주기적으로 로컬로 내려받는다.
> 이용자가 늘어 동시 쓰기가 많아지면 PostgreSQL로 이전을 검토(현재 SQLite는 소규모 팀에 충분).
