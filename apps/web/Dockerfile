# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json

FROM base AS dev
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/db packages/db
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "--filter", "@pettahpro/web", "dev"]

FROM base AS build
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/db packages/db
RUN pnpm --filter @pettahpro/web build

FROM node:20-alpine AS prod
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/node_modules node_modules
# Sources must be absolute paths from the build stage's filesystem; with
# --from=, relative paths resolve from / not from WORKDIR.
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/.npmrc ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@pettahpro/web", "start"]
