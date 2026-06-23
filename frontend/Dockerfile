# --- build stage: 의존성 설치 + Remix 빌드 ---
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- runtime stage: 빌드 산출물 + 운영 의존성만 ---
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5555
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/build ./build
EXPOSE 5555
CMD ["npm", "run", "start"]
