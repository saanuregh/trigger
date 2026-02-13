import { mkdirSync } from "node:fs";
import { Writable } from "node:stream";
import { join } from "node:path";
import pino from "pino";
import { env } from "../env.ts";
import { loadAllConfigs } from "../config/loader.ts";
import type { ActionName, StepDef } from "../config/types.ts";
import { errorMessage, type ParamValues } from "../types.ts";
import { resolveConfig } from "../config/template.ts";
import type { ActivePipeline, ActionContext, ActionHandler } from "./types.ts";
import * as db from "../db/queries.ts";
import { publish } from "../events.ts";
import { logger, stepLoggerOpts, type Logger } from "../logger.ts";
import { executeCloudflare } from "./actions/cloudflare.ts";
import { executeCodeBuild } from "./actions/codebuild.ts";
import { executeEcsRestart } from "./actions/ecs-restart.ts";
import { executeEcsTask } from "./actions/ecs-task.ts";
import { executeTriggerPipeline, registerExecutor } from "./actions/trigger-pipeline.ts";

export class PipelineError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

const DEFAULT_RUN_TIMEOUT_S = 3600;
const activePipelines = new Map<string, ActivePipeline>();

export async function executePipeline(
  namespace: string,
  pipelineId: string,
  params: ParamValues,
  options?: { signal?: AbortSignal; parentCallStack?: string[]; dryRun?: boolean; triggeredBy?: string },
): Promise<string> {
  const key = `${namespace}:${pipelineId}`;
  const dryRun = options?.dryRun ?? false;

  if (!dryRun && activePipelines.has(key)) {
    throw new PipelineError(`Pipeline ${key} is already running (run: ${activePipelines.get(key)!.runId})`, 409);
  }

  const runId = Bun.randomUUIDv7();
  const abort = new AbortController();
  if (!dryRun) activePipelines.set(key, { runId, abort });

  try {
    if (options?.signal) {
      options.signal.addEventListener("abort", () => abort.abort(), { once: true });
    }

    const configs = await loadAllConfigs();
    const nsConfig = configs.find(c => c.namespace === namespace);
    if (!nsConfig) throw new PipelineError(`Namespace not found: ${namespace}`, 404);

    const pipeline = nsConfig.pipelines.find(p => p.id === pipelineId);
    if (!pipeline) throw new PipelineError(`Pipeline not found: ${pipelineId} in namespace ${namespace}`, 404);

    db.createRun({
      id: runId,
      namespace,
      pipeline_id: pipelineId,
      pipeline_name: pipeline.name,
      params: JSON.stringify(params),
      started_at: new Date().toISOString(),
      dry_run: dryRun,
      triggered_by: options?.triggeredBy,
    });

    const stepRecords = pipeline.steps.map((step) => {
      const id = Bun.randomUUIDv7();
      db.createStep({
        id,
        run_id: runId,
        step_id: step.id,
        step_name: step.name,
        action: step.action,
      });
      return { dbId: id, def: step };
    });

    const log = logger.child({
      namespace,
      pipeline: pipeline.name,
      pipelineId,
      runId,
      dryRun,
      params,
      stepCount: pipeline.steps.length,
      region: nsConfig.aws_region,
    });

    publish("global", { type: "run:started", runId, namespace, pipelineId });
    db.updateRunStatus(runId, "running");
    publish(runId, { type: "run:status", runId, status: "running" });
    log.info("pipeline started");

    const logDir = join(env.DATA_DIR, "logs", runId);
    mkdirSync(logDir, { recursive: true });

    runSteps({
      runId, key, log, stepRecords, abort, logDir, dryRun, params,
      callStack: options?.parentCallStack ?? [key],
      vars: nsConfig.vars,
      region: nsConfig.aws_region,
      timeoutS: pipeline.timeout ?? DEFAULT_RUN_TIMEOUT_S,
      triggeredBy: options?.triggeredBy,
    }).catch(() => {});

    return runId;
  } catch (err) {
    if (!dryRun) activePipelines.delete(key);
    throw err;
  }
}

