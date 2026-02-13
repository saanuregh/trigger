import {
  loadAllConfigs,
  getCachedConfigs,
  refreshNamespace,
} from "../config/loader.ts";
import {
  executePipeline,
  cancelPipeline,
  PipelineError,
} from "../pipeline/executor.ts";
import * as db from "../db/queries.ts";
import { subscribe } from "../events.ts";
import { logger } from "../logger.ts";
import { env } from "../env.ts";
import type { NamespaceConfig } from "../config/types.ts";
import { TERMINAL_STATUSES, errorMessage } from "../types.ts";
import type {
  LogLine,
  NamespaceConfigSummary,
  PaginatedResponse,
  RunRow,
} from "../types.ts";
import { z } from "zod";
import { pipelineConfigSchema } from "../config/schema.ts";

import homepage from "../../public/index.html";
import namespacePage from "../../public/namespace.html";
import pipelinePage from "../../public/pipeline.html";
import configPage from "../../public/config.html";
import runPage from "../../public/run.html";

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

function findPipeline(configs: NamespaceConfig[], ns: string, id: string) {
  const nsConfig = configs.find((c) => c.namespace === ns);
  if (!nsConfig)
    return {
      error: Response.json({ error: "Namespace not found" }, { status: 404 }),
    } as const;

  const pipeline = nsConfig.pipelines.find((p) => p.id === id);
  if (!pipeline)
    return {
      error: Response.json({ error: "Pipeline not found" }, { status: 404 }),
    } as const;

  return { pipeline } as const;
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

export const routes = {
  "/": homepage,
  "/:ns": namespacePage,
  "/:ns/:pipeline": pipelinePage,
  "/:ns/:pipeline/config": configPage,
  "/:ns/:pipeline/runs/:runId": runPage,

  "/health": () => Response.json({ status: "ok" }),

  "/api/configs": async () => {
    const configs = await getConfigs();
    return Response.json(toClientConfigs(configs));
  },

  "/api/runs": (req: RouteRequest) => {
    const url = new URL(req.url);
    const namespace = url.searchParams.get("ns") || undefined;
    const pipeline_id = url.searchParams.get("pipeline_id") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const per_page = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("per_page")) || 20),
    );

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
  },

  "/api/runs/:runId": (req: RouteRequest) => {
    const { runId } = req.params;
    const run = db.getRun(runId!);
    if (!run)
      return Response.json({ error: "Run not found" }, { status: 404 });

    const steps = db.getStepsForRun(runId!);
    return Response.json({ run, steps });
  },

  "/api/runs/:runId/logs": async (req: RouteRequest) => {
    const { runId } = req.params;
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
          lines.push({ level: "info", time: "", msg: raw, runId: runId!, stepId: step.step_id, step: step.step_name, action: step.action, stepIndex: 0, totalSteps: 0 });
        }
        if (lines.length >= MAX_LOG_LINES) break;
      }
      if (lines.length >= MAX_LOG_LINES) break;
    }

    return Response.json({ lines, truncated: lines.length >= MAX_LOG_LINES });
  },

  "/api/pipelines/:ns/:id": async (req: RouteRequest) => {
    const { ns, id } = req.params;
    const configs = await refreshNamespace(ns!).catch((err) => {
      logger.warn({ namespace: ns, error: errorMessage(err) }, "config refresh failed, using cache");
      return getConfigs();
    });
    const result = findPipeline(configs, ns!, id!);
    if ("error" in result) return result.error;

    const { pipeline } = result;
    return Response.json({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      confirm: pipeline.confirm,
      params: pipeline.params,
      steps: pipeline.steps.map(toStepSummary),
    });
  },

  "/api/pipelines/:ns/:id/config": async (req: RouteRequest) => {
    const { ns, id } = req.params;
    const configs = await getConfigs();
    const result = findPipeline(configs, ns!, id!);
    if ("error" in result) return result.error;

    const { pipeline } = result;
    return Response.json({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      params: pipeline.params,
      steps: pipeline.steps.map((s) => ({
        ...toStepSummary(s),
        config: s.config,
      })),
    });
  },

  "/api/pipelines/:ns/:id/run": {
    POST: async (req: RouteRequest) => {
      const { ns, id } = req.params;
      try {
        const body = (await req.json()) as {
          params?: Record<string, string | boolean>;
          dryRun?: boolean;
        };
        const runId = await executePipeline(ns!, id!, body.params ?? {}, {
          dryRun: body.dryRun ?? false,
        });
        logger.info({ namespace: ns, pipelineId: id, runId, dryRun: body.dryRun ?? false }, "pipeline triggered");
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
    },
  },

  "/api/runs/:runId/cancel": {
    POST: (req: RouteRequest) => {
      const { runId } = req.params;
      const cancelled = cancelPipeline(runId!);
      if (!cancelled) {
        logger.warn({ runId }, "cancel requested for inactive run");
        return Response.json(
          { error: "Run not found or not active" },
          { status: 404 },
        );
      }
      logger.info({ runId }, "pipeline cancellation requested");
      return Response.json({ ok: true });
    },
  },

  "/api/config/schema": () => Response.json(configJsonSchema),

  "/api/config/refresh": {
    POST: async () => {
      logger.info("config refresh requested");
      await loadAllConfigs(true);
      return Response.json({ ok: true });
    },
  },

  "/sse/runs/:runId": (req: RouteRequest) => {
    const { runId } = req.params;

    const run = db.getRun(runId!);
    if (!run) {
      logger.warn({ runId }, "SSE connection for unknown run");
      return new Response("Run not found", { status: 404 });
    }

    if (TERMINAL_STATUSES.has(run.status)) return terminalSSEResponse(run.status);

    logger.info({ runId, status: run.status }, "SSE client connected");
    const ac = new AbortController();

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        function send(event: string, data: object) {
          try { controller.enqueue(encoder.encode(sseFormat(event, data))); }
          catch { ac.abort(); }
        }

        function closeStream() {
          ac.abort();
          try { controller.close(); } catch {}
        }

        const heartbeatTimer = setInterval(() => {
          try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
          catch { ac.abort(); }
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

        ac.signal.addEventListener("abort", () => {
          unsubscribe();
          clearInterval(heartbeatTimer);
        }, { once: true });

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
  },
};

export function fetch(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/sse/")) {
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
