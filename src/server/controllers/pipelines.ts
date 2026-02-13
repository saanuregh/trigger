import { authed, filterAccessibleConfigs } from "../../auth/access.ts";
import { refreshNamespace } from "../../config/loader.ts";
import { logger } from "../../logger.ts";
import { executePipeline, PipelineError } from "../../pipeline/executor.ts";
import { errorMessage } from "../../types.ts";
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
    params: pipeline!.params,
    steps: pipeline!.steps.map(toStepSummary),
  });
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
  });
});

export const triggerPipeline = authed(async (req, session) => {
  const { ns, id } = req.params;

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
    logger.info({ namespace: ns, pipelineId: id, runId, dryRun: body.dryRun ?? false, triggeredBy: session.email }, "pipeline triggered");
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
});
