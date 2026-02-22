# Trigger

## Runtime

Use Bun for everything. Bun auto-loads `.env`.

- `bun run dev` — server with hot reload (Tailwind processed via `bun-plugin-tailwind`)
- `bun run build` — production bundle into `dist/`
- `bun run start` — `cd dist && bun index.js start`
- `bun run validate` — validate example YAML configs against the schema
> **Note:** `bun run start` uses `cd dist` because Bun resolves bundled HTML asset paths relative to CWD, not the script location.
- `bun run typecheck` — type-check (`bunx tsc --noEmit`)
- `bun run lint` — lint check via Biome (`bunx biome check .`)
- `bun run lint:fix` — auto-fix lint + format (`bunx biome check --write .`)
- `bun run format` — format only (`bunx biome format --write .`)

## Architecture

- **CLI:** `index.ts` entry point (`start`, `validate` subcommands) via `util.parseArgs`.
- **Server:** Raw `Bun.serve()` with flat route map (no framework). Controllers in `src/server/controllers/`.
- **Frontend:** React 19 SPA — `public/index.html` loads `src/client/app.tsx` with custom router. Data via `useFetch` hook (cache/dedup).
- **Auth:** Opt-in OIDC SSO (`src/auth/`). HMAC-signed session cookies + group-based ACLs. Super admin bypass via `TRIGGER_ADMINS`.
- **Database:** `bun:sqlite` with WAL mode. Schema in `src/db/index.ts`, queries in `src/db/queries.ts`.
- **Real-time:** Bun native WebSocket (`src/server/ws.ts`) + React hooks (`src/client/ws.tsx`). In-memory pub/sub (`src/events.ts`). Per-run log streaming via subscribe/unsubscribe messages. Browser notifications on completion.
- **Config:** YAML pipeline configs fetched from GitHub or local paths. Zod-validated at load time with template cross-validation. Templates resolved at execution time.
- **Actions:** `defineAction({ name, schema, handler })` API. Self-contained files with inline Zod schemas. Auto-discovered via action registry.

## File structure

```
index.ts                      # CLI entry point (start, validate subcommands)
build.ts                      # Production build script
Dockerfile                    # Container image build
bunfig.toml                   # Bun config (dev Tailwind plugin)
tsconfig.json                 # TypeScript config (strict, noEmit)
mise.toml                     # Toolchain versions (Bun 1.3)
.env.example                  # Env var reference
prek.toml                     # Pre-commit hooks (lint, typecheck, validate)
public/
  index.html                  # Single HTML shell (SPA entry point)
packages/
  trigger-sdk/
    index.ts                  # SDK re-exports from src/pipeline/types.ts (z, defineAction, template helpers)
src/
  server/
    index.ts                  # startServer(): Bun.serve lifecycle, startup, shutdown
    routes.ts                 # Route map (path → controller handler) + fetch/error/WS upgrade fallbacks
    ws.ts                     # WebSocket manager: connection tracking, broadcast, per-run subscriptions
    validation.ts             # Zod schemas for request/query validation (triggerRun, listRuns, WS messages)
    controllers/
      helpers.ts              # Shared utilities: getConfigs, findNsConfig, access checks, types
      auth.ts                 # Auth flow handlers (login, callback, logout, me)
      pipelines.ts            # Pipeline CRUD + trigger + config listing
      runs.ts                 # Run listing, detail, logs, cancel, retry
      config.ts               # Dynamic JSON Schema endpoint
  types.ts                    # Shared types (imported by server + client)
  env.ts                      # Env var access
  logger.ts                   # Custom Pino-style JSON logger (createLogger, child loggers)
  events.ts                   # In-memory pub/sub event bus
  scheduler.ts                # Cron scheduler: tick loop, crash recovery, schedule map
  input.css                   # Tailwind CSS entry point
  auth/
    session.ts                # HMAC-signed session cookies (24h TTL)
    oidc.ts                   # OpenID Connect discovery + auth code flow
    access.ts                 # Group-based ACLs, authed() HOF, super admin bypass
  config/
    schema.ts                 # Template helpers, buildSchema (Zod), buildJSONSchema (editor)
    types.ts                  # Re-exports from schema.ts + resolved action config types
    namespace.ts              # Env → namespace source resolution
    loader.ts                 # Fetch, parse, validate YAML configs + schema caching
    template.ts               # {{param.X}}, {{vars.X}}, {{env.X}}, $switch resolution
  db/
    index.ts                  # SQLite init, migrations
    queries.ts                # Run/step CRUD operations
  pipeline/
    types.ts                  # Action API barrel: z, defineAction, ActionContext, template helpers
    action-registry.ts        # Action registry (Map<name, RegisteredAction>)
    action-loader.ts          # Custom action auto-discovery from ACTIONS_DIR
    executor.ts               # Pipeline execution engine
    actions/                  # One file per action type (self-contained with own schema)
      codebuild.ts            # AWS CodeBuild: start, stream logs, poll
      ecs-restart.ts          # ECS force new deployment
      ecs-task.ts             # ECS run one-off Fargate/EC2 task
      cloudflare.ts           # Cloudflare cache purge
      trigger-pipeline.ts     # Trigger another pipeline (uses app internals)
      aws-utils.ts            # Shared AWS helpers (sleep, log streaming)
  client/
    app.tsx                   # SPA root: React 19, WebSocket provider, route definitions
    router.tsx                # Custom client-side router (pattern matching, Link, navigate)
    ws.tsx                    # WebSocket context, useStatus, useSubscription, useGlobalEvents hooks
    hooks.tsx                 # Data fetching hooks (useFetch with cache/dedup, useConfigs, useUser)
    keyboard.tsx              # Keyboard shortcut registry (ShortcutRegistryProvider, useKeyboard)
    home.tsx                  # Home page (namespace grid)
    namespace.tsx             # Namespace page (pipeline list)
    pipeline.tsx              # Pipeline page (param form + trigger)
    run.tsx                   # Run detail page (steps + live logs)
    config.tsx                # Pipeline config viewer
    login.tsx                 # SSO login page
    utils.ts                  # Client-side utilities
    components/               # Layout, CommandPalette, LogViewer, ParamForm, ConfirmDialog, Toast, StatusBadge, etc.
examples/
  configs/                    # Example YAML pipeline config files
  custom-actions/             # Example custom action plugins
```

