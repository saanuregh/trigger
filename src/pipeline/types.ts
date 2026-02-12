import type { ActionName, ActionConfigMap } from "../config/types.ts";

export interface ActionContext {
  runId: string;
  stepId: string;
  region: string;
  signal: AbortSignal;
  log: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  callStack?: string[];
}

export type ActionHandler<A extends ActionName = ActionName> = (
  config: ActionConfigMap[A],
  ctx: ActionContext,
) => Promise<{ output?: Record<string, unknown> }>;

export interface ActivePipeline {
  runId: string;
  abort: AbortController;
}
