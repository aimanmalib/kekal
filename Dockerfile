# Kekal web app and keeper in one image. Built from a clean `git archive` of HEAD by deploy/deploy.sh.
# Stage 1 installs the web and keeper workspaces and builds them; stage 2 carries only the Next.js standalone
# server, its static files, the bundled keeper and the SQL migrations. No Rust or Solana toolchain is involved:
# the program IDL is a committed JSON file.
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1 CI=1
WORKDIR /repo
RUN corepack enable
COPY . .
# The root workspace brings TypeScript, which `next build` uses to check types.
RUN pnpm install --frozen-lockfile --filter kekal --filter "@kekal/web..." --filter "@kekal/keeper..."
RUN pnpm --filter @kekal/web build \
 && node apps/keeper/bundle.mjs /repo/out/keeper.mjs

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=UTC \
    KEKAL_SQLITE_PATH=/app/data/kekal.db KEKAL_MIGRATIONS_DIR=/app/migrations
WORKDIR /app
# Standalone output keeps the monorepo layout: the server lives at apps/web/server.js.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/out/keeper.mjs ./keeper/keeper.mjs
COPY --from=build /repo/supabase/migrations ./migrations
# The data folder exists in the image so a fresh named volume mounted on it is owned by the app user.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