function publishStepStatus(runId: string, log: Logger, def: StepDef, status: string) {
  publish(runId, { type: "step:status", runId, stepId: def.id, stepName: def.name, action: def.action, status });
  log.info({ step: def.name, action: def.action, status }, "step status changed");
}

function finishRun(runId: string, log: Logger, status: "success" | "failed" | "cancelled", opts?: { error?: string; durationMs?: number }) {
  db.updateRunStatus(runId, status, opts?.error);
  publish(runId, { type: "run:status", runId, status });
  const fields = { status, ...opts };
  if (status === "failed") {
    log.error(fields, "pipeline finished");
  } else {
    log.info(fields, "pipeline finished");
  }
}

function skipRemainingSteps(runId: string, log: Logger, stepRecords: Array<{ dbId: string; def: StepDef }>, fromIndex: number) {
  for (const remaining of stepRecords.slice(fromIndex)) {
    db.updateStepStatus(remaining.dbId, "skipped");
    publishStepStatus(runId, log, remaining.def, "skipped");
  }
}

interface RunStepsOptions {
  runId: string;
  key: string;
  log: Logger;
  stepRecords: Array<{ dbId: string; def: StepDef }>;
  abort: AbortController;
  logDir: string;
  callStack: string[];
  dryRun: boolean;
  params: ParamValues;
  vars: Record<string, unknown>;
  region: string;
  timeoutS: number;
  triggeredBy?: string;
}

type StepResult = "success" | { failed: string } | "cancelled";

function createStepLogger(runId: string, def: StepDef, logFile: string, stepIndex: number, totalSteps: number) {
  const fileDest = pino.destination({ dest: logFile, sync: false, minLength: 4096 });
  const sseSink = new Writable({
    decodeStrings: false,
    write(data, _enc, cb) {
      try {
        const str = typeof data === "string" ? data : data.toString();
        publish(runId, { type: "log", ...JSON.parse(str) });
      } catch {}
      cb();
    },
  });
  const stepLog = pino(
    stepLoggerOpts,
    pino.multistream([{ stream: fileDest }, { stream: sseSink }]),
  ).child({ runId, stepId: def.id, step: def.name, action: def.action, stepIndex, totalSteps });

  return {
    stepLog,
    flush() { fileDest.flushSync(); fileDest.end(); },
    log: (msg: string, fields?: Record<string, unknown>) => fields ? stepLog.info(fields, msg) : stepLog.info(msg),
    warn: (msg: string, fields?: Record<string, unknown>) => fields ? stepLog.warn(fields, msg) : stepLog.warn(msg),
  };
}

async function executeStep(
  opts: RunStepsOptions,
  dbId: string,
  def: StepDef,
  stepIndex: number,
): Promise<StepResult> {
  const { runId, log, logDir, dryRun, params, vars, region, abort, callStack, stepRecords } = opts;
  const resolvedConfig = resolveConfig(def.config, { params, vars });
  const logFile = join(logDir, `${def.id}.log`);
  const sl = createStepLogger(runId, def, logFile, stepIndex, stepRecords.length);

  db.updateStepStatus(dbId, "running", { log_file: logFile });
  publishStepStatus(runId, log, def, "running");
  sl.stepLog.info("step starting");

  try {
    if (dryRun) {
      sl.stepLog.info("dry run, skipping action");
      sl.stepLog.info({ resolvedConfig }, "dry run resolved config");
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 3000));
      if (Math.random() < 0.05) throw new Error("simulated dry run failure");
    } else {
      const ctx: ActionContext = {
        runId, stepId: def.id, region, signal: abort.signal,
        log: sl.log, warn: sl.warn, callStack, triggeredBy: opts.triggeredBy,
      };
      const handler = actionHandlers[def.action] as ActionHandler;
      const result = await handler(resolvedConfig as never, ctx);
      db.updateStepStatus(dbId, "success", {
        output: result.output ? JSON.stringify(result.output) : undefined,
      });
      publishStepStatus(runId, log, def, "success");
      sl.stepLog.info("step completed");
      return "success";
    }

    db.updateStepStatus(dbId, "success");
    publishStepStatus(runId, log, def, "success");
    sl.stepLog.info("step completed");
    return "success";
  } catch (err) {
    const msg = errorMessage(err);

    if (abort.signal.aborted) {
      sl.stepLog.info("step cancelled");
      db.updateStepStatus(dbId, "skipped");
      publishStepStatus(runId, log, def, "skipped");
      return "cancelled";
    }

    sl.stepLog.error({ error: msg }, "step failed");
    db.updateStepStatus(dbId, "failed", { error: msg });
    publishStepStatus(runId, log, def, "failed");
    return { failed: msg };
  } finally {
    sl.flush();
  }
}

