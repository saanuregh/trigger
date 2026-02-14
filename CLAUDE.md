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

- **CLI:** `index.ts` is the entry point (`start`, `validate` subcommands) using `util.parseArgs`. Server code lives in `src/server/`.
- **Server:** Raw `Bun.serve()` with `routes` API (no framework). Server lifecycle in `src/server/index.ts`, route handlers in `src/server/routes.ts`. HTML page shells served via Bun's fullstack bundler.
- **Frontend:** Client-side React 19 MPA. No SSR — components fetch JSON APIs on mount via SWR. Pages are separate HTML shells in `public/` with React entry points in `src/client/`.
- **Database:** `bun:sqlite` with WAL mode. Schema in `src/db/index.ts`, queries in `src/db/queries.ts`.
- **Real-time:** SSE via raw `ReadableStream` on server, `EventSource` on client. In-memory pub/sub in `src/events.ts`. Browser notifications (Web Notifications API) fire on pipeline completion.
- **Config:** Declarative YAML pipeline configs fetched from GitHub raw content API (single HTTP request per file). Local paths also supported. Validated at load time via Zod schemas (`src/config/schema.ts`) with cross-field template reference validation. Template strings resolved at execution time.
- **Actions:** Unified `defineAction({ name, schema, handler })` API for both built-in and custom actions. Each action file is self-contained with its own Zod schema. Discovered via action registry at startup.

## File structure

```
index.ts                      # CLI entry point (start, validate subcommands)
build.ts                      # Production build script
Dockerfile                    # Container image build
bunfig.toml                   # Bun config (dev Tailwind plugin)
tsconfig.json                 # TypeScript config (strict, noEmit)
mise.toml                     # Toolchain versions (Bun 1.3)
.env.example                  # Env var reference
public/                       # HTML page shells (each loads one React entry point)
packages/
  trigger-sdk/
    index.ts                  # SDK re-exports from src/pipeline/types.ts (z, defineAction, template helpers)
src/
  server/
    index.ts                  # startServer(): Bun.serve lifecycle, startup, shutdown
    routes.ts                 # Route map (path → controller handler) + fetch/error fallbacks
    controllers/
      helpers.ts              # Shared utilities: getConfigs, findNsConfig, SSE helpers, types
      auth.ts                 # Auth flow handlers (login, callback, logout, me)
      pipelines.ts            # Pipeline CRUD + trigger + config listing
      runs.ts                 # Run listing, detail, logs, cancel, SSE streaming
      config.ts               # Dynamic JSON Schema endpoint + config refresh
  types.ts                    # Shared types (imported by server + client)
  env.ts                      # Env var access
  events.ts                   # In-memory pub/sub event bus
  input.css                   # Tailwind CSS entry point
  config/
    schema.ts                 # Template helpers, buildSchema (Zod), buildJSONSchema (editor)
    types.ts                  # Re-exports from schema.ts + resolved action config types
    namespace.ts              # Env → namespace source resolution
    loader.ts                 # Fetch, parse, validate YAML configs + schema caching
    template.ts               # {{param.X}}, {{vars.X}}, $switch resolution
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
    swr.tsx                   # SWR config, fetcher, shared hooks
    home.tsx                  # Home page (namespace list)
    namespace.tsx             # Namespace page (pipeline list)
    pipeline.tsx              # Pipeline page (param form + trigger)
    run.tsx                   # Run detail page (steps + live logs)
    config.tsx                # Pipeline config viewer
    utils.ts                  # Client-side utilities
    components/               # Reusable React components
examples/
  configs/                    # Example YAML pipeline config files
  custom-actions/             # Example custom action plugins
```

## Key conventions

- JSX uses `react-jsx` automatic runtime — no `import React` needed.
- Shared types in `src/types.ts` — imported by both server and client. Client code must NOT import from `src/db/`, `src/pipeline/`, or `src/config/` (server-only modules).
- Pipeline actions are in `src/pipeline/actions/`. Each is self-contained: defines its own Zod schema and default-exports `defineAction({ name, schema, handler })`.
- `src/pipeline/types.ts` is the action API barrel — re-exports `z`, `defineAction`, `ActionContext`, and all template helpers. Both builtin actions and the SDK import from here.
- AWS clients use lazy initialization (created on first use per region, not at module load).
- Status types (`RunStatus`, `StepStatus`) are defined in `src/types.ts`.
- MPA approach: each page is a separate HTML shell + React entry point. Navigation via `<a>` tags, not client-side routing.
- One active run per pipeline (keyed on `namespace:pipelineId`). Concurrent trigger returns 409.
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
- **Vars:** `vars` object for shared constants, referenced as `{{vars.name}}`.
- **Params:** `{{param.name}}` resolves to runtime parameter values. `{{param.name|default}}` provides a fallback.
- **Quoting:** `{{...}}` template strings must be quoted in YAML (`{` is YAML flow mapping syntax).
- **Type preservation:** A full-string template like `"{{vars.subnets}}"` preserves the resolved type (array stays array).
- **`$switch`:** Conditional config — `$switch: param_name` with `cases:` and `default:`.
- **Schema:** Validated at load time via Zod (configs with templates skip per-action validation). Dynamic JSON Schema served at `/api/config/schema` with per-action `if/then` typing and `$switch` support.
- **Template validation:** `{{vars.X}}` and `{{param.X}}` references are cross-validated at load time — typos caught immediately.
- **Editor support:** Add `# yaml-language-server: $schema=http://localhost:3000/api/config/schema` to config files for autocompletion.

## Environment

- All config via env vars — see `.env.example`.
- `GITHUB_TOKEN` — for fetching configs from private repos.
- `TRIGGER_{NS}_CONFIG` — a GitHub file URL (`https://github.com/owner/repo/blob/branch/path`) or a local file path.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` — optional, only needed for `cloudflare-purge` actions.
- `PORT` — server port (default `3000`).
- `DATA_DIR` — SQLite database and log file directory (default `./data`).
- `ACTIONS_DIR` — custom actions directory (default `./actions/`).

## Testing

- No test framework configured — project relies on TypeScript strict mode (`bun run typecheck`), Biome lint (`bun run lint`), and config validation (`bun run validate`).

## Docker

- `docker build -t trigger .` — multi-stage build (installs, typechecks, bundles).
- `docker run -p 3000:3000 --env-file .env trigger` — run with env vars.
