# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# --- Dependencies + build -----------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NUXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.15.1

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# The workflow target world is resolved when the server is bundled
ENV WORKFLOW_TARGET_WORLD=@workflow/world-postgres
RUN pnpm turbo run build --filter=@nulist/web \
 && find apps/web/.output -name '*.map' -delete \
 && pnpm --filter @nulist/web build:migrate

# --- One-shot migrations: Drizzle schema + workflow (graphile-worker) tables --
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13 AS migrate
WORKDIR /app

COPY --from=build /repo/apps/web/dist/migrate ./scripts
COPY --from=build /repo/apps/web/server/db/migrations ./server/db/migrations
COPY --from=build /repo/apps/web/node_modules/@workflow/world-postgres/src/drizzle/migrations ./src/drizzle/migrations

USER nonroot
CMD ["scripts/migrate.mjs"]

# --- Runtime: the self-contained Nitro output only ----------------------------
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WORKFLOW_TARGET_WORLD=@workflow/world-postgres \
    # Workflow bundles build `require` from Nitro's virtual import.meta.url (file:///_entry.js),
    # so bare CJS requires (e.g. `jose`) would resolve from `/`. Point them at the traced deps.
    NODE_PATH=/app/.output/server/node_modules

COPY --from=build --chown=nonroot:nonroot /repo/apps/web/.output ./.output

USER nonroot
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD [".output/server/index.mjs"]
