import { authed } from "../../auth/access.ts";
import { env } from "../../env.ts";
import { getActiveRunSummary } from "../../pipeline/executor.ts";
import type { ActiveRunInfo } from "../../types.ts";

export const getStatus = authed(async () => {
  const { total, byPipeline } = getActiveRunSummary();

  const pipelines: ActiveRunInfo[] = Object.entries(byPipeline).map(([key, runIds]) => {
    const [namespace, pipelineId] = key.split(":");
    return { namespace: namespace!, pipelineId: pipelineId!, runIds };
  });

  return Response.json({
    activeRuns: total,
    maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
    pipelines,
  });
});
