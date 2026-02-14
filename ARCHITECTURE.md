# Architecture

## Overview

Trigger is a single-process Bun application that serves a web UI, exposes JSON APIs, executes infrastructure pipelines, and streams real-time logs — all without external dependencies beyond AWS and Cloudflare APIs.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                            │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Home     │  │ Namespace  │  │ Pipeline │  │ Run (+ logs) │  │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └──────┬───────┘  │
│       │ fetch        │ fetch        │ POST           │ SSE      │
└───────┼──────────────┼──────────────┼────────────────┼──────────┘
        │              │              │                │
┌───────┴──────────────┴──────────────┴────────────────┴──────────┐
│  Bun.serve()  (src/server/)                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Route map: SPA shell, JSON APIs, SSE endpoint, Auth      │   │
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

JSON Schema is served dynamically at `/api/config/schema` — it includes per-action `if/then` typing for all registered actions (builtin + custom) with `$switch` support.

## Server (src/server/)

Server lifecycle lives in `src/server/index.ts`. Route handlers are organized into domain-based controllers under `src/server/controllers/` (auth, pipelines, runs, config), with `src/server/routes.ts` as a thin route map that imports and wires them. A single `Bun.serve()` call with a flat `routes` map. No framework — route handlers are plain functions that return `Response` objects.

**Route types:**

| Pattern | Purpose |
|---------|---------|
| `/*` | SPA HTML shell (Bun-bundled, serves all client routes) |
| `/health` | Health check |
| `/auth/login`, `/auth/callback` | OIDC login flow |
| `/api/auth/info`, `/api/me`, `POST /api/auth/logout` | Auth info endpoints |
| `/api/configs`, `/api/runs`, `/api/runs/:runId`, ... | JSON read APIs |
| `POST /api/pipelines/:ns/:id/run` | Trigger a pipeline |
| `POST /api/runs/:runId/cancel` | Cancel a running pipeline |
| `/api/config/schema`, `POST /api/config/refresh` | Config management |
| `/sse/runs/:runId` | SSE stream for live run updates |

On startup, the server initializes the database, recovers stale runs (marking them as failed), initializes builtin + custom actions, rebuilds the config schema, pre-loads pipeline configs, and (if auth enabled) fetches the OIDC discovery document. On SIGTERM/SIGINT, it cancels all active pipelines, waits 2s for drain, closes the DB, and exits.

## Frontend (SPA)

A single HTML shell (`public/index.html`) loads `src/client/app.tsx`, which mounts a React 19 root with SWR and Toast providers wrapping a custom client-side router.

```
public/index.html  →  src/client/app.tsx  →  RouterProvider (src/client/router.tsx)
                                                ├── /              → HomePage
                                                ├── /login         → LoginPage
                                                ├── /:ns           → NamespacePage
                                                ├── /:ns/:id       → PipelinePage
                                                ├── /:ns/:id/config → ConfigPage
                                                └── /:ns/:id/runs/:runId → RunPage
```

The router (`src/client/router.tsx`) implements pattern matching with named params, a `navigate()` function using `pushState`, and a `<Link>` component that intercepts clicks for client-side navigation. Route params are accessed via `RouteContext`.

Data is fetched client-side via SWR hooks hitting the JSON APIs. 401 responses redirect to `/login`.

**Server/client boundary:** Client code may only import from `src/types.ts` and `src/client/`. Server-only modules (`src/db/`, `src/pipeline/`, `src/config/`, `src/auth/`) must not be imported from client code — Bun's bundler would pull in `bun:sqlite` and Node APIs.

## Pipeline Config System

### Loading

```
Env vars                          GitHub / local FS
TRIGGER_NAMESPACES=prod,staging      ┌───────────┐
TRIGGER_PROD_CONFIG=https://...  ──▶ │ loader.ts │ ──▶ YAML.parse ──▶ Zod validate ──▶ NamespaceConfig[]
TRIGGER_STAGING_CONFIG=./local   ──▶ └───────────┘
```

