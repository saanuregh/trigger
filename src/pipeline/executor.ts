import { mkdirSync } from "node:fs";
import { loadAllConfigs } from "../config/loader.ts";
import { resolveConfig } from "../config/template.ts";
import type { StepDef } from "../config/types.ts";
import * as db from "../db/queries.ts";
import { env } from "../env.ts";
import { publish } from "../events.ts";
import { createLogger, type Logger, logger } from "../logger.ts";
import { errorMessage, getSecretParamNames, type JSONValue, type ParamValues, redactParamValues, type StepStatus } from "../types.ts";
import { clearRegistry, getAction, type RegisteredAction, registerAction } from "./action-registry.ts";
import { sleep } from "./actions/aws-utils.ts";
import cloudflare from "./actions/cloudflare.ts";
import codebuild from "./actions/codebuild.ts";
import ecsRestart from "./actions/ecs-restart.ts";
import ecsTask from "./actions/ecs-task.ts";
import triggerPipeline from "./actions/trigger-pipeline.ts";
import type { ActionContext } from "./types.ts";

interface ActivePipeline {
  runId: string;
  abort: AbortController;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

const DEFAULT_RUN_TIMEOUT_S = 3600;
const activePipelines = new Map<string, ActivePipeline[]>();

/** Check concurrency limits and track the run atomically (must be synchronous — no await between check and track). */
function checkAndTrackRun(key: string, limit: number, entry: ActivePipeline): void {
  const active = activePipelines.get(key) ?? [];
  if (active.length >= limit) {
    throw new PipelineError(`Pipeline ${key} at max concurrency (${active.length}/${limit})`, 409);
  }
  const globalCount = [...activePipelines.values()].reduce((sum, arr) => sum + arr.length, 0);
  if (globalCount >= env.MAX_CONCURRENT_RUNS) {
    throw new PipelineError(`Global concurrency limit reached (${globalCount}/${env.MAX_CONCURRENT_RUNS})`, 409);
  }
  active.push(entry);
  activePipelines.set(key, active);
}

function untrackRun(key: string, runId: string): void {
  const arr = activePipelines.get(key);
  if (!arr) return;
  const filtered = arr.filter((a) => a.runId !== runId);
  if (filtered.length === 0) activePipelines.delete(key);
  else activePipelines.set(key, filtered);
}

async function loadPipeline(namespace: string, pipelineId: string) {
  const configs = await loadAllConfigs();
  const nsConfig = configs.find((c) => c.namespace === namespace);
  if (!nsConfig) throw new PipelineError(`Namespace not found: ${namespace}`, 404);
  const pipeline = nsConfig.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) throw new PipelineError(`Pipeline not found: ${pipelineId} in namespace ${namespace}`, 404);
  return { nsConfig, pipeline };
}

function wireAbort(parentSignal: AbortSignal | undefined, abort: AbortController): void {
  parentSignal?.addEventListener("abort", () => abort.abort(), { once: true });
}

/** Caller must set DB run status to "running" before calling this. */
function dispatchRun(opts: RunStepsOptions): void {
  const { runId, namespace, pipelineId, pipelineName, log, startFromIndex } = opts;
  publish("global", { type: "run:started", runId, namespace, pipelineId, pipelineName });
  publish(runId, { type: "run:status", runId, status: "running" });
  log.info(startFromIndex != null ? "pipeline retry started" : "pipeline started");
  runSteps(opts).catch((err) => {
    logger.error({ runId, error: errorMessage(err) }, "runSteps unexpected rejection");
  });
}

