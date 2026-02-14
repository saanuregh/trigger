import * as db from "../../db/queries.ts";
import { subscribe } from "../../events.ts";
import { type ParamValues, type RunStatus, TERMINAL_STATUSES } from "../../types.ts";
import { defineAction, expectString, stringOrTemplate, z } from "../types.ts";

const schema = z
  .object({
    namespace: stringOrTemplate,
    pipeline_id: stringOrTemplate,
    params: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  })
  .strict();

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
        log("child step status changed", {
          childStep: msg.stepName as string,
          childStatus: msg.status as string,
        });
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

export default defineAction({
  name: "trigger-pipeline",
  schema,
  handler: async (config, ctx) => {
    if (!ctx.executePipeline) throw new Error("Pipeline executor not available in context");

    const namespace = expectString(config.namespace, "namespace");
    const pipeline_id = expectString(config.pipeline_id, "pipeline_id");
    const params = (config.params ?? {}) as ParamValues;
    const key = `${namespace}:${pipeline_id}`;

    ctx.log("triggering child pipeline", { childNamespace: namespace, childPipelineId: pipeline_id });

    const callStack = ctx.callStack ?? [];
    if (callStack.includes(key)) {
      throw new Error(`Circular pipeline dependency detected: ${[...callStack, key].join(" -> ")}`);
    }

    const runId = await ctx.executePipeline(namespace, pipeline_id, params, {
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
  },
});
