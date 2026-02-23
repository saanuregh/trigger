# Architecture

## Overview

Trigger is a single-process Bun application that serves a web UI, exposes JSON APIs, executes infrastructure pipelines, and streams real-time logs — all without external dependencies beyond AWS and Cloudflare APIs.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                            │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Home     │  │ Namespace  │  │ Pipeline │  │ Run (+ logs) │  │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └──────┬───────┘  │
│       │ fetch        │ fetch        │ POST           │ WS       │
└───────┼──────────────┼──────────────┼────────────────┼──────────┘
        │              │              │                │
┌───────┴──────────────┴──────────────┴────────────────┴──────────┐
│  Bun.serve()  (src/server/)                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Route map: SPA shell, JSON APIs, WebSocket, Auth          │   │
│  └──────────────────────────────────────────────────────────┘   │
│       │                                                         │
│  ┌────┴──────┐   ┌───────────┐   ┌───────────┐   ┌──────────┐  │
│  │ Config    │   │ Executor  │   │ SQLite DB  │   │ Pub/Sub  │  │
│  │ (loader)  │   │ (engine)  │   │ (bun:sqlite)│   │ (events) │  │
│  └───────────┘   └─────┬─────┘   └───────────┘   └──────────┘  │
│                        │                                        │
│                  ┌─────┴──────────────────────────────┐         │
│                  │ Action handlers                     │         │
│                  │ codebuild │ ecs-restart │ ecs-task  │         │
│                  │ cloudflare-purge │ trigger-pipeline │         │
│                  └────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## CLI (index.ts)

`index.ts` is the entry point using `util.parseArgs`:

- **`start`** — starts the server (the default action in production)
- **`validate`** — validates YAML config files against the Zod schema (all registered actions) and exits

## Server (src/server/)

A single `Bun.serve()` call with a flat `routes` map. No framework — route handlers are plain functions returning `Response` objects. Domain-based controllers in `src/server/controllers/` (auth, pipelines, runs, config), wired via `src/server/routes.ts`.

**Route types:**

| Pattern | Purpose |
|---------|---------|
| `/*` | SPA HTML shell |
| `/health` | Health check |
| `/ws` | WebSocket upgrade |
| `/auth/login`, `/auth/callback` | OIDC login flow |
| `/api/auth/info`, `/api/me`, `POST /api/auth/logout` | Auth info endpoints |
| `/api/configs` | List all namespace configs |
| `/api/pipelines/:ns/:id`, `/api/pipelines/:ns/:id/config` | Pipeline detail + raw config |
| `/api/pipelines/:ns/:id/schedule` | Pipeline schedule info |
| `POST /api/pipelines/:ns/:id/run` | Trigger a pipeline |
| `/api/runs`, `/api/runs/:runId`, `/api/runs/:runId/logs` | Run listing, detail, logs |
| `POST /api/runs/:runId/cancel`, `POST /api/runs/:runId/retry` | Cancel or retry a run |
| `/api/config/schema` | Dynamic JSON Schema for editor validation |

On startup: init DB, recover stale runs, init actions, rebuild config schema, pre-load configs, start cron scheduler, fetch OIDC discovery (if auth enabled). Daily log cleanup removes directories older than `LOG_RETENTION_DAYS`. On shutdown: stop scheduler, cancel active pipelines (10s drain), close DB.

## Frontend (SPA)

`public/index.html` loads `src/client/app.tsx` — React 19 root with WebSocket, Toast, and ShortcutRegistry providers wrapping a custom client-side router.

```
RouterProvider (src/client/router.tsx)
  ├── /              → HomePage
  ├── /login         → LoginPage
  ├── /:ns           → NamespacePage
  ├── /:ns/:id       → PipelinePage
  ├── /:ns/:id/config → ConfigPage
  └── /:ns/:id/runs/:runId → RunPage
```

Data fetched via `useFetch` hook (5-minute cache, request dedup). 401 responses redirect to `/login`. Keyboard-driven navigation via shortcut registry (`src/client/keyboard.tsx`) with command palette and vim-style shortcuts.

**Server/client boundary:** Client code may only import from `src/types.ts` and `src/client/`. Server-only modules must not be imported — Bun's bundler would pull in `bun:sqlite` and Node APIs.

## Pipeline Config System

### Loading

```
Env vars                          GitHub / local FS
TRIGGER_NAMESPACES=prod,staging      ┌───────────┐
TRIGGER_PROD_CONFIG=https://...  ──▶ │ loader.ts │ ──▶ YAML.parse ──▶ Zod validate ──▶ NamespaceConfig[]
TRIGGER_STAGING_CONFIG=./local   ──▶ └───────────┘
```

- `namespace.ts` reads env vars → `NamespaceSource[]`. `loader.ts` fetches each config (GitHub URLs → `raw.githubusercontent.com`, local paths via `Bun.file()`).
- YAML parsed and Zod-validated (`schema.ts`). Template references cross-validated at load time.
- Cached in memory with 60s TTL per namespace, lazily refreshed on access. Namespace failures show an error badge without affecting other namespaces.

### Template resolution

