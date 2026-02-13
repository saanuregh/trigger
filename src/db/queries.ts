import { getDb } from "./index.ts";
import type { RunStatus, StepStatus, RunRow, StepRow } from "../types.ts";

function buildRunFilters(filters: { namespace?: string; pipeline_id?: string; status?: string }) {
  const conditions: string[] = [];
  const values: string[] = [];

  if (filters.namespace) { conditions.push("namespace = ?"); values.push(filters.namespace); }
  if (filters.pipeline_id) { conditions.push("pipeline_id = ?"); values.push(filters.pipeline_id); }
  if (filters.status) { conditions.push("status = ?"); values.push(filters.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, values };
}

export function createRun(run: Pick<RunRow, "id" | "namespace" | "pipeline_id" | "pipeline_name" | "params" | "started_at"> & { dry_run?: boolean; triggered_by?: string }): void {
  getDb().run(
    `INSERT INTO pipeline_runs (id, namespace, pipeline_id, pipeline_name, status, params, started_at, dry_run, triggered_by)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [run.id, run.namespace, run.pipeline_id, run.pipeline_name, run.params, run.started_at, run.dry_run ? 1 : 0, run.triggered_by ?? null],
  );
}

export function updateRunStatus(id: string, status: RunStatus, error?: string): void {
  const finishedAt = status === "running" || status === "pending" ? null : new Date().toISOString();
  getDb().run(
    `UPDATE pipeline_runs SET status = ?, finished_at = COALESCE(?, finished_at), error = COALESCE(?, error) WHERE id = ?`,
    [status, finishedAt, error ?? null, id],
  );
}

export function getRun(id: string): RunRow | null {
  return getDb().query<RunRow, [string]>(`SELECT * FROM pipeline_runs WHERE id = ?`).get(id);
}

export function listRuns(filters: { namespace?: string; pipeline_id?: string; status?: string; limit?: number; offset?: number }): RunRow[] {
  const { where, values } = buildRunFilters(filters);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  return getDb()
    .query(`SELECT * FROM pipeline_runs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as RunRow[];
}

export function countRuns(filters: { namespace?: string; pipeline_id?: string; status?: string }): number {
  const { where, values } = buildRunFilters(filters);
  return (getDb().query<{ count: number }, string[]>(`SELECT COUNT(*) as count FROM pipeline_runs ${where}`).get(...values))!.count;
}

export function createStep(step: Pick<StepRow, "id" | "run_id" | "step_id" | "step_name" | "action">): void {
  getDb().run(
    `INSERT INTO pipeline_steps (id, run_id, step_id, step_name, action, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [step.id, step.run_id, step.step_id, step.step_name, step.action],
  );
}

export function updateStepStatus(id: string, status: StepStatus, extra?: { output?: string; error?: string; log_file?: string }): void {
  const now = new Date().toISOString();
  const startedAt = status === "running" ? now : null;
  const finishedAt = status !== "running" && status !== "pending" ? now : null;
  getDb().run(
    `UPDATE pipeline_steps SET
       status = ?,
       started_at = COALESCE(?, started_at),
       finished_at = COALESCE(?, finished_at),
       output = COALESCE(?, output),
       error = COALESCE(?, error),
       log_file = COALESCE(?, log_file)
     WHERE id = ?`,
    [status, startedAt, finishedAt, extra?.output ?? null, extra?.error ?? null, extra?.log_file ?? null, id],
  );
}

export function getStepsForRun(runId: string): StepRow[] {
  return getDb().query<StepRow, [string]>(`SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY rowid`).all(runId);
}

export function markStaleSteps(runId: string): void {
  const now = new Date().toISOString();
  getDb().run(
    `UPDATE pipeline_steps SET
       status = CASE WHEN status = 'running' THEN 'failed' ELSE 'skipped' END,
       error = CASE WHEN status = 'running' THEN 'Interrupted' ELSE error END,
       finished_at = COALESCE(finished_at, ?)
     WHERE run_id = ? AND status IN ('running', 'pending')`,
    [now, runId],
  );
}
