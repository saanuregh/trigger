import { z } from "zod";
import appPage from "../../public/index.html";
import { authed, canAccessNamespace, canAccessPipeline, filterAccessibleConfigs } from "../auth/access.ts";
import { exchangeCode, getAuthUrl, getOIDCConfig } from "../auth/oidc.ts";
import type { AuthSession } from "../auth/session.ts";
import { clearSessionCookie, sessionCookieHeader, signSession } from "../auth/session.ts";
import { getCachedConfigs, loadAllConfigs, refreshNamespace } from "../config/loader.ts";
import { pipelineConfigSchema } from "../config/schema.ts";
import type { NamespaceConfig } from "../config/types.ts";
import * as db from "../db/queries.ts";
import { env } from "../env.ts";
import { subscribe } from "../events.ts";
import { logger } from "../logger.ts";
import { cancelPipeline, executePipeline, PipelineError } from "../pipeline/executor.ts";
import type { LogLine, NamespaceConfigSummary, PaginatedResponse, RunRow } from "../types.ts";
import { errorMessage, TERMINAL_STATUSES } from "../types.ts";

const configJsonSchema = z.toJSONSchema(pipelineConfigSchema);

async function getConfigs() {
  return getCachedConfigs() ?? (await loadAllConfigs());
}

function toStepSummary(s: { id: string; name: string; action: string }) {
  return { id: s.id, name: s.name, action: s.action };
}

function toClientConfigs(configs: NamespaceConfig[]): NamespaceConfigSummary[] {
  return configs.map((ns) => ({
    namespace: ns.namespace,
    display_name: ns.display_name,
    pipelines: ns.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      confirm: p.confirm,
      params: p.params,
      steps: p.steps.map(toStepSummary),
    })),
    ...(ns._error && { error: ns._error }),
  }));
}

function findNsConfig(configs: NamespaceConfig[], ns: string) {
  return configs.find((c) => c.namespace === ns);
}

