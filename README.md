# Trigger

Trigger and monitor deployment pipelines. Declarative YAML pipeline configs fetched from GitHub repos at runtime, with a web UI for triggering runs and streaming logs in real time.

## Stack

- **Runtime:** [Bun](https://bun.sh) 1.3+
- **CLI:** `index.ts` dispatches subcommands (`start`, `validate`) via `util.parseArgs`
- **Server:** Raw `Bun.serve()` with route-map API (no framework) in `src/server/`
- **Frontend:** React 19 (client-side SPA), SWR, Tailwind CSS 4, Lucide icons
- **Database:** SQLite via `bun:sqlite` (WAL mode)
- **Real-time:** Server-Sent Events (SSE)
- **Auth:** Opt-in OIDC SSO with group-based ACLs
- **Infra actions:** AWS CodeBuild, ECS (restart + run task), CloudWatch Logs, Cloudflare cache purge

## Prerequisites

[mise](https://mise.jdx.dev/) is used for toolchain management. Run `mise install` to get the correct Bun version (see `mise.toml`).

## Setup

```bash
bun install
cp .env.example .env   # edit with your values
```

## Development

```bash
bun run dev       # server with hot reload + Tailwind (via bun-plugin-tailwind)
```

## Production

```bash
bun run build     # bundle server + client assets into dist/
bun run start     # cd dist && bun index.js start
```

Or via Docker:

```bash
docker build -t trigger .
docker run -p 3000:3000 --env-file .env trigger
```

## Configuration

All config is via environment variables. See `.env.example` for the full list.

### Namespaces

Each namespace points to a YAML config file — either a GitHub file URL or a local path:

```
TRIGGER_NAMESPACES=production,staging

TRIGGER_PRODUCTION_CONFIG=https://github.com/saanuregh/trigger/blob/main/examples/configs/production.yaml
TRIGGER_STAGING_CONFIG=https://github.com/saanuregh/trigger/blob/main/examples/configs/staging.yaml
```

GitHub URLs are converted to `raw.githubusercontent.com` URLs at fetch time. A `GITHUB_TOKEN` is needed for private repos.

### Authentication (optional)

Auth is opt-in via OIDC. Without it, the app is designed to run behind a VPN or in a private network.

To enable SSO:

```
OIDC_ISSUER=https://auth.example.com/realms/myapp
OIDC_CLIENT_ID=trigger
OIDC_CLIENT_SECRET=xxx
TRIGGER_ADMINS=admin@example.com,admin2@example.com
```

When enabled, the app supports:
- **OIDC SSO** — authorization code flow with any OpenID Connect provider
- **Group-based ACLs** — restrict namespace/pipeline access to specific groups (configured in YAML)
- **Super admins** — emails in `TRIGGER_ADMINS` bypass all access controls

### Pipeline config files

Config files are YAML. See `examples/configs/` for full working examples. A config declares a namespace with shared vars and one or more pipelines:

```yaml
namespace: production
display_name: Production
aws_region: ap-south-1

vars:
  cluster: prod-cluster
  subnets: [subnet-abc, subnet-def]

pipelines:
  - id: deploy-api
    name: Deploy API
    confirm: true
    params:
      - name: branch
        label: Branch
        type: string
        default: main
    steps:
      - id: build
        name: Build
        action: codebuild
        config:
          project_name: api-build
          source_version: "{{param.branch|main}}"
      - id: restart
        name: Restart
        action: ecs-restart
        config:
          cluster: "{{vars.cluster}}"
          services: [api-service]
```

Key config features:
- **`{{vars.X}}`** — reference shared variables (type-preserving: arrays stay arrays)
- **`{{param.X}}`** — resolve to runtime parameter values
- **`{{param.X|default}}`** — parameter with fallback
- **`$switch`** — conditional config based on a parameter value
- **Schema validation** — configs are validated at load time against a JSON Schema

### Built-in actions

| Action | Description |
|--------|-------------|
| `codebuild` | Start AWS CodeBuild project, stream CloudWatch logs, wait for completion |
| `ecs-restart` | Force new ECS deployment, wait for service stability |
| `ecs-task` | Run one-off ECS Fargate/EC2 task, stream logs, wait for exit |
| `cloudflare-purge` | Purge Cloudflare cache by URL list or purge everything |
| `trigger-pipeline` | Trigger another pipeline (with circular dependency detection) |

### Custom actions

Drop a `.ts` file into the actions directory (default `./actions/`, set via `ACTIONS_DIR`):

```ts
import { defineAction, z } from "trigger-sdk";

export default defineAction({
  name: "slack-notify",
  schema: z.object({ webhook_url: z.string().url(), message: z.string() }).strict(),
  handler: async (config, ctx) => {
    // ...
    return { output: { ok: true } };
  },
});
```

Custom actions are auto-discovered at startup. See `examples/custom-actions/` for a full example.

## JSON Schema

A dynamic JSON Schema is served at `/api/config/schema` — it includes per-action config typing for all registered actions (builtin + custom) with `$switch` support. Use it for editor validation:

```yaml
# yaml-language-server: $schema=http://localhost:3000/api/config/schema
```

## Validation

Validate config files against the schema without starting the server:

```bash
bun run validate                           # validates examples/configs/*.yaml
bun index.ts validate path/to/config.yaml  # validate specific files
```

## Type-checking

```bash
bun run typecheck
```

## License

[MIT](LICENSE)
