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
RUN pnpm turbo run build --filter=@mlist/web

# --- One-shot migrations: Drizzle schema + workflow (graphile-worker) tables --
FROM build AS migrate
WORKDIR /repo/apps/web
CMD ["pnpm", "db:setup"]

# --- Runtime: the self-contained Nitro output only ----------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WORKFLOW_TARGET_WORLD=@workflow/world-postgres \
    # Workflow bundles build `require` from Nitro's virtual import.meta.url (file:///_entry.js),
    # so bare CJS requires (e.g. `jose`) would resolve from `/`. Point them at the traced deps.
    NODE_PATH=/app/.output/server/node_modules

COPY --from=build --chown=node:node /repo/apps/web/.output ./.output

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
