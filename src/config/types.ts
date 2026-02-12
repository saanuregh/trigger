import type { ParamValues } from "../types.ts";
import type { PipelineDef as _PipelineDef } from "./schema.ts";

export type { PipelineConfig, PipelineDef, StepDef, ActionName } from "./schema.ts";

export interface CodeBuildActionConfig {
  project_name: string;
  env_vars?: Record<string, string | { value: string; type: "PLAINTEXT" | "PARAMETER_STORE" | "SECRETS_MANAGER" }>;
  source_version?: string;
}

export interface EcsRestartActionConfig {
  cluster: string;
  services: string[];
  timeout?: number;
}

export interface EcsTaskActionConfig {
  cluster: string;
  task_definition: string;
  container_name: string;
  command: string[];
  subnets: string[];
  security_groups: string[];
  launch_type?: "FARGATE" | "EC2";
  assign_public_ip?: boolean;
  timeout?: number;
  log_group?: string;
  log_stream_prefix?: string;
}

export interface CloudflarePurgeActionConfig {
  urls?: string[];
  purge_everything?: boolean;
}

export interface TriggerPipelineActionConfig {
  namespace: string;
  pipeline_id: string;
  params?: ParamValues;
}

export interface ActionConfigMap {
  "codebuild": CodeBuildActionConfig;
  "ecs-restart": EcsRestartActionConfig;
  "ecs-task": EcsTaskActionConfig;
  "cloudflare-purge": CloudflarePurgeActionConfig;
  "trigger-pipeline": TriggerPipelineActionConfig;
}

export interface NamespaceConfig {
  namespace: string;
  display_name: string;
  aws_region: string;
  vars: Record<string, unknown>;
  pipelines: _PipelineDef[];
  _source: {
    config: string;
    loaded_at: string;
  };
  _error?: string;
}
