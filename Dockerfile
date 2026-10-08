# UNO Punktezähler – Node + nginx in einem Container
FROM node:20-bookworm-slim

# nginx + supervisor installieren
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (besseres Layer-Caching)
COPY package.json ./
RUN npm install --omit=dev

# App-Code
COPY server ./server
COPY public ./public

# Konfigurationen
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/uno.conf

# Persistente SQLite-Daten
RUN mkdir -p /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Europe/Berlin

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/uno.conf"]
