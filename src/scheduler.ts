import { Cron } from "croner";
import type { NamespaceConfig } from "./config/types.ts";
import * as db from "./db/queries.ts";
import { logger } from "./logger.ts";
import { executePipeline, PipelineError } from "./pipeline/executor.ts";
import { errorMessage, type ParamValues } from "./types.ts";

interface ScheduleEntry {
  namespace: string;
  pipelineId: string;
  pipelineName: string;
  scheduleIndex: number;
  cron: Cron;
  cronExpr: string;
  params: ParamValues;
}

const TICK_MS = 30_000;
const MISSED_TOLERANCE_MS = 5 * 60 * 1000;

let scheduleMap = new Map<string, ScheduleEntry[]>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastTickAt = Date.now();

function buildDefaultParams(paramDefs?: Array<{ name: string; default?: unknown }>): ParamValues {
  const params: ParamValues = {};
  for (const def of paramDefs ?? []) {
    if (def.default !== undefined) {
      params[def.name] = def.default as string | boolean;
    }
  }
  return params;
}

function buildScheduleMap(configs: NamespaceConfig[]): Map<string, ScheduleEntry[]> {
  const map = new Map<string, ScheduleEntry[]>();

  for (const ns of configs) {
    if (ns._error) continue;
    for (const pipeline of ns.pipelines) {
      if (!pipeline.schedule) continue;

      const key = `${ns.namespace}:${pipeline.id}`;
      const entries: ScheduleEntry[] = [];
      const defaultParams = buildDefaultParams(pipeline.params);

      const schedules = typeof pipeline.schedule === "string" ? [{ cron: pipeline.schedule, params: undefined }] : pipeline.schedule;

      for (let i = 0; i < schedules.length; i++) {
        const s = schedules[i]!;
        try {
          entries.push({
            namespace: ns.namespace,
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            scheduleIndex: i,
            cron: new Cron(s.cron),
            cronExpr: s.cron,
            params: { ...defaultParams, ...s.params },
          });
        } catch (err) {
          logger.warn(
            { namespace: ns.namespace, pipelineId: pipeline.id, cron: s.cron, error: errorMessage(err) },
            "invalid cron expression in schedule, skipping",
          );
        }
      }

      if (entries.length > 0) map.set(key, entries);
    }
  }

  return map;
}

async function fireEntry(entry: ScheduleEntry, now: Date): Promise<void> {
  const { namespace, pipelineId, pipelineName, scheduleIndex, cronExpr, params } = entry;
  const firedAt = now.toISOString();
  const eventId = Bun.randomUUIDv7();

  try {
    const runId = await executePipeline(namespace, pipelineId, params, {
      triggeredBy: "scheduler",
    });
    db.recordScheduleEvent({
      id: eventId,
      namespace,
      pipeline_id: pipelineId,
      schedule_index: scheduleIndex,
      cron: cronExpr,
      fired_at: firedAt,
      run_id: runId,
      status: "fired",
    });
    logger.info({ namespace, pipelineId, pipelineName, cron: cronExpr, runId }, "scheduler fired pipeline");
  } catch (err) {
    const msg = errorMessage(err);
    const isConflict = err instanceof PipelineError && err.statusCode === 409;
    db.recordScheduleEvent({
      id: eventId,
      namespace,
      pipeline_id: pipelineId,
      schedule_index: scheduleIndex,
      cron: cronExpr,
      fired_at: firedAt,
      run_id: null,
      status: "skipped",
      skip_reason: isConflict ? "concurrency_limit" : msg,
    });
    const logFn = isConflict ? logger.warn.bind(logger) : logger.error.bind(logger);
    logFn(
      { namespace, pipelineId, pipelineName, cron: cronExpr, error: msg },
      isConflict ? "scheduler skipped: concurrency limit" : "scheduler failed to fire pipeline",
    );
  }
}