export async function executePipeline(
  namespace: string,
  pipelineId: string,
  params: ParamValues,
  options?: { signal?: AbortSignal; parentCallStack?: string[]; dryRun?: boolean; triggeredBy?: string },
): Promise<string> {
  const key = `${namespace}:${pipelineId}`;
  const dryRun = options?.dryRun ?? false;
  const { nsConfig, pipeline } = await loadPipeline(namespace, pipelineId);

  const runId = Bun.randomUUIDv7();
  const abort = new AbortController();
  // Atomic check-and-track: no await between concurrency check and map insertion
  checkAndTrackRun(key, pipeline.concurrency ?? 1, { runId, abort });

  try {
    wireAbort(options?.signal, abort);

    const callStack = options?.parentCallStack ?? [key];
    db.createRun({
      id: runId,
      namespace,
      pipeline_id: pipelineId,
      pipeline_name: pipeline.name,
      params: JSON.stringify(params),
      started_at: new Date().toISOString(),
      dry_run: dryRun,
      triggered_by: options?.triggeredBy,
      call_stack: callStack,
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

    const secretNames = getSecretParamNames(pipeline.params);
    const log = logger.child({
      namespace,
      pipeline: pipeline.name,
      pipelineId,
      runId,
      dryRun,
      params: redactParamValues(params, secretNames),
      stepCount: pipeline.steps.length,
      region: nsConfig.aws_region,
    });

    db.updateRunStatus(runId, "running");
    const logDir = `${env.DATA_DIR}/logs/${runId}`;
    mkdirSync(logDir, { recursive: true });

    dispatchRun({
      runId,
      namespace,
      pipelineId,
      pipelineName: pipeline.name,
      log,
      stepRecords,
      abort,
      logDir,
      dryRun,
      params,
      callStack,
      vars: nsConfig.vars,
      region: nsConfig.aws_region,
      timeoutS: pipeline.timeout ?? DEFAULT_RUN_TIMEOUT_S,
      triggeredBy: options?.triggeredBy,
      secretNames,
    });

    return runId;
  } catch (err) {
    untrackRun(key, runId);
    throw err;
  }
}

export async function retryRun(runId: string, options?: { signal?: AbortSignal; triggeredBy?: string }): Promise<string> {
  const run = db.getRun(runId);
  if (!run) throw new PipelineError("Run not found", 404);
  if (run.status !== "failed") throw new PipelineError("Only failed runs can be retried", 400);

  const key = `${run.namespace}:${run.pipeline_id}`;
  const dryRun = run.dry_run === 1;
  const { nsConfig, pipeline } = await loadPipeline(run.namespace, run.pipeline_id);

  const abort = new AbortController();
  // Atomic check-and-track: no await between concurrency check and map insertion
  checkAndTrackRun(key, pipeline.concurrency ?? 1, { runId, abort });

  try {
    const existingSteps = db.getStepsForRun(runId);
    const failedIndex = existingSteps.findIndex((s) => s.status === "failed");
    if (failedIndex === -1) throw new PipelineError("No failed step found in this run", 400);

    const stepRecords = existingSteps.map((dbStep) => {
      const def = pipeline.steps.find((s) => s.id === dbStep.step_id);
      if (!def) throw new PipelineError(`Step "${dbStep.step_id}" no longer exists in pipeline config`, 400);
      return { dbId: dbStep.id, def };
    });

    db.resetStepsForRetry(
      runId,
      existingSteps.slice(failedIndex).map((s) => s.id),
    );
    db.resetRunForRetry(runId);
    wireAbort(options?.signal, abort);

    const params: ParamValues = run.params ? JSON.parse(run.params) : {};
    const logDir = `${env.DATA_DIR}/logs/${runId}`;
    const secretNames = getSecretParamNames(pipeline.params);

    const log = logger.child({
      namespace: run.namespace,
      pipeline: run.pipeline_name,
      pipelineId: run.pipeline_id,
      runId,
      params: redactParamValues(params, secretNames),
      stepCount: pipeline.steps.length,
      region: nsConfig.aws_region,
      retry: true,
      retryFromStep: existingSteps[failedIndex]!.step_id,
    });

    log.info("retry will use current pipeline config — behavior may differ if config changed since original run");

    dispatchRun({
      runId,
      namespace: run.namespace,
      pipelineId: run.pipeline_id,
      pipelineName: run.pipeline_name,
      log,
      stepRecords,
      abort,
      logDir,
      dryRun,
      params,
      callStack: run.call_stack ? JSON.parse(run.call_stack) : [key],
      vars: nsConfig.vars,
      region: nsConfig.aws_region,
      timeoutS: pipeline.timeout ?? DEFAULT_RUN_TIMEOUT_S,
      triggeredBy: options?.triggeredBy,
      startFromIndex: failedIndex,
      secretNames,
    });

    return runId;
  } catch (err) {
    untrackRun(key, runId);
    db.updateRunStatus(runId, "failed", `Retry setup failed: ${errorMessage(err)}`);
    throw err;
  }
}

function publishStepStatus(runId: string, log: Logger, def: StepDef, status: StepStatus) {
  publish(runId, { type: "step:status", runId, stepId: def.id, stepName: def.name, action: def.action, status });
  log.info({ step: def.name, action: def.action, status }, "step status changed");
}

function finishRun(runId: string, log: Logger, status: "success" | "failed" | "cancelled", opts?: { error?: string; durationMs?: number }) {
  db.updateRunStatus(runId, status, opts?.error);
  publish(runId, { type: "run:status", runId, status });
  const logFn = status === "failed" ? log.error.bind(log) : log.info.bind(log);
  logFn({ status, ...opts }, "pipeline finished");
}

function skipRemainingSteps(runId: string, log: Logger, stepRecords: Array<{ dbId: string; def: StepDef }>, fromIndex: number) {
  for (const remaining of stepRecords.slice(fromIndex)) {
    db.updateStepStatus(remaining.dbId, "skipped");
    publishStepStatus(runId, log, remaining.def, "skipped");
  }
}

interface RunStepsOptions {
  runId: string;
  namespace: string;
  pipelineId: string;
  pipelineName: string;
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
  startFromIndex?: number;
  secretNames: Set<string>;
}

type StepResult = "success" | { failed: string } | "cancelled";

function createStepLogger(runId: string, def: StepDef, logFile: string, stepIndex: number, totalSteps: number) {
  const file = Bun.file(logFile).writer();
  const write = (line: string) => {
    file.write(`${line}\n`);
    try {
      publish(runId, { type: "log", ...JSON.parse(line) });
    } catch (err) {
      if (err instanceof SyntaxError) return;
      logger.warn({ runId, error: errorMessage(err) }, "event publish failed");
    }
  };

  const stepLog = createLogger({ runId, stepId: def.id, step: def.name, action: def.action, stepIndex, totalSteps }, write);

  function makeLogFn(level: "info" | "warn") {
    return (msg: string, fields?: Record<string, JSONValue | undefined>) => (fields ? stepLog[level](fields, msg) : stepLog[level](msg));
  }

  return {
    stepLog,
    async flush() {
      try {
        await file.flush();
        await file.end();
      } catch (err) {
        logger.warn({ runId, stepId: def.id, error: errorMessage(err) }, "failed to flush step log file");
      }
    },
    log: makeLogFn("info"),
    warn: makeLogFn("warn"),
  };
}

async function executeStep(opts: RunStepsOptions, dbId: string, def: StepDef, stepIndex: number): Promise<StepResult> {
  const { runId, log, logDir, dryRun, params, vars, region, abort, callStack, stepRecords } = opts;
  const resolvedConfig = resolveConfig(def.config, { params, vars });
  const logFile = `${logDir}/${def.id}.log`;
  const sl = createStepLogger(runId, def, logFile, stepIndex, stepRecords.length);

  db.updateStepStatus(dbId, "running", { log_file: logFile });
  publishStepStatus(runId, log, def, "running");
  sl.stepLog.info("step starting");

  try {
    const action = getAction(def.action);
    if (!action) {
      sl.stepLog.warn(`action "${def.action}" not registered, skipping step`);
      db.updateStepStatus(dbId, "skipped");
      publishStepStatus(runId, log, def, "skipped");
      return "success";
    }

    if (dryRun) {
      sl.stepLog.info("dry run, skipping action execution");
      if (opts.secretNames.size > 0) {
        sl.stepLog.info("dry run resolved config redacted (pipeline has secret params)");
      } else {
        sl.stepLog.info({ resolvedConfig: resolvedConfig as JSONValue }, "dry run resolved config");
      }
      await sleep(5000 + Math.random() * 10000, abort.signal);
      if (Math.random() < 0.05) throw new Error("simulated dry run failure");
      db.updateStepStatus(dbId, "success");
    } else {
      const ctx: ActionContext = {
        runId,
        stepId: def.id,
        region,
        signal: abort.signal,
        log: sl.log,
        warn: sl.warn,
        callStack,
        triggeredBy: opts.triggeredBy,
        executePipeline,
      };
      const result = await action.handler(resolvedConfig, ctx);
      db.updateStepStatus(dbId, "success", {
        output: result.output ? JSON.stringify(result.output) : undefined,
      });
    }

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
    await sl.flush();
  }
}

async function runSteps(opts: RunStepsOptions) {
  const { runId, namespace, pipelineId, log, stepRecords, abort, timeoutS } = opts;
  const key = `${namespace}:${pipelineId}`;
  const startedAt = Date.now();
  let finalStatus: "success" | "failed" | "cancelled" | null = null;
  const timeoutTimer = setTimeout(() => {
    if (!abort.signal.aborted) {
      log.error({ timeoutSec: timeoutS }, "run exceeded timeout, aborting");
      abort.abort();
    }
  }, timeoutS * 1000);

  try {
    for (let i = opts.startFromIndex ?? 0; i < stepRecords.length; i++) {
      if (abort.signal.aborted) {
        skipRemainingSteps(runId, log, stepRecords, i);
        break;
      }

      const { dbId, def } = stepRecords[i]!;
      const result = await executeStep(opts, dbId, def, i + 1);

      if (result !== "success") {
        skipRemainingSteps(runId, log, stepRecords, i + 1);
        finalStatus = result === "cancelled" ? "cancelled" : "failed";
        finishRun(runId, log, finalStatus, {
          error: typeof result === "object" ? result.failed : undefined,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
    }

    finalStatus = abort.signal.aborted ? "cancelled" : "success";
    finishRun(runId, log, finalStatus, { durationMs: Date.now() - startedAt });
  } catch (err) {
    const msg = errorMessage(err);
    log.error({ error: msg }, "unexpected error");
    finalStatus = "failed";
    finishRun(runId, log, "failed", { error: `Unexpected error: ${msg}`, durationMs: Date.now() - startedAt });
    db.markStaleSteps(runId);
  } finally {
    clearTimeout(timeoutTimer);
    untrackRun(key, runId);
    if (finalStatus) {
      publish("global", { type: "run:completed", runId, namespace, pipelineId, pipelineName: opts.pipelineName, status: finalStatus });
    }
  }
}

export function getActiveRunSummary(): { total: number; byPipeline: Record<string, string[]> } {
  const byPipeline: Record<string, string[]> = {};
  for (const [key, arr] of activePipelines) {
    byPipeline[key] = arr.map((a) => a.runId);
  }
  return { total: Object.values(byPipeline).reduce((sum, arr) => sum + arr.length, 0), byPipeline };
}

export function initBuiltinActions(): void {
  clearRegistry();
  for (const action of [codebuild, ecsRestart, ecsTask, cloudflare, triggerPipeline]) {
    registerAction({ ...action, handler: action.handler as RegisteredAction["handler"], builtin: true });
  }
}

export function cancelPipeline(runId: string): boolean {
  for (const arr of activePipelines.values()) {
    const active = arr.find((a) => a.runId === runId);
    if (active) {
      active.abort.abort();
      return true;
    }
  }
  return false;
}

export async function shutdownAll(): Promise<void> {
  const allActive = [...activePipelines.values()].flat();
  if (allActive.length === 0) return;

  logger.info({ active: allActive.length }, "aborting active pipelines");
  for (const active of allActive) active.abort.abort();

  const deadline = Date.now() + 10_000;
  while (activePipelines.size > 0 && Date.now() < deadline) {
    await Bun.sleep(100);
  }

  for (const active of [...activePipelines.values()].flat()) {
    db.updateRunStatus(active.runId, "cancelled", "Server shutdown");
    db.markStaleSteps(active.runId);
  }
  activePipelines.clear();
}

export function recoverStaleRuns(): void {
  for (const status of ["running", "pending"] as const) {
    // Snapshot all stale runs upfront to avoid relying on mutation side-effects during iteration
    const staleRuns = db.listRuns({ status, limit: 10_000 });
    for (const run of staleRuns) {
      db.updateRunStatus(run.id, "failed", `Server crashed while ${status}`);
      db.markStaleSteps(run.id);
    }
    if (staleRuns.length > 0) logger.warn({ status, count: staleRuns.length }, "stale runs recovered");
  }
}
