// --- JSON types ---

export type JSONValue = string | number | boolean | null | JSONObject | JSONValue[];

export interface JSONObject {
  [key: string]: JSONValue;
}

// --- Utilities ---

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type RunStatus = "pending" | "running" | "success" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";
export type LogLevel = "error" | "warn" | "info" | "debug";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["success", "failed", "cancelled"]);

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
  triggered_by: string | null;
}

export type BuiltinActionName = "codebuild" | "ecs-task" | "ecs-restart" | "cloudflare-purge" | "trigger-pipeline";
export type ActionName = BuiltinActionName | (string & {});

export interface StepRow {
  id: string;
  run_id: string;
  step_id: string;
  step_name: string;
  action: ActionName;
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
  level: LogLevel;
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
  action: ActionName;
}

export interface PipelineDefSummary {
  id: string;
  name: string;
  description?: string;
  confirm?: boolean;
  concurrency: number;
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

export interface ActiveRunInfo {
  namespace: string;
  pipelineId: string;
  runIds: string[];
}

export interface SystemStatus {
  activeRuns: number;
  maxConcurrentRuns: number;
  pipelines: ActiveRunInfo[];
}

// --- WebSocket message types ---

/** Server → Client messages (wire format) */
export type WSServerMessage =
  | ({ type: "status" } & SystemStatus)
  | { type: "run:started"; runId: string; namespace: string; pipelineId: string; pipelineName: string }
  | { type: "run:completed"; runId: string; namespace: string; pipelineId: string; pipelineName: string; status: RunStatus }
  | ({ type: "log" } & LogLine)
  | { type: "step"; runId: string; stepId: string; stepName: string; action: string; status: StepStatus }
  | { type: "run:status"; runId: string; status: RunStatus }
  | { type: "error"; message: string };

/** Client → Server messages (wire format) */
export type WSClientMessage = { type: "subscribe"; topic: string } | { type: "unsubscribe"; topic: string };

/** Internal pub/sub event bus messages */
export type PubSubMessage =
  | { type: "run:started"; runId: string; namespace: string; pipelineId: string; pipelineName: string }
  | { type: "run:completed"; runId: string; namespace: string; pipelineId: string; pipelineName: string; status: RunStatus }
  | ({ type: "log" } & LogLine)
  | { type: "step:status"; runId: string; stepId: string; stepName: string; action: string; status: StepStatus }
  | { type: "run:status"; runId: string; status: RunStatus };

/** Extract a specific variant from a message union by type */
export type MessageOf<T, K extends string> = Extract<T, { type: K }>;

// --- API response types ---

export interface AuthInfoResponse {
  enabled: boolean;
}

export interface UserResponse {
  email: string;
  name: string;
  groups: string[];
  isSuperAdmin: boolean;
}

export type PipelineResponse = PipelineDefSummary;

export interface PipelineConfigResponse {
  id: string;
  name: string;
  description?: string;
  params?: ParamDef[];
  steps: Array<StepDefSummary & { config: Record<string, unknown> }>;
}

export interface RunDetailResponse {
  run: RunRow;
  steps: StepRow[];
}

export interface RunLogsResponse {
  lines: LogLine[];
  truncated: boolean;
}

export interface TriggerRunRequest {
  params?: ParamValues;
  dryRun?: boolean;
}

export interface RunIdResponse {
  runId: string;
}

export interface OkResponse {
  ok: boolean;
}

export interface ErrorResponse {
  error: string;
}