async function tick(): Promise<void> {
  const now = Date.now();
  const windowStart = lastTickAt;
  lastTickAt = now;

  for (const entries of scheduleMap.values()) {
    for (const entry of entries) {
      const prev = entry.cron.previousRuns(1, new Date(now))[0];
      if (prev && prev.getTime() >= windowStart && prev.getTime() < now) {
        await fireEntry(entry, prev);
      }
    }
  }
}

function recoverMissedSchedules(): void {
  const now = Date.now();

  for (const entries of scheduleMap.values()) {
    for (const entry of entries) {
      const last = db.getLastScheduleEvent(entry.namespace, entry.pipelineId, entry.scheduleIndex);
      const prev = entry.cron.previousRuns(1, new Date(now))[0];
      if (!prev) continue;

      const shouldHaveFiredAt = prev.getTime();
      if (last && new Date(last.fired_at).getTime() >= shouldHaveFiredAt) continue;

      const missedAgo = now - shouldHaveFiredAt;
      if (missedAgo <= MISSED_TOLERANCE_MS) {
        logger.info(
          { namespace: entry.namespace, pipelineId: entry.pipelineId, cron: entry.cronExpr, missedAgoMs: missedAgo },
          "recovering missed schedule",
        );
        fireEntry(entry, prev);
      } else {
        const eventId = Bun.randomUUIDv7();
        db.recordScheduleEvent({
          id: eventId,
          namespace: entry.namespace,
          pipeline_id: entry.pipelineId,
          schedule_index: entry.scheduleIndex,
          cron: entry.cronExpr,
          fired_at: prev.toISOString(),
          run_id: null,
          status: "missed",
          skip_reason: `Server was down; missed by ${Math.round(missedAgo / 1000)}s (tolerance: ${MISSED_TOLERANCE_MS / 1000}s)`,
        });
        logger.warn(
          { namespace: entry.namespace, pipelineId: entry.pipelineId, cron: entry.cronExpr, missedAgoMs: missedAgo },
          "schedule missed while server was down (outside tolerance)",
        );
      }
    }
  }
}

export function startScheduler(configs: NamespaceConfig[]): void {
  scheduleMap = buildScheduleMap(configs);
  const count = [...scheduleMap.values()].reduce((sum, arr) => sum + arr.length, 0);
  if (count === 0) {
    logger.info("scheduler: no schedules found");
    return;
  }
  logger.info({ schedules: count }, "scheduler started");

  recoverMissedSchedules();

  lastTickAt = Date.now();
  tickTimer = setInterval(() => {
    tick().catch((err) => {
      logger.error({ error: errorMessage(err) }, "scheduler tick error");
    });
  }, TICK_MS);
}

export function refreshSchedules(configs: NamespaceConfig[]): void {
  const oldCount = [...scheduleMap.values()].reduce((sum, arr) => sum + arr.length, 0);
  scheduleMap = buildScheduleMap(configs);
  const newCount = [...scheduleMap.values()].reduce((sum, arr) => sum + arr.length, 0);
  if (oldCount !== newCount || newCount > 0) {
    logger.info({ schedules: newCount }, "scheduler refreshed");
  }
}

export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info("scheduler stopped");
  }
}

export function getScheduleInfo(
  namespace: string,
  pipelineId: string,
): Array<{
  cron: string;
  nextRun: string | null;
  lastFired: { at: string; status: string; runId: string | null } | null;
}> | null {
  const key = `${namespace}:${pipelineId}`;
  const entries = scheduleMap.get(key);
  if (!entries) return null;

  return entries.map((entry) => {
    const next = entry.cron.nextRun();
    const last = db.getLastScheduleEvent(namespace, pipelineId, entry.scheduleIndex);
    return {
      cron: entry.cronExpr,
      nextRun: next ? next.toISOString() : null,
      lastFired: last ? { at: last.fired_at, status: last.status, runId: last.run_id } : null,
    };
  });
}
