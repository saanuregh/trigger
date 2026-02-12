export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type RunStatus = "pending" | "running" | "success" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["success", "failed", "cancelled"]);

export interface RunRow {
  id: string;
  namespace: string;
  pipeline_id: string;
  pipeline_name: string;
  status: RunStatus;
  params: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  dry_run: number;
}

export interface StepRow {
  id: string;
  run_id: string;
  step_id: string;
  step_name: string;
  action: string;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  output: string | null;
  error: string | null;
  log_file: string | null;
}

export type ParamDef =
  | { name: string; label: string; type: "string"; required?: boolean; default?: string; placeholder?: string }
  | { name: string; label: string; type: "boolean"; default?: boolean }
  | { name: string; label: string; type: "select"; options: { label: string; value: string }[]; required?: boolean; default?: string };

export type ParamValues = Record<string, string | boolean>;

export interface LogLine {
  level: string;
  time: string;
  msg: string;
  runId: string;
  stepId: string;
  step: string;
  action: string;
  stepIndex: number;
  totalSteps: number;
}

export interface StepDefSummary {
  id: string;
  name: string;
  action: string;
}

export interface PipelineDefSummary {
  id: string;
  name: string;
  description?: string;
  confirm?: boolean;
  params?: ParamDef[];
  steps: StepDefSummary[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface NamespaceConfigSummary {
  namespace: string;
  display_name: string;
  pipelines: PipelineDefSummary[];
  error?: string;
}
