FROM node:22-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Installer Playwright sin egen Chromium med alle avhengigheter
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

RUN npm prune --omit=dev

# Datakatalog på persistent volum (Railway: mount /data)
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "dist/bot.js"]
