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
# postgresql-client: pg_dump for jobs/backup.ts, age: its encrypted off-site copy. curl: the healthcheck in compose.
# poppler-utils: pdftoppm, for PDF thumbnails in the Archive (shared/lib/thumbnail.ts).
# vips-tools: vipsthumbnail, for the photo thumbnails in Messages (same file).
# python3 + a venv with pyHanko (backend/signing/requirements.txt): signs contracts into existing PDF fields
# without breaking a qualified signature made before (shared/lib/pdf-signing.ts).
RUN apk upgrade --no-cache && apk add --no-cache chromium nss freetype harfbuzz font-liberation ca-certificates openssl postgresql-client age curl poppler-utils vips-tools python3
COPY backend/signing/requirements.txt /tmp/pdfsign-requirements.txt
RUN python3 -m venv /opt/pdfsign && /opt/pdfsign/bin/pip install --no-cache-dir -r /tmp/pdfsign-requirements.txt && rm -rf /tmp/pdfsign-requirements.txt /root/.cache
# The root filesystem is read-only in production: no .pyc files to write.
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --prod --filter @vana-dash/backend
# The server runs on node alone. npm, corepack and pnpm stay out of the running image: the npm
# bundled with node:22-alpine carried every HIGH/CRITICAL that trivy found (2026-11-19).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /root/.cache /root/.local/share/pnpm \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=build /app/backend/dist backend/dist
# Migrations run at start, before the server
COPY --from=build /app/backend/src/shared/db/migrations backend/dist/shared/db/migrations
# ANAF declaration forms (D301/D390), filled in by connectors/anaf/declarations/xfa-pdf.ts
COPY --from=build /app/backend/src/connectors/anaf/declarations/templates backend/dist/connectors/anaf/declarations/templates
COPY backend/signing/pdfsign.py backend/signing/pdfsign.py
WORKDIR /app/backend
# Non-root. The two volume mount points are created here owned by node, so a fresh named volume
# inherits that owner; volumes created before this need a one-time chown to 1000.
RUN mkdir -p storage /backups && chown node:node storage /backups
USER node
CMD ["sh", "-c", "node dist/shared/db/migrate.js && node dist/index.js"]
