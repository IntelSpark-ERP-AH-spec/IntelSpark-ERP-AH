FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS runtime-dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    BACKUP_DIR=/app/backups
WORKDIR /app
RUN addgroup -S intelsheets && adduser -S -G intelsheets intelsheets \
    && mkdir -p /app/data /app/backups \
    && chown -R intelsheets:intelsheets /app
COPY --from=runtime-dependencies --chown=intelsheets:intelsheets /build/node_modules ./node_modules
COPY --chown=intelsheets:intelsheets package.json package-lock.json server.js ./
COPY --chown=intelsheets:intelsheets backend ./backend
COPY --chown=intelsheets:intelsheets src ./src
COPY --chown=intelsheets:intelsheets scripts ./scripts
COPY --chown=intelsheets:intelsheets plugins ./plugins
COPY --from=frontend-build --chown=intelsheets:intelsheets /build/frontend/dist ./frontend/dist
USER intelsheets
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
