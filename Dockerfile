# Build stage — install deps, type-check, and bundle
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run typecheck && bun run build

# Production stage — compiled output + trigger-sdk for custom actions
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=build /app/dist .
COPY --from=build /app/node_modules/zod /app/node_modules/zod
COPY --from=build /app/packages/trigger-sdk /app/node_modules/trigger-sdk

RUN mkdir -p /app/data /app/actions && chown -R bun:bun /app/data /app/actions

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV ACTIONS_DIR=/app/actions

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:3000/health'); if (!r.ok) process.exit(1)"

CMD ["bun", "index.js", "start"]
