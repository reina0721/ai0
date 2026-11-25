FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY plugins ./plugins
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV AI0_HOST=0.0.0.0
ENV AI0_PORT=4173
ENV AI0_SOULS_ROOT=/data/souls
RUN corepack enable && mkdir -p /data/souls
COPY --from=builder /app ./
EXPOSE 4173
# Liveness probe checks /healthz (200 OK even at L0_UNCLAIMED); orchestrator readiness probes should target /readyz (200 OK at L5_LIVE_READY).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/daemon/dist/cli.js"]
