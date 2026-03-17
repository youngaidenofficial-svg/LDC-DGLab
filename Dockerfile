FROM node:20-alpine

WORKDIR /app

# 仅复制依赖清单以利用缓存
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY .env.example ./.env.example

EXPOSE 8787

CMD ["node", "server/index.js"]
