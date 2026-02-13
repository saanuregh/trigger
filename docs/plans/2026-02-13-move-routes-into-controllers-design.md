# Move Routes into Controllers

## Goal

Split the monolithic `src/server/routes.ts` (~490 lines) into domain-based controller files while keeping `routes.ts` as a thin, readable route map.

## Approach: Explicit Route Map (Approach A)

Controllers export named handler functions. `routes.ts` imports and maps them to paths — the full routing table stays visible in one file.

## Structure

```
src/server/
  routes.ts                # Thin route map (~50 lines) + fetch/error fallbacks
  controllers/
    helpers.ts             # Shared utilities, types, constants
    auth.ts                # Auth flow handlers
    pipelines.ts           # Pipeline CRUD + trigger + config listing
    runs.ts                # Run listing, detail, logs, cancel, SSE
    config.ts              # Schema + refresh endpoints
```

## File Breakdown

### `controllers/helpers.ts`

Shared across controllers:
- `getConfigs()`, `findNsConfig()`, `checkPipelineAccess()`, `toClientConfigs()`, `toStepSummary()`
- `RouteRequest` type, `SSE_HEADERS`, `sseFormat()`, `terminalSSEResponse()`
- Constants: `MAX_LOG_LINES`, `OAUTH_STATE_COOKIE`

### `controllers/auth.ts`

| Export | Route | Method |
|--------|-------|--------|
| `info` | `/api/auth/info` | GET |
| `login` | `/auth/login` | GET |
| `callback` | `/auth/callback` | GET |
| `me` | `/api/me` | GET |
| `logout` | `/api/auth/logout` | POST |

### `controllers/pipelines.ts`

| Export | Route | Method |
|--------|-------|--------|
| `listConfigs` | `/api/configs` | GET |
| `getPipeline` | `/api/pipelines/:ns/:id` | GET |
| `getPipelineConfig` | `/api/pipelines/:ns/:id/config` | GET |
| `triggerPipeline` | `/api/pipelines/:ns/:id/run` | POST |

### `controllers/runs.ts`

| Export | Route | Method |
|--------|-------|--------|
| `listRuns` | `/api/runs` | GET |
| `getRun` | `/api/runs/:runId` | GET |
| `getRunLogs` | `/api/runs/:runId/logs` | GET |
| `cancelRun` | `/api/runs/:runId/cancel` | POST |
| `sseRun` | `/sse/runs/:runId` | GET |

### `controllers/config.ts`

| Export | Route | Method |
|--------|-------|--------|
| `getConfigSchema` | `/api/config/schema` | GET |
| `refreshConfig` | `/api/config/refresh` | POST |

## Key Decisions

- **`authed()` wrapping stays in controllers** — auth concerns visible at handler level.
- **`/api/configs` lives in `pipelines.ts`** as `listConfigs` — it returns pipeline config summaries.
- **`/health` stays inline** in routes.ts — one-liner, not worth a controller.
- **`configJsonSchema`** computed constant moves to `config.ts` controller.
