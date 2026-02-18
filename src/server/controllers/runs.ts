import { authed } from "../../auth/access.ts";
import * as db from "../../db/queries.ts";
import { logger } from "../../logger.ts";
import { cancelPipeline, PipelineError, retryRun as retryRunFn } from "../../pipeline/executor.ts";
import { errorMessage, type LogLine, type PaginatedResponse, type RunRow } from "../../types.ts";
import { checkNamespaceAccess, getRunWithAccess, MAX_LOG_LINES } from "./helpers.ts";

export const listRuns = authed(async (req, session) => {
  const url = new URL(req.url);
  const namespace = url.searchParams.get("ns") || undefined;
  const pipeline_id = url.searchParams.get("pipeline_id") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const per_page = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page")) || 20));

  if (namespace) {
    const denied = await checkNamespaceAccess(session, namespace);
    if (denied) return denied;
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
  const result = await getRunWithAccess(req.params.runId!, session);
  if ("error" in result) return result.error;

  const steps = db.getStepsForRun(req.params.runId!);
  return Response.json({ run: result.run, steps });
});

export const getRunLogs = authed(async (req, session) => {
  const { runId } = req.params;
  const result = await getRunWithAccess(runId!, session);
  if ("error" in result) return result.error;

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
  const result = await getRunWithAccess(runId!, session);
  if ("error" in result) return result.error;

  const cancelled = cancelPipeline(runId!);
  if (!cancelled) {
    logger.warn({ runId }, "cancel requested for inactive run");
    return Response.json({ error: "Run not active" }, { status: 404 });
  }
  logger.info({ runId, cancelledBy: session.email }, "pipeline cancellation requested");
  return Response.json({ ok: true });
});

export const retryRun = authed(async (req, session) => {
  const { runId } = req.params;
  const result = await getRunWithAccess(runId!, session);
  if ("error" in result) return result.error;

  try {
    const resultId = await retryRunFn(runId!, { triggeredBy: session.email || undefined });
    logger.info({ runId, retriedBy: session.email }, "pipeline retry requested");
    return Response.json({ runId: resultId });
  } catch (err) {
    const msg = errorMessage(err);
    const status = err instanceof PipelineError ? err.statusCode : 500;
    if (status >= 500) {
      logger.error({ runId, error: msg, status }, "pipeline retry failed");
    } else {
      logger.warn({ runId, error: msg, status }, "pipeline retry rejected");
    }
    return Response.json({ error: msg }, { status });
  }
});
