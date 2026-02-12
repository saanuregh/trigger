# Trigger

## Runtime

Use Bun for everything. Bun auto-loads `.env`.

- `bun run dev` — server with hot reload (Tailwind processed via `bun-plugin-tailwind`)
- `bun run build` — production bundle into `dist/`
- `bun run start` — `cd dist && bun index.js`

> **Note:** `bun run start` uses `cd dist` because Bun resolves bundled HTML asset paths relative to CWD, not the script location.
- `bun run typecheck` — type-check (`bunx tsc --noEmit`)

## Architecture

- **Server:** Raw `Bun.serve()` with `routes` API (no framework). Entry point: `index.ts`. HTML page shells served via Bun's fullstack bundler.
- **Frontend:** Client-side React 19 MPA. No SSR — components fetch JSON APIs on mount via SWR. Pages are separate HTML shells in `public/` with React entry points in `src/client/`.
- **Database:** `bun:sqlite` with WAL mode. Schema in `src/db/index.ts`, queries in `src/db/queries.ts`.
- **Real-time:** SSE via raw `ReadableStream` on server, `EventSource` on client. In-memory pub/sub in `src/events.ts`. Browser notifications (Web Notifications API) fire on pipeline completion.
- **Config:** Declarative JSONC pipeline configs fetched from GitHub raw content API (single HTTP request per file). Local paths also supported. Validated at load time via Zod schemas (`src/config/schema.ts`) with cross-field template reference validation. Template strings resolved at execution time.

## File structure

```
index.ts                      # Bun.serve() routes, SSE, startup
build.ts                      # Production build script
Dockerfile                    # Container image build
bunfig.toml                   # Bun config (dev Tailwind plugin)
tsconfig.json                 # TypeScript config (strict, noEmit)
mise.toml                     # Toolchain versions (Bun 1.3)
playwright.config.ts          # E2E test config
.env.example                  # Env var reference
public/                       # HTML page shells (each loads one React entry point)
src/
  types.ts                    # Shared types (imported by server + client)
  env.ts                      # Env var access
  events.ts                   # In-memory pub/sub event bus
  input.css                   # Tailwind CSS entry point
  config/
    schema.ts                 # Zod schemas + inferred types (single source of truth)
    types.ts                  # Re-exports from schema.ts + resolved action config types
    namespace.ts              # Env → namespace source resolution
    loader.ts                 # Fetch, parse, validate JSONC configs
    template.ts               # {{param.X}}, {{vars.X}}, $switch resolution
  db/
    index.ts                  # SQLite init, migrations
    queries.ts                # Run/step CRUD operations
  pipeline/
    types.ts                  # ActionContext, ActionHandler, ActivePipeline
    executor.ts               # Pipeline execution engine
    actions/                  # One file per action type
      codebuild.ts            # AWS CodeBuild: start, stream logs, poll
      ecs-restart.ts          # ECS force new deployment
      ecs-task.ts             # ECS run one-off Fargate/EC2 task
      cloudflare.ts           # Cloudflare cache purge
      trigger-pipeline.ts     # Trigger another pipeline
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
examples/trigger/             # Example JSONC config files
```

## Key conventions

- JSX uses `react-jsx` automatic runtime — no `import React` needed.
- Shared types in `src/types.ts` — imported by both server and client. Client code must NOT import from `src/db/`, `src/pipeline/`, or `src/config/` (server-only modules).
- Pipeline actions are in `src/pipeline/actions/`. Each exports a single async function matching the `ActionHandler` type.
- AWS clients use lazy initialization (created on first use per region, not at module load).
- Status types (`RunStatus`, `StepStatus`) are defined in `src/types.ts`.
- MPA approach: each page is a separate HTML shell + React entry point. Navigation via `<a>` tags, not client-side routing.
- One active run per pipeline (keyed on `namespace:pipelineId`). Concurrent trigger returns 409.

## Adding a new pipeline action

1. Add the Zod schema in `src/config/schema.ts` — add to `stepConfig` union and `actionName` enum.
2. Add the resolved config interface in `src/config/types.ts` and add it to `ActionConfigMap`.
3. Create the handler in `src/pipeline/actions/your-action.ts` — export an async function matching `ActionHandler<"your-action">`.
4. Register it in the `actionHandlers` map in `src/pipeline/executor.ts`.

## Config format

Pipeline configs are JSONC files. Key features:
- **Vars:** `vars` object for shared constants, referenced as `{{vars.name}}`.
- **Params:** `{{param.name}}` resolves to runtime parameter values. `{{param.name|default}}` provides a fallback.
- **Type preservation:** A full-string template like `"{{vars.subnets}}"` preserves the resolved type (array stays array).
- **`$switch`:** Conditional config — `{ "$switch": "param_name", "cases": { ... }, "default": { ... } }`.
- **Schema:** Validated at load time via Zod. JSON Schema auto-generated at `/api/config/schema` via `z.toJSONSchema()`.
- **Template validation:** `{{vars.X}}` and `{{param.X}}` references are cross-validated at load time — typos caught immediately.

## Environment

- All config via env vars — see `.env.example`.
- No authentication — designed for a trusted/private network.
- `GITHUB_TOKEN` — for fetching configs from private repos.
- `TRIGGER_{NS}_CONFIG` — a GitHub file URL (`https://github.com/owner/repo/blob/branch/path`) or a local file path.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` — optional, only needed for `cloudflare-purge` actions.
- `PORT` — server port (default `3000`).
- `DATA_DIR` — SQLite database and log file directory (default `./data`).

## Testing

- `bunx playwright test` — run E2E tests (Chromium only).
- Test config in `playwright.config.ts`.
- No unit test framework configured — project relies on TypeScript strict mode + E2E.

## Docker

- `docker build -t trigger .` — multi-stage build (installs, typechecks, bundles).
- `docker run -p 3000:3000 --env-file .env trigger` — run with env vars.
