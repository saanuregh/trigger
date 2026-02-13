import { authed, canAccessNamespace } from "../../auth/access.ts";
import * as db from "../../db/queries.ts";
import { subscribe } from "../../events.ts";
import { logger } from "../../logger.ts";
import { cancelPipeline } from "../../pipeline/executor.ts";
import type { LogLine, PaginatedResponse, RunRow } from "../../types.ts";
import { TERMINAL_STATUSES } from "../../types.ts";
import { findNsConfig, getConfigs, MAX_LOG_LINES, SSE_HEADERS, sseFormat, terminalSSEResponse } from "./helpers.ts";

export const listRuns = authed(async (req, session) => {
  const url = new URL(req.url);
  const namespace = url.searchParams.get("ns") || undefined;
  const pipeline_id = url.searchParams.get("pipeline_id") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const per_page = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page")) || 20));

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
});

export const getRun = authed(async (req, session) => {
  const { runId } = req.params;
  const run = db.getRun(runId!);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

  const configs = await getConfigs();
  const nsConfig = findNsConfig(configs, run.namespace);
  if (nsConfig && !canAccessNamespace(session, nsConfig)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const steps = db.getStepsForRun(runId!);
  return Response.json({ run, steps });
});

export const getRunLogs = authed(async (req, session) => {
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
});

export const cancelRun = authed(async (req, session) => {
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
});

export const sseRun = authed(async (req, session) => {
  const { runId } = req.params;

  const run = db.getRun(runId!);
  if (!run) {
    logger.warn({ runId }, "SSE connection for unknown run");
    return new Response("Run not found", { status: 404 });
  }

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
});