1. `src/config/namespace.ts` reads env vars to build a `NamespaceSource[]` list.
2. `src/config/loader.ts` fetches each config — GitHub URLs are converted to `raw.githubusercontent.com` URLs (single HTTP GET per file, no git clone). Local paths are read with `Bun.file()`.
3. The YAML text is parsed and validated via Zod schemas (`src/config/schema.ts`). Template references (`{{vars.X}}`, `{{param.X}}`) are cross-validated at load time.
4. Configs are cached in memory with a 60s TTL before re-fetching. A `POST /api/config/refresh` endpoint forces a reload.
5. Individual namespace failures are handled gracefully — the namespace appears in the UI with an error badge, but other namespaces still work.

### Template resolution

Templates are resolved at **execution time**, not load time. This separation means configs are validated structurally at load time but parameterized at run time.

`src/config/template.ts` handles three constructs:

- **`{{vars.X}}`** — resolves to the value from the namespace's `vars` object.
- **`{{param.X}}`** / **`{{param.X|fallback}}`** — resolves to the runtime parameter.
- **`$switch`** — conditional object: selects a case based on a param value.

Type preservation: when the entire string is a single template (e.g., `"{{vars.subnets}}"`), the resolved value retains its original type (array, object, etc.). Mixed templates (`"prefix-{{param.branch}}"`) always resolve to strings.

## Pipeline Execution

### Two-phase model

The executor (`src/pipeline/executor.ts`) splits execution into two phases:

**Phase 1 (synchronous, awaited by the HTTP handler):**
- Concurrency check — only one run per pipeline key (`namespace:pipelineId`). Returns 409 if already running.
- Reserves the pipeline slot in the `activePipelines` map.
- Resolves config, creates DB records for the run and all steps.
- Publishes `run:started` event.
- Returns the `runId` to the client immediately.

**Phase 2 (fire-and-forget, runs in the background):**
- Iterates through steps sequentially.
- For each step: resolves templates, opens a log file, executes the action handler.
- On step failure: marks remaining steps as skipped, marks run as failed.
- On abort signal: marks remaining steps as skipped, marks run as cancelled.
- Safety timeout (default 1 hour, configurable per pipeline) aborts the run if it exceeds the limit.
- Cleanup: removes the pipeline from `activePipelines`.

### Concurrency model

```
activePipelines: Map<string, { runId, AbortController }>

Key = "namespace:pipelineId"
```

- One run at a time per pipeline. The Map acts as both a lock and a registry.
- Cancellation: `cancelPipeline(runId)` calls `abort()` on the controller. Action handlers receive the signal and can clean up (e.g., stop a CodeBuild build).
- Graceful shutdown: `shutdownAll()` aborts every active pipeline and marks them as cancelled in the DB.
- Stale recovery: on startup, `recoverStaleRuns()` marks any `running`/`pending` runs from a previous crash as `failed`.

### Action handlers

Each action is a self-contained file that default-exports `defineAction({ name, schema, handler })`. The Zod config schema is defined inline in the action file — no separate schema file. All actions import `z`, `defineAction`, and template helpers from a single barrel: `src/pipeline/types.ts`.

The handler receives:
- `config` — the resolved (template-expanded) action config, typed by the Zod schema.
- `ctx: ActionContext` — `{ runId, stepId, region, signal, log, warn, executePipeline? }`.

Handlers are long-running async functions that poll AWS APIs, stream logs, and respect the abort signal for cancellation. Unknown actions are handled gracefully — the executor skips the step instead of failing the entire pipeline.

**`trigger-pipeline`** is the exception to self-containment: it imports app internals (`db`, `events`, `types`) because it needs to orchestrate cross-pipeline execution. It calls `ctx.executePipeline()` (injected via ActionContext) and waits for the child run to complete. Circular dependency detection uses a `callStack` array.

### SDK

`packages/trigger-sdk/index.ts` is a pure re-export barrel from `src/pipeline/types.ts`. Custom action plugins import everything they need from `"trigger-sdk"`:

```ts
import { defineAction, z } from "trigger-sdk";
```

The SDK exports: `z`, `defineAction`, `ActionContext`, `CustomActionDefinition`, and all template helpers (`stringOrTemplate`, `numberOrTemplate`, `booleanOrTemplate`, `stringArrayOrTemplate`, `templateString`).

### AWS client pattern

AWS SDK clients are lazily created per region and cached in module-level `Map`s. This avoids creating clients at import time (which would fail if credentials aren't configured) and reuses clients across runs.

## Real-time Updates (SSE)

`src/events.ts` provides an in-memory pub/sub bus with topic-based routing:

- **Topic = `runId`**: Step status changes and log lines for a specific run.
- **Topic = `"global"`**: Cross-run events (e.g., `run:started` for the home page).
- Max 100 listeners per topic (prevents leaks from abandoned connections).

The SSE endpoint (`/sse/runs/:runId`) creates a `ReadableStream` that:
1. Subscribes to the run's topic.
2. Sends `step`, `log`, and `run` events as JSON payloads.
3. Sends keepalive comments every 30s to prevent proxy timeouts.
4. Closes when the run reaches a terminal status.
5. Handles the race condition where a run finishes between the initial check and subscription by re-checking after subscribing.

On the client, the run page requests browser notification permission when the SSE connection opens. When a terminal `run` event arrives (success, failed, or cancelled), a Web Notification is shown with the pipeline name and status. Clicking the notification focuses the tab. Notification helpers live in `src/client/utils.ts`.

## Database

SQLite via `bun:sqlite` with WAL mode, stored at `$DATA_DIR/trigger.db`.

**Tables:**

```sql
pipeline_runs (id, namespace, pipeline_id, pipeline_name, status, params, started_at, finished_at, error, dry_run, triggered_by)
pipeline_steps (id, run_id, step_id, step_name, action, status, started_at, finished_at, output, error, log_file)
```

**Indexes:** namespace+pipeline_id, status, run_id (for steps), and a composite index on namespace+pipeline_id+started_at DESC for the paginated list query.

Migrations are auto-applied at startup. New columns (like `dry_run`) are added via `ALTER TABLE` with a try/catch for idempotency.

## Authentication & Authorization (src/auth/)

Auth is opt-in — when `OIDC_ISSUER` is set, the full auth system activates. When unset, all requests get a stub super-admin session (designed for VPN/private network deployment).

**OIDC flow (`src/auth/oidc.ts`):**
1. `/auth/login` redirects to the OIDC provider with a random `state` param.
2. `/auth/callback` exchanges the code for tokens, extracts user info + groups from the ID token.
3. Session is signed and stored as an HMAC cookie (24h TTL).

**Session management (`src/auth/session.ts`):**
- HMAC-SHA256 signed cookies using `OIDC_CLIENT_SECRET` as the key.
- Payload: email, name, groups, expiry. Base64url-encoded.
- `Secure` flag set in production.

**Access control (`src/auth/access.ts`):**
- `authed()` HOF wraps route handlers — returns 401 if no valid session.
- **Namespace-level ACLs:** `access.groups` in config restricts which groups can see the namespace.
- **Pipeline-level ACLs:** Per-pipeline `access.groups` overrides namespace-level access.
- **Super admins:** Emails in `TRIGGER_ADMINS` bypass all ACLs.
- ACL check is group intersection: user must belong to at least one allowed group.

## Logging

Structured JSON logging via Pino (`src/logger.ts`). All server components log through the shared `logger` instance. Step execution logs are written to individual files (one per step) in `$DATA_DIR/` and streamed via SSE to the browser.

## Build

`build.ts` uses `Bun.build()` with:
- Entry points: `index.ts` + `public/index.html`.
- Target: `bun` (server bundle).
- Plugins: `bun-plugin-tailwind` (required explicitly for production — the `bunfig.toml` `[serve.static]` config only applies to the dev server).
- Output: `dist/`.
- Production run: `cd dist && bun index.js start` (Bun resolves bundled HTML assets relative to CWD).
