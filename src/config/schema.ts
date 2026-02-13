import { z } from "zod";
import { TEMPLATE_RE, parseTemplateRef, type TemplateRef } from "./template.ts";

const templateString = z.string().regex(/\{\{.+?\}\}/);
const stringOrTemplate = z.string();
const stringArrayOrTemplate = z.union([z.array(z.string()), templateString]);
const numberOrTemplate = z.union([z.number(), templateString]);
const booleanOrTemplate = z.union([z.boolean(), templateString]);

const stringParam = z.object({
  name: z.string(),
  label: z.string(),
  type: z.literal("string"),
  required: z.boolean().optional(),
  default: z.string().optional(),
  placeholder: z.string().optional(),
}).strict();

const booleanParam = z.object({
  name: z.string(),
  label: z.string(),
  type: z.literal("boolean"),
  default: z.boolean().optional(),
}).strict();

const selectParam = z.object({
  name: z.string(),
  label: z.string(),
  type: z.literal("select"),
  options: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  required: z.boolean().optional(),
  default: z.string().optional(),
}).strict();

const paramDef = z.discriminatedUnion("type", [stringParam, booleanParam, selectParam]);

const codebuildConfig = z.object({
  project_name: stringOrTemplate,
  source_version: stringOrTemplate.optional(),
  env_vars: z.union([
    z.record(z.string(), z.union([
      z.string(),
      z.object({
        value: z.string(),
        type: z.enum(["PLAINTEXT", "PARAMETER_STORE", "SECRETS_MANAGER"]),
      }).strict(),
    ])),
    templateString,
  ]).optional(),
}).strict();

const ecsRestartConfig = z.object({
  cluster: stringOrTemplate,
  services: stringArrayOrTemplate,
  timeout: numberOrTemplate.optional(),
}).strict();

const ecsTaskConfig = z.object({
  cluster: stringOrTemplate,
  task_definition: stringOrTemplate,
  container_name: stringOrTemplate,
  command: stringArrayOrTemplate,
  subnets: stringArrayOrTemplate,
  security_groups: stringArrayOrTemplate,
  launch_type: z.enum(["FARGATE", "EC2"]).optional(),
  assign_public_ip: booleanOrTemplate.optional(),
  timeout: numberOrTemplate.optional(),
  log_group: stringOrTemplate.optional(),
  log_stream_prefix: stringOrTemplate.optional(),
}).strict();

const cloudflarePurgeConfig = z.object({
  urls: stringArrayOrTemplate.optional(),
  purge_everything: booleanOrTemplate.optional(),
}).strict();

const triggerPipelineConfig = z.object({
  namespace: stringOrTemplate,
  pipeline_id: stringOrTemplate,
  params: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
}).strict();

const switchConfig = z.object({
  $switch: z.string(),
  cases: z.record(z.string(), z.unknown()).optional(),
  default: z.unknown().optional(),
}).strict();

export const actionName = z.enum([
  "codebuild", "ecs-restart", "ecs-task", "cloudflare-purge", "trigger-pipeline",
]);

const stepConfig = z.union([
  codebuildConfig, ecsRestartConfig, ecsTaskConfig,
  cloudflarePurgeConfig, triggerPipelineConfig, switchConfig,
]);

const stepDef = z.object({
  id: z.string(),
  name: z.string(),
  action: actionName,
  config: stepConfig,
}).strict();

const pipelineDef = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  confirm: z.boolean().optional(),
  timeout: z.number().optional(),
  params: z.array(paramDef).optional(),
  steps: z.array(stepDef),
}).strict();

export const pipelineConfigSchema = z.object({
  $schema: z.string().optional(),
  namespace: z.string(),
  display_name: z.string(),
  aws_region: z.string(),
  vars: z.record(z.string(), z.unknown()).optional(),
  pipelines: z.array(pipelineDef),
}).strict().superRefine((config, ctx) => {
  const varNames = new Set(Object.keys(config.vars ?? {}));

  for (let pi = 0; pi < config.pipelines.length; pi++) {
    const pipeline = config.pipelines[pi]!;
    const paramNames = new Set((pipeline.params ?? []).map(p => p.name));

    for (let si = 0; si < pipeline.steps.length; si++) {
      const step = pipeline.steps[si]!;
      const knownNames = { vars: varNames, param: paramNames };
      for (const ref of extractTemplateRefs(step.config)) {
        if (!knownNames[ref.type].has(ref.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pipelines", pi, "steps", si, "config"],
            message: `Unknown ${ref.type === "vars" ? "variable" : "parameter"} reference: {{${ref.type}.${ref.name}}}`,
          });
        }
      }
    }
  }
});

function extractTemplateRefs(value: unknown): TemplateRef[] {
  const refs: TemplateRef[] = [];

  function walk(v: unknown) {
    if (typeof v === "string") {
      for (const match of v.matchAll(TEMPLATE_RE)) {
        const ref = parseTemplateRef(match[1]!);
        if (ref) refs.push(ref);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  }

  walk(value);
  return refs;
}

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type PipelineDef = z.infer<typeof pipelineDef>;
export type StepDef = z.infer<typeof stepDef>;
export type ActionName = z.infer<typeof actionName>;
