import type { TriggerPipelineActionConfig } from "../../config/types.ts";
import * as db from "../../db/queries.ts";
import { subscribe } from "../../events.ts";
import { type RunStatus, TERMINAL_STATUSES } from "../../types.ts";
import type { ActionContext } from "../types.ts";

type ExecutePipelineFn = (
  ns: string,
  pipelineId: string,
  params: Record<string, string | boolean>,
  options: { signal: AbortSignal; parentCallStack?: string[]; triggeredBy?: string },
) => Promise<string>;

let executePipelineFn: ExecutePipelineFn | null = null;

export function registerExecutor(fn: ExecutePipelineFn) {
  executePipelineFn = fn;
}

function waitForRun(runId: string, signal: AbortSignal, log: (msg: string, fields?: Record<string, unknown>) => void): Promise<RunStatus> {
  const run = db.getRun(runId);
  if (run && TERMINAL_STATUSES.has(run.status)) return Promise.resolve(run.status);

  return new Promise<RunStatus>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("Cancelled"));
    };

    const unsubscribe = subscribe(runId, (msg) => {
      if (msg.type === "run:status") {
        const status = msg.status as RunStatus;
        if (TERMINAL_STATUSES.has(status)) {
          cleanup();
          resolve(status);
        }
      } else if (msg.type === "step:status") {
        log("child step status changed", { childStep: msg.stepName as string, childStatus: msg.status as string });
      }
    });

    function cleanup() {
      unsubscribe();
      signal.removeEventListener("abort", onAbort);
    }

    signal.addEventListener("abort", onAbort, { once: true });

    const fresh = db.getRun(runId);
    if (fresh && TERMINAL_STATUSES.has(fresh.status)) {
      cleanup();
      resolve(fresh.status);
    }
  });
}

export async function executeTriggerPipeline(config: TriggerPipelineActionConfig, ctx: ActionContext) {
  if (!executePipelineFn) throw new Error("Pipeline executor not registered");

  const { namespace, pipeline_id, params = {} } = config;
  const key = `${namespace}:${pipeline_id}`;

  ctx.log("triggering child pipeline", { childNamespace: namespace, childPipelineId: pipeline_id });

  const callStack = ctx.callStack ?? [];
  if (callStack.includes(key)) {
    throw new Error(`Circular pipeline dependency detected: ${[...callStack, key].join(" -> ")}`);
  }

  const runId = await executePipelineFn(namespace, pipeline_id, params, {
    signal: ctx.signal,
    parentCallStack: [...callStack, key],
    triggeredBy: ctx.triggeredBy,
  });

  ctx.log("child pipeline started, waiting for completion", { childRunId: runId });

  const status = await waitForRun(runId, ctx.signal, ctx.log);

  if (status === "failed") {
    const childRun = db.getRun(runId);
    throw new Error(childRun?.error ?? "child pipeline failed");
  }
  if (status === "cancelled") {
    throw new Error("child pipeline was cancelled");
  }

  ctx.log("child pipeline completed");
  return { output: { triggeredRunId: runId, namespace, pipeline_id, status } };
}
