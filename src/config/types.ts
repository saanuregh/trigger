import type { ActionName, ParamDef } from "../types.ts";

export type { PipelineConfig } from "./schema.ts";

export interface StepDef {
  id: string;
  name: string;
  action: ActionName;
  config: Record<string, unknown>;
}

export interface PipelineDef {
  id: string;
  name: string;
  description?: string;
  confirm?: boolean;
  timeout?: number;
  concurrency?: number;
  schedule?: string | Array<{ cron: string; params?: Record<string, string | boolean> }>;
  params?: ParamDef[];
  access?: AccessConfig;
  steps: StepDef[];
}

export interface AccessConfig {
  groups: string[];
}

export interface NamespaceConfig {
  namespace: string;
  display_name: string;
  aws_region: string;
  vars: Record<string, unknown>;
  access?: AccessConfig;
  pipelines: PipelineDef[];
  _source: {
    config: string;
    loaded_at: string;
  };
  _error?: string;
}
