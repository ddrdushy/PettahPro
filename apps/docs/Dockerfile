# syntax=docker/dockerfile:1.7

# Multi-stage Dockerfile for @pettahpro/docs (Docusaurus 3 site).
# Mirrors apps/web's stage layout (dev / build / prod) so the
# docker-compose dev experience is identical: `target: dev` for live
# reload in compose, `target: prod` for the built static bundle.
#
# The site is a static SPA — `docusaurus build` writes everything to
# /app/apps/docs/build. The prod stage uses `docusaurus serve` (Node)
# rather than nginx so we don't need an extra runtime in the image
# and the dev/prod surfaces stay close.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace manifest first so dep installs cache cleanly when only
# source changes. apps/docs has no workspace deps (no @pettahpro/db
# etc.) so the manifest list is shorter than web/api.
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/docs/package.json apps/docs/package.json

FROM base AS dev
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/docs apps/docs
ENV NODE_ENV=development
EXPOSE 3100
CMD ["pnpm", "--filter", "@pettahpro/docs", "dev"]

FROM base AS build
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/docs apps/docs
RUN pnpm --filter @pettahpro/docs build

FROM node:20-alpine AS prod
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/docs/build apps/docs/build
COPY --from=build /app/apps/docs/package.json apps/docs/package.json
COPY --from=build /app/apps/docs/docusaurus.config.ts apps/docs/docusaurus.config.ts
# Both the root node_modules AND apps/docs/node_modules are needed:
# pnpm resolves @docusaurus/* through the root store, but the
# `docusaurus` binary lives in apps/docs/node_modules/.bin via the
# workspace-local .bin symlinks pnpm creates.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/docs/node_modules apps/docs/node_modules
# Sources must be absolute paths from the build stage's filesystem;
# with --from=, relative paths resolve from / not from WORKDIR.
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/.npmrc ./
EXPOSE 3100
# `docusaurus serve` reads the prebuilt site from build/ — no further
# compilation at container start, just a static-file server on 3100.
# Run from apps/docs so the local .bin is on PATH and docusaurus.config.ts
# resolves relatively.
WORKDIR /app/apps/docs
CMD ["./node_modules/.bin/docusaurus", "serve", "--port", "3100", "--host", "0.0.0.0"]
