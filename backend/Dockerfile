FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 코드
COPY app ./app

# SQLite 데이터 영속용 디렉터리 (compose에서 볼륨 마운트)
RUN mkdir -p /app/data

EXPOSE 5005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5005"]
