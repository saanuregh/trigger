import { authed, filterAccessibleConfigs } from "../../auth/access.ts";
import { refreshNamespace } from "../../config/loader.ts";
import { logger } from "../../logger.ts";
import { executePipeline, PipelineError } from "../../pipeline/executor.ts";
import { type ErrorResponse, errorMessage, type PipelineConfigResponse, type PipelineResponse, type RunIdResponse } from "../../types.ts";
import { triggerRunRequestSchema, validateBody } from "../validation.ts";
import { checkPipelineAccess, findNsConfig, getConfigs, toClientConfigs, toStepSummary } from "./helpers.ts";

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
  const nsConfig = findNsConfig(configs, ns!);
  const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
  const denied = checkPipelineAccess(session, nsConfig, pipeline);
  if (denied) return denied;

  return Response.json({
    id: pipeline!.id,
    name: pipeline!.name,
    description: pipeline!.description,
    confirm: pipeline!.confirm,
    concurrency: pipeline!.concurrency ?? 1,
    params: pipeline!.params,
    steps: pipeline!.steps.map(toStepSummary),
  } satisfies PipelineResponse);
});

export const getPipelineConfig = authed(async (req, session) => {
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
  } satisfies PipelineConfigResponse);
});

export const triggerPipeline = authed(async (req, session) => {
  const { ns, id } = req.params;

  const configs = await getConfigs();
  const nsConfig = findNsConfig(configs, ns!);
  const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
  const denied = checkPipelineAccess(session, nsConfig, pipeline);
  if (denied) return denied;

  const validation = await validateBody(req, triggerRunRequestSchema);
  if (!validation.success) {
    return Response.json({ error: validation.error } satisfies ErrorResponse, { status: 400 });
  }

  const body = validation.data;

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
    const msg = errorMessage(err);
    const status = err instanceof PipelineError ? err.statusCode : 500;
    if (status >= 500) {
      logger.error({ namespace: ns, pipelineId: id, error: msg, status }, "pipeline trigger failed");
    } else {
      logger.warn({ namespace: ns, pipelineId: id, error: msg, status }, "pipeline trigger rejected");
    }
    return Response.json({ error: msg } satisfies ErrorResponse, { status });
  }
});
