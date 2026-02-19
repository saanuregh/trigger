import { authed } from "../../auth/access.ts";
import * as db from "../../db/queries.ts";
import { logger } from "../../logger.ts";
import { cancelPipeline, retryRun as retryRunFn } from "../../pipeline/executor.ts";
import type {
  ErrorResponse,
  LogLine,
  OkResponse,
  PaginatedResponse,
  RunDetailResponse,
  RunIdResponse,
  RunLogsResponse,
  RunRow,
} from "../../types.ts";
import { listRunsQuerySchema, validateQuery } from "../validation.ts";
import { checkNamespaceAccess, getRunWithAccess, handlePipelineError, MAX_LOG_LINES } from "./helpers.ts";

export const listRuns = authed(async (req, session) => {
  const url = new URL(req.url);
  const validation = validateQuery(url, listRunsQuerySchema);
  if (!validation.success) {
    return Response.json({ error: validation.error } satisfies ErrorResponse, { status: 400 });
  }

  const { ns: namespace, pipeline_id, status, page, per_page } = validation.data;

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
  return Response.json({ run: result.run, steps } satisfies RunDetailResponse);
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

    // Stream file in chunks via Reader API to avoid loading entire log into memory
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) buffer += decoder.decode(result.value, { stream: !done });
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const raw = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (raw) {
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
        newlineIdx = buffer.indexOf("\n");
      }
      if (lines.length >= MAX_LOG_LINES) break;
    }
    if (lines.length >= MAX_LOG_LINES) break;
  }

  return Response.json({ lines, truncated: lines.length >= MAX_LOG_LINES } satisfies RunLogsResponse);
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
  logger.info({ runId, cancelledBy: session.email || undefined }, "pipeline cancellation requested");
  return Response.json({ ok: true } satisfies OkResponse);
});

export const retryRun = authed(async (req, session) => {
  const { runId } = req.params;
  const result = await getRunWithAccess(runId!, session);
  if ("error" in result) return result.error;

  try {
    const resultId = await retryRunFn(runId!, { triggeredBy: session.email || undefined });
    logger.info({ runId, retriedBy: session.email || undefined }, "pipeline retry requested");
    return Response.json({ runId: resultId } satisfies RunIdResponse);
  } catch (err) {
    return handlePipelineError(err, { runId }, "retry");
  }
});
