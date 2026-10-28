# syntax=docker/dockerfile:1
# VoltLink — self-hosted connected-vehicle platform.
# Multi-role single image: VL_ROLE = web | worker | scheduler | status.

# ---------------------------------------------------------------- build stage
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Install workspace manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# Sources.
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

# Prisma client + engines (schema arrives with sources, after npm ci).
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# Build: shared contracts → API bundle (.cjs) → SPA → stage SPA for the API.
RUN npm run build \
  && mkdir -p apps/api/web-dist \
  && cp -r apps/web/dist/* apps/api/web-dist/

# Keep production deps only (prisma CLI is a runtime dep for migrate deploy).
# A fresh prod-only `npm ci` is deterministic — unlike `prune`, it cannot leave
# hoisted dev dependencies (e.g. jsdom's undici) in the final image.
RUN npm ci --omit=dev

# ---------------------------------------------------------------- runtime stage
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

RUN groupadd --system voltlank && useradd --system --gid voltlank --no-create-home --home-dir /app voltlank

WORKDIR /app/apps/api

COPY --from=build --chown=voltlank:voltlank /app/node_modules /app/node_modules
COPY --from=build --chown=voltlank:voltlank /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=voltlank:voltlank /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=voltlank:voltlank /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=voltlank:voltlank /app/apps/api/prisma /app/apps/api/prisma
COPY --from=build --chown=voltlank:voltlank /app/apps/api/web-dist /app/apps/api/web-dist
COPY --from=build --chown=voltlank:voltlank /app/apps/api/openapi.json /app/apps/api/openapi.json
COPY --chown=voltlank:voltlank docker/entrypoint.sh /usr/local/bin/voltlank-entrypoint
COPY --chown=voltlank:voltlank docker/healthcheck.sh /usr/local/bin/voltlank-healthcheck

RUN chmod +x /usr/local/bin/voltlank-entrypoint /usr/local/bin/voltlank-healthcheck

USER voltlank
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["/usr/local/bin/voltlank-healthcheck"]

ENTRYPOINT ["voltlank-entrypoint"]
CMD ["web"]