async function runSteps(opts: RunStepsOptions) {
  const { runId, key, log, stepRecords, abort, dryRun, timeoutS } = opts;
  const startedAt = Date.now();
  const timeoutTimer = setTimeout(() => {
    if (!abort.signal.aborted) {
      log.error({ timeoutSec: timeoutS }, "run exceeded timeout, aborting");
      abort.abort();
    }
  }, timeoutS * 1000);

  try {
    for (let i = 0; i < stepRecords.length; i++) {
      if (abort.signal.aborted) {
        skipRemainingSteps(runId, log, stepRecords, i);
        break;
      }

      const { dbId, def } = stepRecords[i]!;
      const result = await executeStep(opts, dbId, def, i + 1);

      if (result === "cancelled") {
        skipRemainingSteps(runId, log, stepRecords, i + 1);
        finishRun(runId, log, "cancelled", { durationMs: Date.now() - startedAt });
        return;
      }
      if (typeof result === "object") {
        skipRemainingSteps(runId, log, stepRecords, i + 1);
        finishRun(runId, log, "failed", { error: result.failed, durationMs: Date.now() - startedAt });
        return;
      }
    }

    finishRun(runId, log, abort.signal.aborted ? "cancelled" : "success", { durationMs: Date.now() - startedAt });
  } catch (err) {
    const msg = errorMessage(err);
    log.error({ error: msg }, "unexpected error");
    finishRun(runId, log, "failed", { error: `Unexpected error: ${msg}`, durationMs: Date.now() - startedAt });
    db.markStaleSteps(runId);
  } finally {
    clearTimeout(timeoutTimer);
    if (!dryRun) activePipelines.delete(key);
  }
}

const actionHandlers: { [K in ActionName]: ActionHandler<K> } = {
  codebuild: executeCodeBuild,
  "ecs-restart": executeEcsRestart,
  "ecs-task": executeEcsTask,
  "cloudflare-purge": executeCloudflare,
  "trigger-pipeline": executeTriggerPipeline,
};

export function cancelPipeline(runId: string): boolean {
  for (const [, active] of activePipelines) {
    if (active.runId === runId) {
      active.abort.abort();
      return true;
    }
  }
  return false;
}

export function shutdownAll(): void {
  for (const active of activePipelines.values()) {
    active.abort.abort();
    db.updateRunStatus(active.runId, "cancelled", "Server shutdown");
  }
  activePipelines.clear();
}

export function recoverStaleRuns(): void {
  for (const status of ["running", "pending"] as const) {
    const runs = db.listRuns({ status, limit: 100 });
    for (const run of runs) {
      db.updateRunStatus(run.id, "failed", `Server crashed while ${status}`);
      db.markStaleSteps(run.id);
      logger.warn({ runId: run.id, namespace: run.namespace, pipelineId: run.pipeline_id, previousStatus: status }, "stale run recovered");
    }
  }
}

registerExecutor(executePipeline);
