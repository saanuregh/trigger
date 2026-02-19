import { canAccessNamespace, canAccessPipeline } from "../../auth/access.ts";
import type { AuthSession } from "../../auth/session.ts";
import { getCachedConfigs, loadAllConfigs } from "../../config/loader.ts";
import type { NamespaceConfig } from "../../config/types.ts";
import * as db from "../../db/queries.ts";
import { logger } from "../../logger.ts";
import { PipelineError } from "../../pipeline/executor.ts";
import { type ErrorResponse, errorMessage, type NamespaceConfigSummary, type RunRow, type StepDefSummary } from "../../types.ts";

export type RouteRequest = Request & { params: Record<string, string> };

export async function getConfigs(): Promise<NamespaceConfig[]> {
  return getCachedConfigs() ?? (await loadAllConfigs());
}

export function toStepSummary(s: { id: string; name: string; action: string }): StepDefSummary {
  return { id: s.id, name: s.name, action: s.action };
}

export function toClientConfigs(configs: NamespaceConfig[]): NamespaceConfigSummary[] {
  return configs.map((ns) => ({
    namespace: ns.namespace,
    display_name: ns.display_name,
    pipelines: ns.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      confirm: p.confirm,
      concurrency: p.concurrency ?? 1,
      params: p.params,
      steps: p.steps.map(toStepSummary),
    })),
    ...(ns._error && { error: ns._error }),
  }));
}

function findNsConfig(configs: NamespaceConfig[], ns: string): NamespaceConfig | undefined {
  return configs.find((c) => c.namespace === ns);
}

export async function checkNamespaceAccess(session: AuthSession, namespace: string): Promise<Response | null> {
  const configs = await getConfigs();
  const nsConfig = findNsConfig(configs, namespace);
  if (nsConfig && !canAccessNamespace(session, nsConfig)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
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

type PipelineDef = NamespaceConfig["pipelines"][number];

export async function getPipelineWithAccess(
  session: AuthSession,
  ns: string,
  id: string,
  configs?: NamespaceConfig[],
): Promise<{ pipeline: PipelineDef } | { denied: Response }> {
  const resolved = configs ?? (await getConfigs());
  const nsConfig = findNsConfig(resolved, ns);
  const pipeline = nsConfig?.pipelines.find((p) => p.id === id);
  const denied = checkPipelineAccess(session, nsConfig, pipeline);
  if (denied) return { denied };
  return { pipeline: pipeline! };
}

export async function getRunWithAccess(runId: string, session: AuthSession): Promise<{ run: RunRow } | { error: Response }> {
  const run = db.getRun(runId);
  if (!run) return { error: Response.json({ error: "Run not found" }, { status: 404 }) };

  const denied = await checkNamespaceAccess(session, run.namespace);
  if (denied) return { error: denied };

  return { run };
}

export function handlePipelineError(err: unknown, context: Record<string, unknown>, operation = "operation"): Response {
  const msg = errorMessage(err);
  const status = err instanceof PipelineError ? err.statusCode : 500;
  const logFn = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  logFn({ ...context, error: msg, status }, `pipeline ${operation} ${status >= 500 ? "failed" : "rejected"}`);
  return Response.json({ error: msg } satisfies ErrorResponse, { status });
}

export const MAX_LOG_LINES = 50_000;

export const OAUTH_STATE_COOKIE = "trigger_oauth_state";
