import { authed, filterAccessibleConfigs } from "../../auth/access.ts";
import { refreshNamespace } from "../../config/loader.ts";
import { logger } from "../../logger.ts";
import { executePipeline } from "../../pipeline/executor.ts";
import { getScheduleInfo } from "../../scheduler.ts";
import {
  type ErrorResponse,
  errorMessage,
  type ParamDef,
  type PipelineConfigResponse,
  type PipelineResponse,
  type RunIdResponse,
} from "../../types.ts";
import { triggerRunRequestSchema, validateBody } from "../validation.ts";
import { getConfigs, getPipelineWithAccess, handlePipelineError, toClientConfigs, toStepSummary } from "./helpers.ts";

export const listConfigs = authed(async (_req, session) => {
  const configs = await getConfigs();
  const filtered = filterAccessibleConfigs(configs, session);
  return Response.json(toClientConfigs(filtered));
});

export const getPipeline = authed(async (req, session) => {
  const { ns, id } = req.params;
  const configs = await refreshNamespace(ns!).catch((err) => {
    logger.warn({ namespace: ns, error: errorMessage(err) }, "config refresh failed, using cache");
    return getConfigs();
  });
  const result = await getPipelineWithAccess(session, ns!, id!, configs);
  if ("denied" in result) return result.denied;
  const { pipeline } = result;

  return Response.json({
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    confirm: pipeline.confirm,
    concurrency: pipeline.concurrency ?? 1,
    params: pipeline.params,
    steps: pipeline.steps.map(toStepSummary),
    schedule: pipeline.schedule,
  } satisfies PipelineResponse);
});

export const getPipelineConfig = authed(async (req, session) => {
  const { ns, id } = req.params;
  const result = await getPipelineWithAccess(session, ns!, id!);
  if ("denied" in result) return result.denied;
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
  } satisfies PipelineConfigResponse);
});

function validateParams(paramDefs: ParamDef[] | undefined, values: Record<string, string | boolean>): string | null {
  if (!paramDefs || paramDefs.length === 0) return null;

  for (const def of paramDefs) {
    const val = values[def.name];
    if (def.type === "string" && def.required && (val === undefined || val === "")) {
      return `Required parameter "${def.label}" is missing`;
    }
    if (def.type === "boolean" && val !== undefined && typeof val !== "boolean") {
      return `Parameter "${def.label}" must be a boolean`;
    }
    if (def.type === "select") {
      if (def.required && (val === undefined || val === "")) {
        return `Required parameter "${def.label}" is missing`;
      }
      if (val !== undefined && val !== "" && typeof val === "string") {
        const validValues = def.options.map((o) => o.value);
        if (!validValues.includes(val)) {
          return `Invalid value for "${def.label}": "${val}" — must be one of: ${validValues.join(", ")}`;
        }
      }
    }
  }

  return null;
}

export const triggerPipeline = authed(async (req, session) => {
  const { ns, id } = req.params;
  const result = await getPipelineWithAccess(session, ns!, id!);
  if ("denied" in result) return result.denied;

  const validation = await validateBody(req, triggerRunRequestSchema);
  if (!validation.success) {
    return Response.json({ error: validation.error } satisfies ErrorResponse, { status: 400 });
  }

  const body = validation.data;

  const paramError = validateParams(result.pipeline.params, body.params ?? {});
  if (paramError) {
    return Response.json({ error: paramError } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const runId = await executePipeline(ns!, id!, body.params ?? {}, {
      dryRun: body.dryRun ?? false,
      triggeredBy: session.email || undefined,
    });
    logger.info(
      { namespace: ns, pipelineId: id, runId, dryRun: body.dryRun ?? false, triggeredBy: session.email || undefined },
      "pipeline triggered",
    );
    return Response.json({ runId } satisfies RunIdResponse);
  } catch (err) {
    return handlePipelineError(err, { namespace: ns, pipelineId: id }, "trigger");
  }
});

export const getPipelineSchedule = authed(async (req, session) => {
  const { ns, id } = req.params;
  const result = await getPipelineWithAccess(session, ns!, id!);
  if ("denied" in result) return result.denied;

  const info = getScheduleInfo(ns!, id!);
  return Response.json({ schedules: info ?? [] });
});
