# syntax=docker/dockerfile:1.7

# ------------------------------------------------------------------------------
# Base stage — shared by dev and prod builds
# ------------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json

# ------------------------------------------------------------------------------
# Dev stage — used by docker-compose with bind mounts for hot reload
# ------------------------------------------------------------------------------
FROM base AS dev
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/db packages/db
ENV NODE_ENV=development
EXPOSE 4000
CMD ["pnpm", "--filter", "@pettahpro/api", "dev"]

# ------------------------------------------------------------------------------
# Build stage — compile TS for production
# ------------------------------------------------------------------------------
FROM base AS build
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/db packages/db
RUN pnpm --filter @pettahpro/api build

# ------------------------------------------------------------------------------
# Prod stage — minimal runtime image
# ------------------------------------------------------------------------------
FROM node:20-alpine AS prod
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/db packages/db
COPY --from=build /app/node_modules node_modules
# Sources must be absolute paths from the build stage's filesystem; with
# --from=, relative paths resolve from / not from WORKDIR.
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/.npmrc ./

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
