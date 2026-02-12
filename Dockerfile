# Build stage — install deps, type-check, and bundle
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run typecheck && bun run build

# Production stage — just the compiled output, no node_modules needed
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=build /app/dist .

RUN mkdir -p /app/data && chown -R bun:bun /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:3000/health'); if (!r.ok) process.exit(1)"

CMD ["bun", "index.js"]
