# Muhammad C++ Studio — API + web (single origin). Never compiles or runs user code.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @mcs/web build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clang-format && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 MCS_DATA_DIR=/data MCS_WEB_DIR=/app/apps/web/out MCS_COOKIE_SECURE=1
RUN useradd --system --uid 10001 --home /data studio && mkdir -p /data && chown studio /data
USER studio
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
# Run the dependency shim directly: no package-manager download at container start.
CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/index.ts"]