Templates are resolved at **execution time**, not load time. `src/config/template.ts` handles:

- **`{{vars.X}}`** — namespace `vars` object (type-preserving: full-string templates retain arrays/objects)
- **`{{param.X}}`** / **`{{param.X|fallback}}`** — runtime parameters
- **`{{env.X}}`** — environment variables (prefixed by `TRIGGER_ENV_PREFIX`)
- **`$switch`** — conditional: selects a case based on a param value

## Pipeline Execution

The executor (`src/pipeline/executor.ts`) uses a two-phase model:

**Phase 1 (synchronous):** Checks concurrency limits (per-pipeline default 1, global `MAX_CONCURRENT_RUNS` default 10 — returns 409 if full), reserves a slot in `activePipelines: Map<string, ActivePipeline[]>`, creates DB records, publishes `run:started`, returns `runId` immediately.

**Phase 2 (fire-and-forget):** Iterates steps sequentially — resolves templates, opens log file, executes action handler. On failure: remaining steps skipped, run marked failed. Safety timeout (default 1h, configurable) aborts long runs. Cleanup removes from `activePipelines`.

**Cancellation & recovery:** `cancelPipeline(runId)` aborts via `AbortController` — handlers receive the signal for cleanup. Graceful shutdown aborts all active pipelines. On startup, `recoverStaleRuns()` marks orphaned `running`/`pending` runs as `failed`.

### Action handlers

Each action default-exports `defineAction({ name, schema, handler })` with an inline Zod schema. All import from `src/pipeline/types.ts`. The handler receives `config` (resolved action config) and `ctx: ActionContext` (`{ runId, stepId, region, signal, log, warn, executePipeline? }`).

Handlers are long-running async functions that poll APIs, stream logs, and respect the abort signal. Unknown actions are skipped gracefully. `trigger-pipeline` is the exception — it imports app internals to orchestrate cross-pipeline execution with circular dependency detection.

**SDK:** `packages/trigger-sdk/index.ts` re-exports from `src/pipeline/types.ts`. Custom plugins import `{ defineAction, z }` from `"@saanuregh/trigger-sdk"`.

**AWS clients:** Lazily created per region and cached in module-level `Map`s — avoids import-time failures when credentials aren't configured.

## Real-time Updates (WebSocket)

`src/events.ts` provides an in-memory pub/sub bus — topics are `runId` (step/log events) or `"global"` (cross-run events). Max 100 listeners per topic.

The `/ws` endpoint (`src/server/ws.ts`) uses Bun's native websocket handler. Single persistent connection per client:

- **Global:** On connect, sends `SystemStatus`. Broadcasts `run:started`/`run:completed` to all clients.
- **Per-run:** Client sends `subscribe`/`unsubscribe` messages to stream `log`, `step`, and status events for a specific run. Re-checks terminal status after subscribe to avoid races.
- **Auth:** When OIDC is enabled, session verified at upgrade time; namespace access checked per-subscription.

Client-side (`src/client/ws.tsx`): `WebSocketProvider` with `useStatus`, `useSubscription`, and `useGlobalEvents` hooks. Browser notifications on pipeline completion.

## Database

SQLite via `bun:sqlite` with WAL mode, stored at `$DATA_DIR/trigger.db`.

**Tables:**

```sql
pipeline_runs (id, namespace, pipeline_id, pipeline_name, status, params, started_at, finished_at, error, dry_run, triggered_by, call_stack)
pipeline_steps (id, run_id, step_id, step_name, action, status, started_at, finished_at, output, error, log_file)
schedule_history (id, namespace, pipeline_id, schedule_index, cron, fired_at, run_id, status, skip_reason)
```

**Indexes:** namespace+pipeline_id, status, run_id (for steps), namespace+pipeline_id+started_at DESC (paginated listing), and namespace+pipeline_id+fired_at DESC (schedule history).

Migrations are versioned via `PRAGMA user_version` and auto-applied at startup. A bootstrap detector handles existing databases that predate the versioning system by inspecting table columns to determine the actual schema version.

## Authentication & Authorization (src/auth/)

Opt-in via `OIDC_ISSUER`. When unset, all requests get a stub super-admin session (for VPN/private network deployment). When enabled: OIDC auth code flow → HMAC-SHA256 signed session cookie (24h TTL) → group-based ACLs at namespace and pipeline level. `TRIGGER_ADMINS` emails bypass all ACLs. See `SECURITY.md` for details.

## Other Systems

- **Logging:** Pino-style JSON logger (`src/logger.ts`) outputs to stdout. Step logs written to `$DATA_DIR/logs/<runId>/` and streamed via WebSocket. Old logs auto-cleaned per `LOG_RETENTION_DAYS`.
- **Scheduling:** `src/scheduler.ts` — 30s tick loop fires cron-matched pipelines. Crash recovery re-fires missed schedules within a 5-minute window. Events tracked in `schedule_history` table.
- **Build:** `build.ts` uses `Bun.build()` — entries `index.ts` + `public/index.html`, target `bun`, output `dist/`. Requires explicit `bun-plugin-tailwind` (the `bunfig.toml` plugin only applies to dev server).
