# vana-dash backend — production image
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter @vana-dash/backend
COPY backend backend
RUN pnpm --filter @vana-dash/backend build

FROM node:22-alpine
RUN corepack enable
# postgresql-client: pg_dump for jobs/backup.ts. curl: the healthcheck in compose.
# poppler-utils: pdftoppm, for PDF thumbnails in the Archive (shared/lib/thumbnail.ts).
# vips-tools: vipsthumbnail, for the photo thumbnails in Messages (same file).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates postgresql-client curl poppler-utils vips-tools
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --prod --filter @vana-dash/backend
COPY --from=build /app/backend/dist backend/dist
# Migrations run at start, before the server
COPY --from=build /app/backend/src/shared/db/migrations backend/dist/shared/db/migrations
WORKDIR /app/backend
CMD ["sh", "-c", "node dist/shared/db/migrate.js && node dist/index.js"]