function checkPipelineAccess(
  session: AuthSession,
  nsConfig: NamespaceConfig | undefined,
  pipeline: NamespaceConfig["pipelines"][number] | undefined,
): Response | null {
  if (!nsConfig) return Response.json({ error: "Namespace not found" }, { status: 404 });
  if (!pipeline) return Response.json({ error: "Pipeline not found" }, { status: 404 });
  if (!canAccessPipeline(session, nsConfig, pipeline)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

type RouteRequest = Request & { params: Record<string, string> };

const MAX_LOG_LINES = 50_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

function sseFormat(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function terminalSSEResponse(status: string): Response {
  return new Response(sseFormat("run", { status }), { headers: SSE_HEADERS });
}

const OAUTH_STATE_COOKIE = "trigger_oauth_state";

export const routes = {
  // SPA catch-all — exact/param routes below take precedence (Bun route ordering)
  "/*": appPage,

  "/health": () => Response.json({ status: "ok" }),

  "/api/auth/info": () => Response.json({ enabled: env.authEnabled }),

  "/auth/login": (req: RouteRequest) => {
    if (!env.authEnabled || !getOIDCConfig()) {
      return Response.json({ error: "Auth not configured" }, { status: 501 });
    }

    const url = new URL(req.url);
    const returnUrl = url.searchParams.get("return") ?? "/";
    const state = btoa(JSON.stringify({ returnUrl, nonce: crypto.randomUUID() }));

    const redirectUri = `${url.origin}/auth/callback`;
    const authUrl = getAuthUrl(state, redirectUri);

    const secure = !env.development ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
      },
    });
  },

  "/auth/callback": async (req: RouteRequest) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response(null, { status: 302, headers: { Location: "/login?error=missing_params" } });
    }

    // Validate CSRF state
    const cookies = req.headers.get("cookie") ?? "";
    let savedState = "";
    for (const part of cookies.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === OAUTH_STATE_COOKIE) {
        savedState = rest.join("=");
        break;
      }
    }

    if (savedState !== state) {
      return new Response(null, { status: 302, headers: { Location: "/login?error=invalid_state" } });
    }

    try {
      const redirectUri = `${url.origin}/auth/callback`;
      const user = await exchangeCode(code, redirectUri);
      const sessionCookie = await signSession(user);
      const returnUrl = (JSON.parse(atob(state)).returnUrl as string) ?? "/";

      logger.info({ email: user.email, groups: user.groups }, "user authenticated");

      // Clear oauth state cookie + set session cookie
      const secure = !env.development ? "; Secure" : "";
      return new Response(null, {
        status: 302,
        headers: [
          ["Location", returnUrl],
          ["Set-Cookie", sessionCookieHeader(sessionCookie)],
          ["Set-Cookie", `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`],
        ],
      });
    } catch (err) {
      logger.error({ error: errorMessage(err) }, "auth callback failed");
      return new Response(null, { status: 302, headers: { Location: "/login?error=auth_failed" } });
    }
  },

  "/api/me": authed(async (_req, session) => {
    return Response.json({ email: session.email, name: session.name, groups: session.groups, isSuperAdmin: session.isSuperAdmin });
  }),

  "/api/auth/logout": {
    POST: async (_req: RouteRequest) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": clearSessionCookie(),
        },
      });
    },
  },

  "/api/configs": authed(async (_req, session) => {
    const configs = await getConfigs();
    const filtered = filterAccessibleConfigs(configs, session);
    return Response.json(toClientConfigs(filtered));
  }),

  "/api/runs": authed(async (req, session) => {
    const url = new URL(req.url);
    const namespace = url.searchParams.get("ns") || undefined;
    const pipeline_id = url.searchParams.get("pipeline_id") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const per_page = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page")) || 20));

    // If filtering by namespace, check access
    if (namespace) {
      const configs = await getConfigs();
      const nsConfig = findNsConfig(configs, namespace);
      if (nsConfig && !canAccessNamespace(session, nsConfig)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const filters = { namespace, pipeline_id, status };
    const total = db.countRuns(filters);
    const data = db.listRuns({
      ...filters,
      limit: per_page,
      offset: (page - 1) * per_page,
    });

    return Response.json({
      data,
      total,
      page,
      per_page,
    } satisfies PaginatedResponse<RunRow>);
  }),

  "/api/runs/:runId": authed(async (req, session) => {
    const { runId } = req.params;
    const run = db.getRun(runId!);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

    // Check namespace access
    const configs = await getConfigs();
    const nsConfig = findNsConfig(configs, run.namespace);
    if (nsConfig && !canAccessNamespace(session, nsConfig)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const steps = db.getStepsForRun(runId!);
    return Response.json({ run, steps });
  }),

  "/api/runs/:runId/logs": authed(async (req, session) => {
    const { runId } = req.params;

    const run = db.getRun(runId!);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

    const configs = await getConfigs();
    const nsConfig = findNsConfig(configs, run.namespace);
    if (nsConfig && !canAccessNamespace(session, nsConfig)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const steps = db.getStepsForRun(runId!);
    const lines: LogLine[] = [];

    for (const step of steps) {
      if (!step.log_file) continue;
      const file = Bun.file(step.log_file);
      if (!(await file.exists())) continue;
      const text = await file.text();
      for (const raw of text.split("\n")) {
        if (!raw) continue;
        try {
          lines.push(JSON.parse(raw));
        } catch {
          lines.push({
            level: "info",
            time: "",
            msg: raw,
            runId: runId!,
            stepId: step.step_id,
            step: step.step_name,
            action: step.action,
            stepIndex: 0,
            totalSteps: 0,
          });
        }
        if (lines.length >= MAX_LOG_LINES) break;
      }
      if (lines.length >= MAX_LOG_LINES) break;
    }

    return Response.json({ lines, truncated: lines.length >= MAX_LOG_LINES });
  }),

  "/api/pipelines/:ns/:id": authed(async (req, session) => {
    const { ns, id } = req.params;
    const configs = await refreshNamespace(ns!).catch((err) => {
      logger.warn({ namespace: ns, error: errorMessage(err) }, "config refresh failed, using cache");
      return getConfigs();
    });
    const nsConfig = findNsConfig(configs, ns!);
    const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
    const denied = checkPipelineAccess(session, nsConfig, pipeline);
    if (denied) return denied;

    return Response.json({
      id: pipeline!.id,
      name: pipeline!.name,
      description: pipeline!.description,
      confirm: pipeline!.confirm,
      params: pipeline!.params,
      steps: pipeline!.steps.map(toStepSummary),
    });
  }),

  "/api/pipelines/:ns/:id/config": authed(async (req, session) => {
    const { ns, id } = req.params;
    const configs = await getConfigs();
    const nsConfig = findNsConfig(configs, ns!);
    const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
    const denied = checkPipelineAccess(session, nsConfig, pipeline);
    if (denied) return denied;

    return Response.json({
      id: pipeline!.id,
      name: pipeline!.name,
      description: pipeline!.description,
      params: pipeline!.params,
      steps: pipeline!.steps.map((s) => ({
        ...toStepSummary(s),
        config: s.config,
      })),
    });
  }),

  "/api/pipelines/:ns/:id/run": {
    POST: authed(async (req, session) => {
      const { ns, id } = req.params;

      // Check pipeline access
      const configs = await getConfigs();
      const nsConfig = findNsConfig(configs, ns!);
      const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
      const denied = checkPipelineAccess(session, nsConfig, pipeline);
      if (denied) return denied;

      try {
        const body = (await req.json()) as {
          params?: Record<string, string | boolean>;
          dryRun?: boolean;
        };
        const runId = await executePipeline(ns!, id!, body.params ?? {}, {
          dryRun: body.dryRun ?? false,
          triggeredBy: session.email || undefined,
        });
        logger.info(
          { namespace: ns, pipelineId: id, runId, dryRun: body.dryRun ?? false, triggeredBy: session.email },
          "pipeline triggered",
        );
        return Response.json({ runId });
      } catch (err) {
        const msg = errorMessage(err);
        const status = err instanceof PipelineError ? err.statusCode : 500;
        if (status >= 500) {
          logger.error({ namespace: ns, pipelineId: id, error: msg, status }, "pipeline trigger failed");
        } else {
          logger.warn({ namespace: ns, pipelineId: id, error: msg, status }, "pipeline trigger rejected");
        }
        return Response.json({ error: msg }, { status });
      }
    }),
  },

  "/api/runs/:runId/cancel": {
    POST: authed(async (req, session) => {
      const { runId } = req.params;

      const run = db.getRun(runId!);
      if (run) {
        const configs = await getConfigs();
        const nsConfig = findNsConfig(configs, run.namespace);
        if (nsConfig && !canAccessNamespace(session, nsConfig)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
      }

      const cancelled = cancelPipeline(runId!);
      if (!cancelled) {
        logger.warn({ runId }, "cancel requested for inactive run");
        return Response.json({ error: "Run not found or not active" }, { status: 404 });
      }
      logger.info({ runId, cancelledBy: session.email }, "pipeline cancellation requested");
      return Response.json({ ok: true });
    }),
  },

  "/api/config/schema": () => Response.json(configJsonSchema),

  "/api/config/refresh": {
    POST: authed(async (_req, session) => {
      if (!session.isSuperAdmin) {
        return Response.json({ error: "Forbidden: admin only" }, { status: 403 });
      }
      logger.info({ refreshedBy: session.email }, "config refresh requested");
      await loadAllConfigs(true);
      return Response.json({ ok: true });
    }),
  },

  "/sse/runs/:runId": authed(async (req, session) => {
    const { runId } = req.params;

    const run = db.getRun(runId!);
    if (!run) {
      logger.warn({ runId }, "SSE connection for unknown run");
      return new Response("Run not found", { status: 404 });
    }

    // Check namespace access
    const configs = await getConfigs();
    const nsConfig = findNsConfig(configs, run.namespace);
    if (nsConfig && !canAccessNamespace(session, nsConfig)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (TERMINAL_STATUSES.has(run.status)) return terminalSSEResponse(run.status);

    logger.info({ runId, status: run.status }, "SSE client connected");
    const ac = new AbortController();

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        function send(event: string, data: object) {
          try {
            controller.enqueue(encoder.encode(sseFormat(event, data)));
          } catch {
            ac.abort();
          }
        }

        function closeStream() {
          ac.abort();
          try {
            controller.close();
          } catch {}
        }

        const heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            ac.abort();
          }
        }, 30_000);

        const unsubscribe = subscribe(runId!, (message) => {
          const { type, ...payload } = message;

          if (type === "log") send("log", payload);
          else if (type === "step:status") send("step", payload);
          else if (type === "run:status") {
            send("run", { status: payload.status });
            if (TERMINAL_STATUSES.has(payload.status as string)) closeStream();
          }
        });

        ac.signal.addEventListener(
          "abort",
          () => {
            unsubscribe();
            clearInterval(heartbeatTimer);
          },
          { once: true },
        );

        // Race condition guard: run may have finished between initial check and subscribe
        const freshRun = db.getRun(runId!);
        if (freshRun && TERMINAL_STATUSES.has(freshRun.status)) {
          send("run", { status: freshRun.status });
          closeStream();
        }
      },
      cancel() {
        logger.info({ runId }, "SSE client disconnected");
        ac.abort();
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }),
};

export function fetch(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/sse/") || url.pathname.startsWith("/auth/")) {
    logger.warn({ method: req.method, path: url.pathname }, "unmatched API route");
  }
  return new Response("Not found", { status: 404 });
}

export function error(err: Error) {
  logger.error({ err }, "server error");
  return Response.json(
    {
      error: err.message,
      ...(env.development ? { stack: err.stack } : {}),
    },
    { status: 500 },
  );
}
