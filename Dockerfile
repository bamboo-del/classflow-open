FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS base
WORKDIR /app
FROM base AS build
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm ci --no-audit --no-fund)
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
RUN npm run build

FROM base AS prod-deps
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @classflow/api --no-audit --no-fund || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm ci --omit=dev --workspace @classflow/api --no-audit --no-fund)
RUN test ! -d node_modules/typescript && test ! -d node_modules/vite && test ! -d node_modules/@playwright/test

FROM base AS runtime
ENV NODE_ENV=production CLASSFLOW_BIND=0.0.0.0 CLASSFLOW_PORT=4318 CLASSFLOW_DATA_DIR=/var/lib/classflow/live CLASSFLOW_BACKUP_DIR=/var/backups/classflow
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN install -d -m 0700 -o node -g node /var/lib/classflow /var/backups/classflow
USER node
HEALTHCHECK --interval=20s --timeout=4s --start-period=8s CMD node -e "fetch('http://127.0.0.1:4318/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/api/dist/server.js"]
