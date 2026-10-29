# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Newer Node images no longer bundle corepack, so install the pnpm version
# pinned in package.json. Using it as an npm spec keeps a single source of truth.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" \
  && pnpm config set store-dir /pnpm/store --global

# Native modules (better-sqlite3) may need to compile if no prebuild matches.
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
# Dummy build-time values: the real ones are injected at runtime by compose.
# Building must not touch a real database or secret.
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    REGISTRATION_CODE=build-time-placeholder \
    DATABASE_URL=/tmp/build.db

RUN pnpm build
# Trim sharp's musl binaries from the standalone bundle before copying it into
# the runtime image: this image is glibc-only, so they can never be loaded.
RUN rm -rf \
      .next/standalone/node_modules/.pnpm/@img+sharp-linuxmusl-* \
      .next/standalone/node_modules/.pnpm/@img+sharp-libvips-linuxmusl-*

# Runtime image: start from the plain Node image, not from `base`, so the pnpm
# toolchain used for building is not inherited.
FROM node:26-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# npm, corepack and the Node headers are not needed to run the server. This
# only reduces the runtime filesystem/attack surface, not the image size: those
# files belong to the base image layers.
RUN rm -rf \
      /usr/local/lib/node_modules \
      /usr/local/include/node \
      /usr/local/CHANGELOG.md \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/auth/ok').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