## Key conventions

- JSX uses `react-jsx` automatic runtime — no `import React` needed.
- Shared types in `src/types.ts` — imported by both server and client. Client code must NOT import from `src/db/`, `src/pipeline/`, or `src/config/` (server-only modules).
- `src/pipeline/types.ts` is the action API barrel — re-exports `z`, `defineAction`, `ActionContext`, and all template helpers. Both builtin actions and the SDK import from here.
- AWS clients use lazy initialization (created on first use per region, not at module load).
- Concurrency: per-pipeline limit (default 1) + global `MAX_CONCURRENT_RUNS` (default 10). Exceeding either returns 409.
- Unknown actions are handled gracefully: config validation skips them, executor marks their steps as skipped.

## Adding a new pipeline action

### Built-in action
1. Create `src/pipeline/actions/your-action.ts` — define the Zod schema inline and default-export `defineAction({ name, schema, handler })`. Import `z`, `defineAction`, and template helpers from `"../types.ts"`.
2. Import and add it to the array in `initBuiltinActions()` in `src/pipeline/executor.ts`.

### Custom action (plugin)
1. Create a `.ts` file in the custom actions directory (default `./actions/`, set via `ACTIONS_DIR` env var).
2. Default-export `defineAction({ name, schema, handler })` — import from `"trigger-sdk"` (or by relative path to `packages/trigger-sdk/index.ts`). See `examples/custom-actions/` for reference.
3. The action is auto-discovered at startup. JSON Schema at `/api/config/schema` updates automatically.

## Config format

Pipeline configs are YAML files. Key features:
- **Vars:** `vars` object for shared constants, referenced as `{{vars.name}}`. Templates must be quoted in YAML (`{` is flow mapping syntax).
- **Params:** `{{param.name}}` resolves to runtime parameter values. `{{param.name|default}}` provides a fallback.
- **Env vars:** `{{env.name}}` resolves to environment variables (prefixed by `TRIGGER_ENV_PREFIX`, default `TRIGGER_ENV_`).
- **Type preservation:** A full-string template like `"{{vars.subnets}}"` preserves the resolved type (array stays array).
- **`$switch`:** Conditional config — `$switch: param_name` with `cases:` and `default:`.
- **Schema:** Validated at load time via Zod with cross-field template validation. Dynamic JSON Schema at `/api/config/schema` for editor support.
- **Schedule:** Optional cron string or array of `{ cron, params }` objects. History tracked in `schedule_history` table.

## Environment

- All config via env vars — see `.env.example`.
- `TRIGGER_NAMESPACES` — **required**, comma-separated namespace list (e.g., `production,staging`).
- `TRIGGER_{NS}_CONFIG` — a GitHub file URL (`https://github.com/owner/repo/blob/branch/path`) or a local file path.
- `GITHUB_TOKEN` — for fetching configs from private repos.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` — optional, only needed for `cloudflare-purge` actions.
- `PORT` — server port (default `3000`).
- `DATA_DIR` — SQLite database and log file directory (default `./data`).
- `ACTIONS_DIR` — custom actions directory (default `./actions/`).
- `MAX_CONCURRENT_RUNS` — global concurrency limit across all pipelines (default `10`).
- `LOG_RETENTION_DAYS` — auto-cleanup threshold for old run log directories (default `30`).
- `TRIGGER_ENV_PREFIX` — prefix for env var injection via `{{env.X}}` templates (default `TRIGGER_ENV_`).
- `OIDC_ISSUER` — OIDC provider URL (set to enable auth).
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` — OIDC client credentials.
- `SESSION_SECRET` — optional override for session cookie signing key (falls back to `OIDC_CLIENT_SECRET`).
- `TRIGGER_ADMINS` — comma-separated admin emails (bypass all ACLs).

## Testing

- No test framework configured — project relies on TypeScript strict mode (`bun run typecheck`), Biome lint (`bun run lint`), and config validation (`bun run validate`).

## Docker

- `docker build -t trigger .` — multi-stage build (installs, typechecks, bundles).
- `docker run -p 3000:3000 --env-file .env trigger` — run with env vars.
